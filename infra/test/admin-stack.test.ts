import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { AdminStack } from '../lib/admin-stack.ts';
import type { Config } from '../lib/config.ts';
import { MediaStack } from '../lib/media-stack.ts';
import { createStacks } from '../lib/stacks.ts';

const HASH = 'sha256-8IykBE61QzApYKkpPepGwi55OP1gRPPaf1D1vbjGk0Q=';
const base: Config = { region: 'ap-south-1', account: '123456789012', wwwRedirect: false, adminOrigins: [], githubBranch: 'main' };

function build(config: Config) {
  const app = new App();
  app.node.setContext('aws:cdk:bundling-stacks', []); // skip esbuild: bundling is exercised by `cdk synth`
  const { admin } = createStacks(app, config, { scriptHashes: [HASH], adminAssets: s3deploy.Source.data('index.html', '<html></html>'), resizeCode: lambda.Code.fromInline('exports.handler = async () => {}') });
  return Template.fromStack(admin);
}

/** The statements of one function's role policy, flattened. */
function statementsOf(t: Template, fn: string): { Action: string[]; Resource: unknown; Sid?: string }[] {
  const entry = Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) => id.startsWith(`${fn}ServiceRoleDefaultPolicy`));
  assert.ok(entry, `${fn} has a role policy`);
  return (entry[1] as any).Properties.PolicyDocument.Statement.map((s: any) => ({ ...s, Action: [s.Action].flat() }));
}
const actionsOf = (t: Template, fn: string) => statementsOf(t, fn).flatMap((s) => s.Action);

describe('Cognito', () => {
  const t = build(base);

  it('is invite-only: nobody can sign themselves up', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }) });
  });

  it('requires an authenticator-app code (MFA) at every sign-in, and no SMS', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', { MfaConfiguration: 'ON', EnabledMfas: ['SOFTWARE_TOKEN_MFA'] });
  });

  it('enforces a 12+ character password, email-only recovery, the free Lite plan and deletion protection', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, TemporaryPasswordValidityDays: 7 }) },
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
      UserPoolTier: 'LITE',
      DeletionProtection: 'ACTIVE',
    });
    for (const r of Object.values(t.findResources('AWS::Cognito::UserPool'))) assert.equal((r as any).DeletionPolicy, 'Retain');
  });

  it('creates the organizers group', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'organizers' });
  });

  it('uses a secret-less app client with PKCE-style code flow, SRP, revocation and no user enumeration', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      RefreshTokenValidity: 43200,
      SupportedIdentityProviders: ['COGNITO'],
    });
  });

  it('only redirects to localhost before an admin origin is configured, then only to the admin origin', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', { CallbackURLs: ['http://localhost:5173/'] });
    const configured = build({ ...base, adminOrigins: ['https://admin.example.org'] });
    configured.hasResourceProperties('AWS::Cognito::UserPoolClient', { CallbackURLs: ['https://admin.example.org/'], LogoutURLs: ['https://admin.example.org/'] });
  });

  it('has a hosted sign-in domain', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', Match.objectLike({ Domain: Match.anyValue() }));
  });
});

describe('HTTP API', () => {
  const t = build(base);

  it('exposes exactly the seven routes, and every one requires a verified token', () => {
    const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')).map((r: any) => r.Properties);
    assert.deepEqual(
      routes.map((r) => r.RouteKey).sort(),
      ['DELETE /content/{collection}/{id}', 'GET /content/{collection}', 'GET /content/{collection}/{id}', 'GET /publish', 'POST /publish', 'POST /uploads', 'PUT /content/{collection}/{id}'],
    );
    for (const r of routes) {
      assert.equal(r.AuthorizationType, 'JWT', r.RouteKey);
      assert.ok(r.AuthorizerId, `${r.RouteKey} has an authorizer`);
    }
  });

  it('verifies tokens against this user pool and client, reading the Authorization header', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: Match.objectLike({ Audience: [Match.anyValue()], Issuer: Match.anyValue() }),
    });
  });

  it('throttles requests and writes JSON access logs', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      AccessLogSettings: Match.objectLike({ Format: Match.stringLikeRegexp('requestId') }),
    });
  });

  it('allows cross-origin calls only from configured admin origins, with the headers the admin needs', () => {
    assert.equal(Object.values(t.findResources('AWS::ApiGatewayV2::Api')).filter((a: any) => a.Properties.CorsConfiguration).length, 0);
    build({ ...base, adminOrigins: ['https://admin.example.org'] }).hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['https://admin.example.org'],
        AllowMethods: Match.arrayWith(['GET', 'PUT', 'POST', 'DELETE']),
        AllowHeaders: ['authorization', 'content-type', 'if-match', 'if-none-match'],
        ExposeHeaders: ['etag'],
      }),
    });
  });
});

