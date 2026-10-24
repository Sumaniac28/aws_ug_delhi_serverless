import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export const ORGANIZERS_GROUP = 'organizers';
const END_SCHEDULE_PREFIX = 'awsug-end-'; // keep in step with build-stack.ts and lambda/api/lib/schedule.ts

export interface AdminStackProps extends StackProps {
  contentBucket: s3.IBucket;
  mediaBucket: s3.IBucket;
  /** Where the admin app is served from. Drives CORS and the sign-in redirect URLs. */
  adminOrigins?: string[];
  /** Prefix of the hosted sign-in page, <prefix>.auth.<region>.amazoncognito.com. Must be unique across AWS. */
  cognitoDomainPrefix?: string;
  /** CodeBuild project that builds the site (Build stack). Without it Publish answers 503. */
  buildProjectName?: string;
  /** Where per-event "switch to Past" jobs are created (Build stack). Without it saving does not schedule. */
  scheduling?: { groupName: string; roleArn: string };
}

const entry = (name: string) => fileURLToPath(new URL(`../lambda/api/entry/${name}.ts`, import.meta.url));
const LOCKFILE = fileURLToPath(new URL('../package-lock.json', import.meta.url));

/**
 * The admin back end (ADR-002 decisions 4 and 5): an invite-only Cognito user pool, an HTTP API that
 * verifies Cognito tokens, and six small Lambdas that read and write the content bucket, sign photo
 * uploads and start a publish. No server, no database, nothing public.
 */
