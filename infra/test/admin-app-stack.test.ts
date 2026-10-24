import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { loadConfig, type Config } from '../lib/config.ts';
import { createStacks } from '../lib/stacks.ts';

const HASH = 'sha256-8IykBE61QzApYKkpPepGwi55OP1gRPPaf1D1vbjGk0Q=';
const base: Config = { region: 'ap-south-1', account: '123456789012', wwwRedirect: false, adminOrigins: [], githubBranch: 'main' };
const withAdminDomain: Config = {
  ...base,
  domainName: 'example.org',
  hostedZoneId: 'Z0123456789ABC',
  hostedZoneName: 'example.org',
  adminDomainName: 'admin.example.org',
  adminOrigins: ['https://admin.example.org'],
};

function build(config: Config) {
  const app = new App();
  app.node.setContext('aws:cdk:bundling-stacks', []);
  const s = createStacks(app, config, { scriptHashes: [HASH], adminAssets: s3deploy.Source.data('index.html', '<html></html>'), resizeCode: lambda.Code.fromInline('exports.handler = async () => {}') });
  return { app, ...s, t: Template.fromStack(s.adminApp), admin: Template.fromStack(s.admin), media: Template.fromStack(s.media), cert: s.certificate && Template.fromStack(s.certificate) };
}

const headersPolicy = (t: Template) => (Object.values(t.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0] as any).Properties.ResponseHeadersPolicyConfig;
const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

describe('AdminAppStack hosting', () => {
  const { t } = build(base);

  it('keeps the bucket private and serves it only through CloudFront OAC', () => {
    t.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } });
    for (const r of Object.values(t.findResources('AWS::S3::Bucket'))) assert.equal((r as any).DeletionPolicy, 'Retain');
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    t.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ DefaultRootObject: 'index.html', HttpVersion: 'http2and3' }) });
  });

  it('serves the app shell for any address (single-page app), including S3 403s for missing keys', () => {
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  it('is kept out of search engines and cannot be framed', () => {
    const cfg = headersPolicy(t);
    const custom = cfg.CustomHeadersConfig.Items as { Header: string; Value: string }[];
    assert.match(custom.find((h) => h.Header === 'X-Robots-Tag')!.Value, /noindex/);
    assert.equal(cfg.SecurityHeadersConfig.FrameOptions.FrameOption, 'DENY');
    assert.equal(cfg.SecurityHeadersConfig.ReferrerPolicy.ReferrerPolicy, 'no-referrer');
    assert.equal(cfg.SecurityHeadersConfig.StrictTransportSecurity.AccessControlMaxAgeSec, 63072000);
  });

  it('has a strict CSP: own scripts and styles only, no inline anything, no eval', () => {
    const csp = JSON.stringify(headersPolicy(t).SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    const resolved = csp; // tokens appear as Fn::Join parts, but the fixed directives are literal strings
    assert.match(resolved, /script-src 'self'(;|\\")/);
    assert.match(resolved, /style-src 'self'(;|\\")/);
    assert.doesNotMatch(resolved, /unsafe-inline|unsafe-eval/);
    assert.match(resolved, /frame-ancestors 'none'/);
    assert.match(resolved, /object-src 'none'/);
  });

  it('lets the app talk to exactly its API, the Cognito sign-in service and the media bucket', () => {
    const csp = JSON.stringify(headersPolicy(t).SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    // connect-src names three imported/derived addresses besides 'self'.
    const connect = csp.slice(csp.indexOf("connect-src"), csp.indexOf("object-src"));
    assert.match(connect, /ImportValue/, 'API / sign-in / bucket addresses come from the other stacks');
    assert.match(connect, /amazonaws\.com/, 'the media bucket origin is named');
    assert.doesNotMatch(connect, /\*/, 'no wildcard hosts');
  });

  it('deploys the build plus a generated config.json, then clears the CDN cache', () => {
    t.hasResourceProperties('Custom::CDKBucketDeployment', { Prune: true, DistributionPaths: ['/*'], DestinationBucketName: Match.anyValue() });
    const deployment: any = Object.values(t.findResources('Custom::CDKBucketDeployment'))[0];
    assert.equal(deployment.Properties.SourceObjectKeys.length, 2, 'the app build and config.json');
    const markers = JSON.stringify(deployment.Properties.SourceMarkers);
    assert.match(markers, /ImportValue/, 'config.json values are filled in at deploy time from the other stacks\' outputs');
  });

  it('outputs where to open the admin', () => {
    assert.ok(t.toJSON().Outputs.AdminUrl);
  });

  it('creates no DNS or certificate without a domain', () => {
    t.resourceCountIs('AWS::Route53::RecordSet', 0);
  });
});

describe('with an admin domain', () => {
  const { t, cert, admin, media } = build(withAdminDomain);

  it('serves the admin on its own name, over TLS 1.2+, with A and AAAA records', () => {
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['admin.example.org'], ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }) }),
    });
    t.resourceCountIs('AWS::Route53::RecordSet', 2);
    for (const type of ['A', 'AAAA']) t.hasResourceProperties('AWS::Route53::RecordSet', { Type: type, Name: 'admin.example.org.' });
  });

  it('puts the admin address on the same certificate as the site', () => {
    cert!.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'example.org', SubjectAlternativeNames: ['admin.example.org'] });
  });

  it('lets only the admin origin sign in, call the API and upload photos', () => {
    admin.hasResourceProperties('AWS::Cognito::UserPoolClient', { CallbackURLs: ['https://admin.example.org/'], LogoutURLs: ['https://admin.example.org/'] });
    admin.hasResourceProperties('AWS::ApiGatewayV2::Api', { CorsConfiguration: Match.objectLike({ AllowOrigins: ['https://admin.example.org'] }) });
    media.hasResourceProperties('AWS::S3::Bucket', { CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: ['https://admin.example.org'] })] } });
  });
});

describe('config for the admin address', () => {
  const load = (ctx: Record<string, string>) => {
    const app = new App({ context: ctx });
    return loadConfig(app);
  };
  const zone = { domainName: 'example.org', hostedZoneId: 'Z1', hostedZoneName: 'example.org', account: '123456789012' };

  it('defaults the admin origin from the admin domain', () => {
    assert.deepEqual(load({ ...zone, adminDomainName: 'admin.example.org' }).adminOrigins, ['https://admin.example.org']);
  });
  it('lets explicit adminOrigins win (for example a cloudfront.net address on the first deploy)', () => {
    assert.deepEqual(load({ ...zone, adminDomainName: 'admin.example.org', adminOrigins: 'https://d111.cloudfront.net' }).adminOrigins, ['https://d111.cloudfront.net']);
  });
  it('refuses an admin domain outside the hosted zone, or without a site domain', () => {
    assert.throws(() => load({ ...zone, adminDomainName: 'admin.other.org' }), /inside the hosted zone/);
    assert.throws(() => load({ adminDomainName: 'admin.example.org' }), /needs domainName/);
  });
});