describe('Lambdas', () => {
  const t = build(base);
  const NAMES = ['List', 'Get', 'Save', 'Delete', 'SignUpload', 'Publish'];

  it('are six Node 22 / arm64 functions, each with its own log group retained for two weeks', () => {
    const fns = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([id]) => NAMES.some((n) => id.startsWith(n)));
    assert.equal(fns.length, 6);
    for (const [, f] of fns) {
      assert.equal((f as any).Properties.Runtime, 'nodejs22.x');
      assert.deepEqual((f as any).Properties.Architectures, ['arm64']);
    }
    t.resourceCountIs('AWS::Logs::LogGroup', 7); // six functions + API access logs
  });

  it('List and Get can read content and nothing else', () => {
    for (const fn of ['List', 'Get']) assert.deepEqual(actionsOf(t, fn).sort(), ['s3:GetObject', 's3:ListBucket'], fn);
  });

  it('Save can read and write content but not delete it', () => {
    assert.deepEqual(actionsOf(t, 'Save').sort(), ['s3:GetObject', 's3:ListBucket', 's3:PutObject']);
  });

  it('Delete can only add delete markers: never DeleteObjectVersion, never PutObject', () => {
    const actions = actionsOf(t, 'Delete');
    assert.ok(actions.includes('s3:DeleteObject'));
    assert.ok(!actions.includes('s3:DeleteObjectVersion') && !actions.includes('s3:PutObject'));
  });

  it('SignUpload can only put into the media bucket under uploads/', () => {
    const s = statementsOf(t, 'SignUpload');
    assert.equal(s.length, 1);
    assert.deepEqual(s[0]!.Action, ['s3:PutObject']);
    const resource = JSON.stringify(s[0]!.Resource);
    assert.match(resource, /uploads\/\*/);
    assert.doesNotMatch(resource, /content\//);
  });

  it('nothing but SignUpload can touch uploads or media, and no one has wildcards on actions or resources', () => {
    const withPolicy = NAMES.filter((fn) => Object.keys(t.findResources('AWS::IAM::Policy')).some((id) => id.startsWith(`${fn}ServiceRoleDefaultPolicy`)));
    assert.deepEqual(withPolicy, ['List', 'Get', 'Save', 'Delete', 'SignUpload'], 'Publish has no policy until Phase 6');
    for (const fn of withPolicy) {
      for (const s of statementsOf(t, fn)) {
        for (const a of s.Action) assert.ok(a !== '*' && !a.endsWith(':*'), `${fn}: ${a}`);
        assert.notEqual(s.Resource, '*', fn);
        if (fn !== 'SignUpload') assert.doesNotMatch(JSON.stringify(s.Resource), /uploads\/|media\//, `${fn} must not reach the media bucket`);
      }
    }
  });

  it('Publish has no AWS permissions until the build project exists, then only on that project', () => {
    assert.ok(![...Object.keys(t.findResources('AWS::IAM::Policy'))].some((id) => id.startsWith('PublishServiceRoleDefaultPolicy')), 'no policy at all');
    const withProject = new App();
    withProject.node.setContext('aws:cdk:bundling-stacks', []);
    const media = new MediaStack(withProject, 'M', { resizeCode: lambda.Code.fromInline('x') });
    const admin = new AdminStack(withProject, 'A', { contentBucket: media.contentBucket, mediaBucket: media.mediaBucket, buildProjectName: 'awsug-site' });
    const tp = Template.fromStack(admin);
    const [s] = statementsOf(tp, 'Publish');
    assert.deepEqual(s!.Action.sort(), ['codebuild:BatchGetBuilds', 'codebuild:ListBuildsForProject', 'codebuild:StartBuild']);
    assert.match(JSON.stringify(s!.Resource), /project\/awsug-site/);
    tp.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ BUILD_PROJECT: 'awsug-site' }) } });
  });

  it('every function knows the bucket names and enables source maps', () => {
    for (const [id, f] of Object.entries(t.findResources('AWS::Lambda::Function'))) {
      if (!NAMES.some((n) => id.startsWith(n))) continue;
      const vars = (f as any).Properties.Environment.Variables;
      assert.ok(vars.CONTENT_BUCKET && vars.MEDIA_BUCKET, id);
      assert.equal(vars.NODE_OPTIONS, '--enable-source-maps');
    }
  });
});