export class AdminStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly api: apigwv2.HttpApi;
  /** Hosted sign-in page, https://<prefix>.auth.<region>.amazoncognito.com */
  public readonly signInUrl: string;
  public readonly functions: Record<string, lambda.IFunction> = {};

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);
    const origins = props.adminOrigins ?? [];

    // ---- Cognito: only invited organizers, always with MFA ---------------------------------------
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'awsug-organizers',
      selfSignUpEnabled: false, // organizers are invited by an admin; nobody can register themselves
      signInAliases: { username: true, email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false }, // authenticator app; SMS would cost money and is weaker
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false, tempPasswordValidity: Duration.days(7) },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.LITE, // free for the first 10,000 monthly users
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      userInvitation: {
        emailSubject: 'You have been invited to the AWS UG Delhi NCR admin',
        emailBody:
          'Hello {username},<br/><br/>You have been invited to help run the AWS UG Delhi NCR website. ' +
          'Sign in with the username above and this temporary password: <b>{####}</b><br/><br/>' +
          'You will be asked to choose a new password and to set up an authenticator app. The invitation expires in 7 days.',
      },
    });

    new cognito.CfnUserPoolGroup(this, 'OrganizersGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: ORGANIZERS_GROUP,
      description: 'People allowed to edit the site content. Removing someone from this group, or disabling them, takes their access away.',
    });

    const callbackUrls = origins.length ? origins.map((o) => `${o}/`) : ['http://localhost:5173/'];
    if (!origins.length) {
      Annotations.of(this).addInfo('No adminOrigins set: sign-in redirects only to http://localhost:5173/ and browser calls to the API are blocked by CORS. Pass -c adminOrigins=https://admin.example.org once the admin app has an address.');
    }

    this.userPoolClient = this.userPool.addClient('AdminApp', {
      userPoolClientName: 'admin-app',
      generateSecret: false, // a browser app cannot keep a secret; PKCE protects the code flow instead
      authFlows: { userSrp: true },
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE], callbackUrls, logoutUrls: callbackUrls },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    const domainPrefix = props.cognitoDomainPrefix ?? `awsug-delhi-ncr-${this.account}`;
    this.userPool.addDomain('SignIn', { cognitoDomain: { domainPrefix } });
    this.signInUrl = `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`;

    // ---- The six Lambdas, each with only the permissions its route needs -----------------------------
    const content = props.contentBucket;
    const media = props.mediaBucket;
    const baseEnv = { CONTENT_BUCKET: content.bucketName, MEDIA_BUCKET: media.bucketName, NODE_OPTIONS: '--enable-source-maps' };

    const readObjects = new iam.PolicyStatement({ sid: 'ReadContent', actions: ['s3:GetObject'], resources: [content.arnForObjects('content/*')] });
    // Without s3:ListBucket, S3 answers 403 instead of 404 for a missing key, which would make "does this
    // speaker exist?" unanswerable. The bucket only ever holds content/, so no prefix condition is needed.
    const listBucket = new iam.PolicyStatement({ sid: 'ListContent', actions: ['s3:ListBucket'], resources: [content.bucketArn] });
    const writeObjects = new iam.PolicyStatement({ sid: 'WriteContent', actions: ['s3:PutObject'], resources: [content.arnForObjects('content/*')] });
    // Versioned bucket: DeleteObject only adds a delete marker. DeleteObjectVersion (permanent) is never granted.
    const deleteObjects = new iam.PolicyStatement({ sid: 'DeleteContent', actions: ['s3:DeleteObject'], resources: [content.arnForObjects('content/*')] });
    const signUploads = new iam.PolicyStatement({ sid: 'SignUploads', actions: ['s3:PutObject'], resources: [media.arnForObjects('uploads/*')] });

    const publishStatements: iam.PolicyStatement[] = props.buildProjectName
      ? [
          new iam.PolicyStatement({
            sid: 'StartAndInspectBuilds',
            actions: ['codebuild:StartBuild', 'codebuild:ListBuildsForProject', 'codebuild:BatchGetBuilds'],
            resources: [`arn:${this.partition}:codebuild:${this.region}:${this.account}:project/${props.buildProjectName}`],
          }),
        ]
      : [];

    // Per-event jobs: the Save function creates, moves and removes them; Delete only removes. Limited to the job-name
    // prefix, so neither can touch the nightly job or anything else in the account.
    const scheduling = props.scheduling && props.buildProjectName ? props.scheduling : undefined;
    const jobArn = scheduling && `arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule/${scheduling.groupName}/${END_SCHEDULE_PREFIX}*`;
    const manageJobs = scheduling
      ? [
          new iam.PolicyStatement({ sid: 'ManageEndJobs', actions: ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule', 'scheduler:DeleteSchedule'], resources: [jobArn!] }),
          new iam.PolicyStatement({ sid: 'HandRoleToScheduler', actions: ['iam:PassRole'], resources: [scheduling.roleArn], conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } } }),
        ]
      : [];
    const removeJobs = scheduling ? [new iam.PolicyStatement({ sid: 'RemoveEndJobs', actions: ['scheduler:DeleteSchedule'], resources: [jobArn!] })] : [];
    const schedulingEnv: Record<string, string> = scheduling ? { SCHEDULE_GROUP: scheduling.groupName, SCHEDULER_ROLE_ARN: scheduling.roleArn, BUILD_PROJECT: props.buildProjectName! } : {};

    const makeFunction = (name: string, file: string, statements: iam.PolicyStatement[], env: Record<string, string> = {}) => {
      const fn = new nodejs.NodejsFunction(this, name, {
        entry: entry(file),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: Duration.seconds(15),
        environment: { ...baseEnv, ...env },
        depsLockFilePath: LOCKFILE,
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
          // Bundle the AWS SDK too, so behaviour does not change when the runtime's bundled SDK is updated
          // (conditional writes need a recent version).
          externalModules: [],
        },
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
      });
      for (const s of statements) fn.addToRolePolicy(s);
      this.functions[name] = fn;
      return fn;
    };

    const list = makeFunction('List', 'list', [readObjects, listBucket]);
    const get = makeFunction('Get', 'get', [readObjects, listBucket]);
    const save = makeFunction('Save', 'save', [readObjects, listBucket, writeObjects, ...manageJobs], schedulingEnv);
    const remove = makeFunction('Delete', 'remove', [readObjects, listBucket, deleteObjects, ...removeJobs], schedulingEnv);
    const sign = makeFunction('SignUpload', 'sign', [signUploads]);
    const publish = makeFunction('Publish', 'publish', publishStatements, props.buildProjectName ? { BUILD_PROJECT: props.buildProjectName } : {});

    // ---- HTTP API: Cognito verifies the token; each handler then checks the organizers group ---------
    this.api = new apigwv2.HttpApi(this, 'Api', {
      apiName: 'awsug-admin',
      description: 'Admin API for the AWS UG Delhi NCR site',
      createDefaultStage: false,
      corsPreflight: origins.length
        ? {
            allowOrigins: origins,
            allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.DELETE],
            allowHeaders: ['authorization', 'content-type', 'if-match', 'if-none-match'],
            exposeHeaders: ['etag'],
            maxAge: Duration.hours(1),
          }
        : undefined,
    });

    const authorizer = new HttpUserPoolAuthorizer('Cognito', this.userPool, { userPoolClients: [this.userPoolClient], identitySource: ['$request.header.Authorization'] });
    const route = (path: string, methods: apigwv2.HttpMethod[], name: string, fn: lambda.IFunction) =>
      this.api.addRoutes({ path, methods, integration: new HttpLambdaIntegration(`${name}Integration`, fn), authorizer });

    route('/content/{collection}', [apigwv2.HttpMethod.GET], 'List', list);
    route('/content/{collection}/{id}', [apigwv2.HttpMethod.GET], 'Get', get);
    route('/content/{collection}/{id}', [apigwv2.HttpMethod.PUT], 'Save', save);
    route('/content/{collection}/{id}', [apigwv2.HttpMethod.DELETE], 'Delete', remove);
    route('/uploads', [apigwv2.HttpMethod.POST], 'Sign', sign);
    route('/publish', [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], 'Publish', publish);

    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY });
    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      stageName: '$default',
      autoDeploy: true,
      // Abuse protection for a login-protected API used by a handful of people.
      throttle: { rateLimit: 20, burstLimit: 40 },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({ requestId: '$context.requestId', route: '$context.routeKey', status: '$context.status', latencyMs: '$context.responseLatency', user: '$context.authorizer.claims.username', error: '$context.error.message' }),
        ),
      },
    });

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint, description: 'Base URL the admin app calls' });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'SignInDomain', { value: this.signInUrl, description: 'Hosted sign-in page (handles password and authenticator-app setup)' });
    new CfnOutput(this, 'OrganizersGroupName', { value: ORGANIZERS_GROUP });
  }
}
