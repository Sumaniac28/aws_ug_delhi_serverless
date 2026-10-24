import { Tags, type App } from 'aws-cdk-lib';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { AdminAppStack } from './admin-app-stack.ts';
import { AdminStack } from './admin-stack.ts';
import { BuildStack } from './build-stack.ts';
import { CertificateStack } from './certificate-stack.ts';
import type { Config } from './config.ts';
import { MediaStack } from './media-stack.ts';
import { loadRedirects } from './redirects.ts';
import { SiteStack, type SiteStackProps } from './site-stack.ts';

export interface CreateStacksOptions {
  scriptHashes: string[];
  /** The built admin app (admin/dist). Tests pass inline content. */
  adminAssets: s3deploy.ISource;
  /** Tests pass inline code so no packaged Lambda is needed. */
  resizeCode?: lambda.Code;
  /** Old path -> new path. Defaults to infra/redirects.json. */
  redirects?: Record<string, string>;
}

/** Builds every stack for a deployment. Used by bin/app.ts and by the tests, so they cannot drift apart. */
export function createStacks(app: App, config: Config, { scriptHashes, adminAssets, resizeCode, redirects = loadRedirects() }: CreateStacksOptions) {
  const env = { account: config.account, region: config.region };

  const media = new MediaStack(app, 'AwsugMedia', { env, adminOrigins: config.adminOrigins, resizeCode });

  let certificate: CertificateStack | undefined;
  let domain: SiteStackProps['domain'];
  if (config.domainName) {
    // CloudFront needs its certificate in us-east-1 regardless of where everything else lives.
    // One certificate covers the site, www (if used) and the admin address.
    certificate = new CertificateStack(app, 'AwsugCertificate', {
      env: { account: config.account, region: 'us-east-1' },
      domainName: config.domainName,
      hostedZoneId: config.hostedZoneId!,
      hostedZoneName: config.hostedZoneName!,
      wwwRedirect: config.wwwRedirect,
      additionalNames: config.adminDomainName ? [config.adminDomainName] : undefined,
    });
    domain = {
      domainName: config.domainName,
      hostedZoneId: config.hostedZoneId!,
      hostedZoneName: config.hostedZoneName!,
      wwwRedirect: config.wwwRedirect,
      certificate: certificate.certificate,
    };
  }

  const site = new SiteStack(app, 'AwsugSite', { env, mediaBucketName: media.mediaBucket.bucketName, scriptHashes, domain, redirects });

  // The publish build, and the schedules that start it. Needs to know where the code lives; without that the
  // admin still works but Publish stays off.
  const build = config.githubRepo
    ? new BuildStack(app, 'AwsugBuild', {
        env,
        contentBucket: media.contentBucket,
        siteBucket: site.siteBucket,
        distribution: site.distribution,
        siteUrl: site.siteUrl,
        scriptHashes,
        github: { ...config.githubRepo, branch: config.githubBranch },
      })
    : undefined;

  const admin = new AdminStack(app, 'AwsugAdmin', {
    env,
    contentBucket: media.contentBucket,
    mediaBucket: media.mediaBucket,
    adminOrigins: config.adminOrigins,
    cognitoDomainPrefix: config.cognitoDomainPrefix,
    buildProjectName: build?.project.projectName,
    scheduling: build ? { groupName: build.scheduleGroupName, roleArn: build.schedulerRole.roleArn } : undefined,
  });

  const adminApp = new AdminAppStack(app, 'AwsugAdminApp', {
    env,
    apiUrl: admin.api.apiEndpoint,
    signInUrl: admin.signInUrl,
    userPoolClientId: admin.userPoolClient.userPoolClientId,
    siteUrl: site.siteUrl,
    mediaBucketName: media.mediaBucket.bucketName,
    assets: adminAssets,
    domain:
      config.adminDomainName && certificate
        ? { domainName: config.adminDomainName, hostedZoneId: config.hostedZoneId!, hostedZoneName: config.hostedZoneName!, certificate: certificate.certificate }
        : undefined,
  });

  Tags.of(app).add('project', 'awsug-delhi-ncr-website');
  Tags.of(app).add('managed-by', 'cdk');
  return { media, certificate, site, build, admin, adminApp };
}
