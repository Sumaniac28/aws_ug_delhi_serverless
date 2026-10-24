import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export const BUILD_PROJECT_NAME = 'awsug-site';
export const SCHEDULE_GROUP_NAME = 'awsug-events';
/** Every per-event job the API creates is named with this prefix, which is also what its IAM permissions are limited to. */
export const END_SCHEDULE_PREFIX = 'awsug-end-';
/** Scheduler's built-in call that starts a CodeBuild build. */
export const START_BUILD_TARGET = 'arn:aws:scheduler:::aws-sdk:codebuild:startBuild';

export interface BuildStackProps extends StackProps {
  contentBucket: s3.IBucket;
  siteBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  /** Public address of the site (canonical URLs and the sitemap are built from it). */
  siteUrl: string;
  /** Inline-script hashes the deployed CSP allows; the build refuses to publish if its own differ. */
  scriptHashes: string[];
  /** Where the site's code lives. Public repositories need no credentials; see the runbook for private ones. */
  github: { owner: string; repo: string; branch: string };
}

/**
 * Turns saved content into the live site (ADR-002 decisions 7 and 8).
 *
 * One CodeBuild project runs buildspec.yml: pull the content JSON from S3, build and validate the site, upload
 * it, clear the CDN cache. Three things start it: the admin's Publish button, a one-time job per event just
 * after it ends (so it moves from Upcoming to Past on time), and a nightly job as a safety net.
 */
export class BuildStack extends Stack {
  public readonly project: codebuild.Project;
  public readonly scheduleGroupName = SCHEDULE_GROUP_NAME;
  public readonly schedulerRole: iam.Role;

  constructor(scope: Construct, id: string, props: BuildStackProps) {
    super(scope, id, props);

    // ---- The build -------------------------------------------------------------------------------
    this.project = new codebuild.Project(this, 'SiteBuild', {
      projectName: BUILD_PROJECT_NAME,
      description: 'Builds the AWS UG Delhi NCR site from the saved content and publishes it',
      source: codebuild.Source.gitHub({ owner: props.github.owner, repo: props.github.repo, branchOrRef: props.github.branch }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0, // Node 22 available; Graviton is cheaper
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          CONTENT_BUCKET: { value: props.contentBucket.bucketName },
          SITE_BUCKET: { value: props.siteBucket.bucketName },
          DISTRIBUTION_ID: { value: props.distribution.distributionId },
          SITE_URL: { value: props.siteUrl },
          EXPECTED_CSP_HASHES: { value: props.scriptHashes.join(',') },
        },
      },
      // Deliberately no build cache: every build starts from a fresh checkout. Astro keeps a content cache that does
      // not forget deleted files, so a reused cache could publish an event or speaker that was deleted.
      timeout: Duration.minutes(20),
      queuedTimeout: Duration.minutes(30),
      concurrentBuildLimit: 1, // one publish at a time; the Publish button also reports one already running
      logging: { cloudWatch: { logGroup: new logs.LogGroup(this, 'BuildLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }) } },
    });

    // Least privilege: read content, replace the site's files, clear the cache. Nothing else.
    const role = this.project.role!;
    role.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'ReadContent', actions: ['s3:GetObject'], resources: [props.contentBucket.arnForObjects('content/*')] }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'ListContent', actions: ['s3:ListBucket'], resources: [props.contentBucket.bucketArn] }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'PublishSite', actions: ['s3:PutObject', 's3:DeleteObject'], resources: [props.siteBucket.arnForObjects('*')] }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'ListSite', actions: ['s3:ListBucket'], resources: [props.siteBucket.bucketArn] }));
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'ClearCache',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:${this.partition}:cloudfront::${this.account}:distribution/${props.distribution.distributionId}`],
      }),
    );

    // ---- Scheduler: who may start the build, and the groups of jobs ------------------------------------
    new scheduler.CfnScheduleGroup(this, 'EventSchedules', { name: this.scheduleGroupName });

    this.schedulerRole = new iam.Role(this, 'SchedulerRole', {
      description: 'Assumed by EventBridge Scheduler to start the site build',
      // Only Scheduler, only for jobs in this group of this account (confused-deputy protection).
      // Scheduler presents the schedule GROUP's ARN as aws:SourceArn when it assumes the role (found on the first
      // real deploy: a condition naming only `schedule/<group>/*` made it refuse the role), so the group ARN is
      // what must match. The per-schedule pattern is kept as well, so either form of the check is accepted.
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          StringLike: {
            'aws:SourceArn': [
              `arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule-group/${this.scheduleGroupName}`,
              `arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule/${this.scheduleGroupName}/*`,
            ],
          },
        },
      }),
    });
    this.schedulerRole.addToPolicy(new iam.PolicyStatement({ sid: 'StartBuild', actions: ['codebuild:StartBuild'], resources: [this.project.projectArn] }));

    // ---- Nightly safety net: 00:17 India time, whatever else did or did not fire ----------------------------
    new scheduler.CfnSchedule(this, 'NightlyRebuild', {
      name: 'awsug-nightly-rebuild',
      groupName: this.scheduleGroupName,
      description: 'Catches anything the per-event jobs missed (for example an event that ended while a build was running)',
      scheduleExpression: 'cron(17 0 * * ? *)',
      scheduleExpressionTimezone: 'Asia/Kolkata',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: {
        arn: START_BUILD_TARGET,
        roleArn: this.schedulerRole.roleArn,
        input: JSON.stringify({ ProjectName: this.project.projectName }),
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
      },
    }).node.addDependency(this.schedulerRole);

    new CfnOutput(this, 'BuildProjectName', { value: this.project.projectName, description: 'The publish build (started by Publish, the schedules and the nightly job)' });
    new CfnOutput(this, 'ScheduleGroup', { value: this.scheduleGroupName });
  }
}
