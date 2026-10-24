import type { App } from 'aws-cdk-lib';

/**
 * Deployment settings, read from CDK context so nothing is hard-coded and the next organizer team
 * can change them without touching code:
 *
 *   npx cdk deploy --all -c domainName=example.org -c hostedZoneId=Z123 -c hostedZoneName=example.org
 *
 * or put the same keys under "context" in cdk.json. With no domainName the site is served on the
 * default *.cloudfront.net address, which is how to try the stacks before the domain is decided
 * (ADR-002: trademark query pending).
 */
export interface Config {
  /** Region for the buckets and Lambda. Mumbai keeps data close to the audience. */
  region: string;
  /** Account to deploy into. Defaults to CDK_DEFAULT_ACCOUNT (the profile you deploy with). */
  account?: string;
  /** Canonical host, e.g. "example.org". Unset means no custom domain, certificate or DNS. */
  domainName?: string;
  /** Route 53 hosted zone that serves domainName. Required with domainName. */
  hostedZoneId?: string;
  hostedZoneName?: string;
  /** Also answer on www.<domainName> and redirect it to the canonical host. */
  wwwRedirect: boolean;
  /** Address for the admin app, e.g. admin.example.org. Must sit inside the hosted zone. Omit to use a cloudfront.net address. */
  adminDomainName?: string;
  /** Origins allowed to upload photos straight to S3 with a presigned POST (the admin app, Phase 4/5). */
  adminOrigins: string[];
  /** "owner/repo" holding this code. Setting it creates the publish build; without it Publish stays off. */
  githubRepo?: { owner: string; repo: string };
  githubBranch: string;
  /** Prefix of the hosted Cognito sign-in page. Must be unique across AWS; defaults to awsug-delhi-ncr-<account>. */
  cognitoDomainPrefix?: string;
}

const str = (app: App, key: string) => {
  const v = app.node.tryGetContext(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

export function loadConfig(app: App): Config {
  const domainName = str(app, 'domainName');
  const hostedZoneId = str(app, 'hostedZoneId');
  const hostedZoneName = str(app, 'hostedZoneName');
  const account = str(app, 'account') ?? process.env.CDK_DEFAULT_ACCOUNT;

  if (domainName && (!hostedZoneId || !hostedZoneName)) {
    throw new Error('domainName needs hostedZoneId and hostedZoneName too (the Route 53 zone that serves it).');
  }
  if (domainName && !account) {
    throw new Error('A custom domain needs a concrete AWS account (the certificate lives in us-east-1). Run with AWS credentials, or pass -c account=<12-digit id>.');
  }

  const adminDomainName = str(app, 'adminDomainName');
  if (adminDomainName && !domainName) throw new Error('adminDomainName needs domainName, hostedZoneId and hostedZoneName too.');
  if (adminDomainName && hostedZoneName && !adminDomainName.endsWith(`.${hostedZoneName}`)) {
    throw new Error(`adminDomainName (${adminDomainName}) must be inside the hosted zone ${hostedZoneName}.`);
  }

  // Where the admin app is served from. Defaults to the admin domain when one is set.
  const configured = (str(app, 'adminOrigins') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const adminOrigins = configured.length ? configured : adminDomainName ? [`https://${adminDomainName}`] : [];
  const wwwRedirect = ['true', true].includes(app.node.tryGetContext('wwwRedirect'));

  const cognitoDomainPrefix = str(app, 'cognitoDomainPrefix');
  if (cognitoDomainPrefix && !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(cognitoDomainPrefix)) {
    throw new Error('cognitoDomainPrefix may only contain lowercase letters, digits and hyphens.');
  }

  const githubRaw = str(app, 'githubRepo');
  if (githubRaw && !/^[\w.-]+\/[\w.-]+$/.test(githubRaw)) throw new Error('githubRepo must look like "owner/repo".');
  const githubRepo = githubRaw ? { owner: githubRaw.split('/')[0]!, repo: githubRaw.split('/')[1]! } : undefined;

  return { githubRepo, githubBranch: str(app, 'githubBranch') ?? 'main', region: str(app, 'region') ?? 'ap-south-1', account, domainName, hostedZoneId, hostedZoneName, wwwRedirect, adminDomainName, adminOrigins, cognitoDomainPrefix };
}
