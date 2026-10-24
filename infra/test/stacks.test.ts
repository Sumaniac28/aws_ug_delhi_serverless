import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Config } from '../lib/config.ts';
import { createStacks } from '../lib/stacks.ts';

const HASH = 'sha256-8IykBE61QzApYKkpPepGwi55OP1gRPPaf1D1vbjGk0Q=';
const base: Config = { region: 'ap-south-1', account: '123456789012', wwwRedirect: false, adminOrigins: [], githubBranch: 'main' };
const withDomain: Config = { ...base, domainName: 'example.org', hostedZoneId: 'Z0123456789ABC', hostedZoneName: 'example.org', wwwRedirect: true };

function build(config: Config) {
  const app = new App();
  app.node.setContext('aws:cdk:bundling-stacks', []); // admin Lambdas are bundled by `cdk synth`, not in unit tests
  const stacks = createStacks(app, config, { scriptHashes: [HASH], adminAssets: s3deploy.Source.data('index.html', '<html></html>'), resizeCode: lambda.Code.fromInline('exports.handler = async () => {}') });
  return {
    media: Template.fromStack(stacks.media),
    site: Template.fromStack(stacks.site),
    cert: stacks.certificate ? Template.fromStack(stacks.certificate) : undefined,
  };
}

describe('MediaStack', () => {
  const { media } = build(base);

  it('keeps both buckets private, encrypted and TLS-only, and never deletes them with the stack', () => {
    media.resourceCountIs('AWS::S3::Bucket', 2);
    media.allResourcesProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      BucketEncryption: Match.anyValue(),
    });
    for (const r of Object.values(media.findResources('AWS::S3::Bucket'))) assert.equal((r as any).DeletionPolicy, 'Retain');
    media.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) },
    });
  });

  it('versions the content bucket, which is the content history and rollback', () => {
    media.hasResourceProperties('AWS::S3::Bucket', { VersioningConfiguration: { Status: 'Enabled' } });
  });

  it('expires raw uploads after one day', () => {
    media.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Id: 'expire-raw-uploads', Prefix: 'uploads/', ExpirationInDays: 1, Status: 'Enabled' })]) },
    });
  });

  it('lets CloudFront read media/* only, never uploads/', () => {
    const policies = Object.values(media.findResources('AWS::S3::BucketPolicy')).flatMap((p: any) => p.Properties.PolicyDocument.Statement);
    const cf = policies.find((s: any) => s.Sid === 'AllowCloudFrontReadMediaOnly');
    assert.ok(cf, 'CloudFront statement present');
    assert.deepEqual(cf.Action, 's3:GetObject');
    assert.match(JSON.stringify(cf.Resource), /media\/\*/);
    assert.doesNotMatch(JSON.stringify(cf.Resource), /uploads/);
    assert.match(JSON.stringify(cf.Condition), /cloudfront::.*:distribution\/\*/);
  });

  it('runs the resize function on Node 22 / arm64 and triggers it only from uploads/', () => {
    media.hasResourceProperties('AWS::Lambda::Function', { Runtime: 'nodejs22.x', Architectures: ['arm64'], Handler: 'index.handler', MemorySize: 1536, Timeout: 60 });
    media.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: {
        LambdaFunctionConfigurations: [
          Match.objectLike({ Events: ['s3:ObjectCreated:*'], Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'uploads/' }] } } }),
        ],
      },
    });
  });

  it('gives the resize function exactly two S3 permissions: GetObject on uploads/*, PutObject on media/*', () => {
    const [name, policy]: [string, any] = Object.entries(media.findResources('AWS::IAM::Policy')).find(([k]) => k.startsWith('ResizeFunctionServiceRole'))! as any;
    assert.ok(name, 'the function has its own role policy');
    const statements = policy.Properties.PolicyDocument.Statement.filter((s: any) => [s.Action].flat().some((a: string) => a.startsWith('s3:')));
    assert.equal(statements.length, 2);
    const byAction = Object.fromEntries(statements.map((s: any) => [s.Action, JSON.stringify(s.Resource)]));
    assert.match(byAction['s3:GetObject'], /uploads\/\*/);
    assert.doesNotMatch(byAction['s3:GetObject'], /media\/\*/);
    assert.match(byAction['s3:PutObject'], /media\/\*/);
    assert.doesNotMatch(byAction['s3:PutObject'], /uploads\/\*/);
    // And nothing of the function's grants mentions the content bucket.
    const contentId = Object.keys(media.findResources('AWS::S3::Bucket')).find((k) => k.startsWith('ContentBucket'))!;
    assert.doesNotMatch(JSON.stringify(policy), new RegExp(contentId));
  });

  it('retains logs for two weeks', () => {
    media.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });

  it('adds CORS for presigned uploads only when admin origins are configured', () => {
    assert.equal(Object.values(media.findResources('AWS::S3::Bucket')).filter((b: any) => b.Properties.CorsConfiguration).length, 0);
    const { media: withCors } = build({ ...base, adminOrigins: ['https://admin.example.org'] });
    withCors.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ['POST', 'PUT'], AllowedOrigins: ['https://admin.example.org'] })] },
    });
  });
});

describe('SiteStack (default cloudfront.net address)', () => {
  const { site, cert } = build(base);

  it('creates no certificate or DNS records without a domain', () => {
    assert.equal(cert, undefined);
    site.resourceCountIs('AWS::Route53::RecordSet', 0);
  });

  it('keeps the site bucket private and reachable only through CloudFront OAC', () => {
    site.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
    site.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
    site.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' }),
    });
    const stmts = Object.values(site.findResources('AWS::S3::BucketPolicy')).flatMap((p: any) => p.Properties.PolicyDocument.Statement);
    assert.ok(stmts.some((s: any) => s.Principal?.Service === 'cloudfront.amazonaws.com' && s.Condition?.StringEquals?.['AWS:SourceArn']), 'site bucket read is scoped to this distribution');
  });

  it('redirects to HTTPS, rewrites directory URLs and serves /media/* from its own origin', () => {
    site.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https', FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })], Compress: true }),
        CacheBehaviors: [Match.objectLike({ PathPattern: '/media/*', ViewerProtocolPolicy: 'redirect-to-https' })],
        HttpVersion: 'http2and3',
        PriceClass: 'PriceClass_200',
      }),
    });
    site.hasResourceProperties('AWS::CloudFront::Function', { FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }) });
  });

  it('maps S3 403/404 to the real 404 page with a 404 status', () => {
    site.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/404.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/404.html' }),
        ]),
      }),
    });
  });

  it('sends a strict CSP with the hashed inline script, HSTS and clickjacking protection', () => {
    site.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: { Override: true, ContentSecurityPolicy: Match.stringLikeRegexp(`script-src 'self' '${HASH}'`) },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 63072000, IncludeSubdomains: true, Override: true }),
          ContentTypeOptions: { Override: true },
        }),
      }),
    });
  });

  it('exposes what the publish step needs', () => {
    for (const out of ['SiteBucketName', 'DistributionId', 'SiteUrl']) assert.ok(site.toJSON().Outputs[out], out);
  });
});

describe('with a custom domain', () => {
  const { site, cert } = build(withDomain);

  it('puts the certificate in us-east-1, validated by DNS, for the apex and www', () => {
    cert!.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'example.org',
      SubjectAlternativeNames: ['www.example.org'],
      ValidationMethod: 'DNS',
    });
  });

  it('serves both names and points A and AAAA records at the distribution', () => {
    site.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['example.org', 'www.example.org'], ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021', SslSupportMethod: 'sni-only' }) }),
    });
    site.resourceCountIs('AWS::Route53::RecordSet', 4);
    for (const type of ['A', 'AAAA']) site.hasResourceProperties('AWS::Route53::RecordSet', { Type: type, Name: 'example.org.', AliasTarget: Match.anyValue() });
  });

  it('bakes the canonical host into the redirect function', () => {
    const fn: any = Object.values(site.findResources('AWS::CloudFront::Function'))[0];
    assert.match(fn.Properties.FunctionCode, /var CANONICAL_HOST = 'example\.org'/);
  });
});
