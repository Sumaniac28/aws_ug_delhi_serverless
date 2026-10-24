import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { parse } from 'yaml';
import { loadConfig, type Config } from '../lib/config.ts';
import { createStacks } from '../lib/stacks.ts';
// @ts-expect-error plain ES module without type declarations
import { compareHashes, parseExpected } from '../../scripts/verify-csp.mjs';

const HASH = 'sha256-8IykBE61QzApYKkpPepGwi55OP1gRPPaf1D1vbjGk0Q=';
const config: Config = { region: 'ap-south-1', account: '123456789012', wwwRedirect: false, adminOrigins: [], githubBranch: 'main', githubRepo: { owner: 'awsug-delhi-ncr', repo: 'website' } };

function build(c: Config = config) {
  const app = new App();
  app.node.setContext('aws:cdk:bundling-stacks', []);
  const s = createStacks(app, c, { scriptHashes: [HASH], adminAssets: s3deploy.Source.data('index.html', '<html></html>'), resizeCode: lambda.Code.fromInline('exports.handler = async () => {}') });
  return { ...s, b: s.build ? Template.fromStack(s.build) : (undefined as unknown as Template), admin: Template.fromStack(s.admin) };
}

const statementsOf = (t: Template, rolePrefix: string): { Action: string[]; Resource: unknown; Sid?: string; Condition?: unknown }[] => {
  const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) => id.startsWith(rolePrefix));
  assert.ok(policies.length, `a policy for ${rolePrefix}`);
  return policies.flatMap(([, p]: any) => p.Properties.PolicyDocument.Statement.map((s: any) => ({ ...s, Action: [s.Action].flat() })));
};

describe('the publish build', () => {
  const { b } = build();

  it('runs buildspec.yml from the repository, one build at a time, on small ARM Linux with a time limit', () => {
    b.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: 'awsug-site',
      Source: Match.objectLike({ Type: 'GITHUB', Location: 'https://github.com/awsug-delhi-ncr/website.git', BuildSpec: 'buildspec.yml' }),
      ConcurrentBuildLimit: 1,
      TimeoutInMinutes: 20,
      QueuedTimeoutInMinutes: 30,
      Environment: Match.objectLike({ Type: 'ARM_CONTAINER', ComputeType: 'BUILD_GENERAL1_SMALL', Image: Match.stringLikeRegexp('aarch64-standard:3.0') }),
    });
  });

  it('is told where everything is, including the CSP hashes it must match', () => {
    const project: any = Object.values(b.findResources('AWS::CodeBuild::Project'))[0];
    const vars = Object.fromEntries(project.Properties.Environment.EnvironmentVariables.map((v: any) => [v.Name, v.Value]));
    for (const k of ['CONTENT_BUCKET', 'SITE_BUCKET', 'DISTRIBUTION_ID', 'SITE_URL']) assert.ok(vars[k], k);
    assert.equal(vars.EXPECTED_CSP_HASHES, HASH);
  });

  it('keeps its logs two weeks', () => {
    b.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });

  it('has exactly the permissions publishing needs: read content, replace site files, clear the cache', () => {
    const s = statementsOf(b, 'SiteBuildRoleDefaultPolicy');
    const bySid = Object.fromEntries(s.filter((x) => x.Sid).map((x) => [x.Sid!, x]));
    assert.deepEqual(bySid.ReadContent!.Action, ['s3:GetObject']);
    assert.match(JSON.stringify(bySid.ReadContent!.Resource), /content\/\*/);
    assert.deepEqual(bySid.PublishSite!.Action.sort(), ['s3:DeleteObject', 's3:PutObject']);
    assert.deepEqual(bySid.ClearCache!.Action, ['cloudfront:CreateInvalidation']);
    assert.match(JSON.stringify(bySid.ClearCache!.Resource), /distribution\//);
    // It can never write content, and never delete the content history.
    const all = s.flatMap((x) => x.Action);
    assert.ok(!all.includes('s3:PutObject') || JSON.stringify(bySid.PublishSite!.Resource).includes('SiteBucket'));
    for (const a of all) assert.ok(a !== '*' && !a.endsWith(':*') && a !== 's3:DeleteObjectVersion', a);
    assert.doesNotMatch(JSON.stringify(bySid.PublishSite!.Resource), /ContentBucket|MediaBucket/);
  });
});

describe('the schedules', () => {
  const { b } = build();

  it('keeps per-event jobs in their own group', () => {
    b.hasResourceProperties('AWS::Scheduler::ScheduleGroup', { Name: 'awsug-events' });
  });

  it('runs a nightly rebuild at 00:17 India time that starts the build', () => {
    b.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'awsug-nightly-rebuild',
      GroupName: 'awsug-events',
      ScheduleExpression: 'cron(17 0 * * ? *)',
      ScheduleExpressionTimezone: 'Asia/Kolkata',
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: 'ENABLED',
      Target: Match.objectLike({ Arn: 'arn:aws:scheduler:::aws-sdk:codebuild:startBuild', RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 } }),
    });
    const sched: any = Object.values(b.findResources('AWS::Scheduler::Schedule'))[0];
    assert.match(JSON.stringify(sched.Properties.Target.Input), /ProjectName/);
  });

  it('lets only EventBridge Scheduler, only for jobs in this group, start the build, and only that', () => {
    const role: any = Object.entries(b.findResources('AWS::IAM::Role')).find(([id]) => id.startsWith('SchedulerRole'))![1];
    const [trust] = role.Properties.AssumeRolePolicyDocument.Statement;
    assert.deepEqual(trust.Principal, { Service: 'scheduler.amazonaws.com' });
    assert.ok(trust.Condition.StringEquals['aws:SourceAccount'], 'limited to this account');
    assert.match(JSON.stringify(trust.Condition.StringLike['aws:SourceArn']), /schedule\/awsug-events\/\*/, 'limited to jobs in this group');
    const s = statementsOf(b, 'SchedulerRoleDefaultPolicy');
    assert.equal(s.length, 1);
    assert.deepEqual(s[0]!.Action, ['codebuild:StartBuild']);
  });
});

describe('Publish and saving are wired to it', () => {
  const { admin } = build();
  const env = (t: Template, fn: string) => {
    const [, f]: any = Object.entries(t.findResources('AWS::Lambda::Function')).find(([id]) => id.startsWith(fn))!;
    return f.Properties.Environment.Variables as Record<string, unknown>;
  };

  it('Publish knows the project and may start and inspect builds of that project only', () => {
    assert.ok(env(admin, 'Publish').BUILD_PROJECT);
    const s = statementsOf(admin, 'PublishServiceRoleDefaultPolicy');
    assert.deepEqual(s[0]!.Action.sort(), ['codebuild:BatchGetBuilds', 'codebuild:ListBuildsForProject', 'codebuild:StartBuild']);
    const arn = JSON.stringify(s[0]!.Resource);
    assert.match(arn, /:codebuild:ap-south-1:123456789012:project\//);
    assert.match(arn, /ImportValue/, "refers to the Build stack's project, so it cannot be deployed before it exists");
  });

  it('Save may create, move and remove end-of-event jobs, only under the awsug-end- prefix, and hand over only the scheduler role', () => {
    const s = statementsOf(admin, 'SaveServiceRoleDefaultPolicy');
    const jobs = s.find((x) => x.Sid === 'ManageEndJobs')!;
    assert.deepEqual(jobs.Action.sort(), ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule', 'scheduler:UpdateSchedule']);
    assert.match(JSON.stringify(jobs.Resource), /schedule\/awsug-events\/awsug-end-\*/);
    const pass = s.find((x) => x.Sid === 'HandRoleToScheduler')!;
    assert.deepEqual(pass.Action, ['iam:PassRole']);
    assert.match(JSON.stringify(pass.Condition), /scheduler\.amazonaws\.com/);
    const e = env(admin, 'Save');
    assert.ok(e.SCHEDULE_GROUP && e.SCHEDULER_ROLE_ARN && e.BUILD_PROJECT);
  });

  it('Delete may only remove those jobs', () => {
    const s = statementsOf(admin, 'DeleteServiceRoleDefaultPolicy');
    const jobs = s.find((x) => x.Sid === 'RemoveEndJobs')!;
    assert.deepEqual(jobs.Action, ['scheduler:DeleteSchedule']);
    assert.ok(!s.some((x) => x.Action.includes('iam:PassRole')));
  });

  it('nothing else can touch jobs, the group or the nightly rebuild', () => {
    for (const fn of ['List', 'Get', 'SignUpload', 'Publish']) {
      const found = Object.entries(admin.findResources('AWS::IAM::Policy')).filter(([id]) => id.startsWith(`${fn}ServiceRoleDefaultPolicy`));
      for (const [, p] of found as any) assert.ok(!JSON.stringify(p).includes('scheduler:'), fn);
    }
  });
});

describe('without a GitHub repository', () => {
  const noRepo = build({ ...config, githubRepo: undefined } as Config);
  it('creates no build, and Publish and scheduling stay off (the admin still works)', () => {
    assert.equal(noRepo.build, undefined);
    const fn: any = Object.entries(noRepo.admin.findResources('AWS::Lambda::Function')).find(([id]) => id.startsWith('Publish'))![1];
    assert.equal(fn.Properties.Environment.Variables.BUILD_PROJECT, undefined);
  });
});

describe('config', () => {
  const load = (ctx: Record<string, string>) => loadConfig(new App({ context: ctx }));
  it('reads owner/repo and defaults the branch to main', () => {
    assert.deepEqual(load({ githubRepo: 'awsug-delhi-ncr/website' }).githubRepo, { owner: 'awsug-delhi-ncr', repo: 'website' });
    assert.equal(load({ githubRepo: 'a/b' }).githubBranch, 'main');
    assert.equal(load({ githubRepo: 'a/b', githubBranch: 'release' }).githubBranch, 'release');
  });
  it('rejects anything that is not owner/repo', () => {
    for (const bad of ['website', 'a/b/c', 'https://github.com/a/b', 'a b/c']) assert.throws(() => load({ githubRepo: bad }), /owner\/repo/, bad);
  });
});

describe('buildspec.yml', () => {
  const spec = parse(readFileSync(fileURLToPath(new URL('../../buildspec.yml', import.meta.url)), 'utf8'));
  const cmds = (phase: string) => (spec.phases[phase].commands as string[]).join('\n');

  it('uses Node 22 and installs from the lockfile', () => {
    assert.equal(spec.phases.install['runtime-versions'].nodejs, 22);
    assert.match(cmds('install'), /npm ci/);
  });

  it('stops before uploading anything if any earlier step fails (the live site is untouched)', () => {
    assert.equal(spec.phases.pre_build['on-failure'], 'ABORT');
    assert.equal(spec.phases.build['on-failure'], 'ABORT');
    assert.equal(spec.phases.post_build, undefined, 'post_build runs even after a failed build, so nothing is deployed from it');
  });

  it('pulls the five content collections from the content bucket', () => {
    for (const c of ['events', 'speakers', 'sponsors', 'organizers', 'posts']) assert.match(cmds('pre_build'), new RegExp(c));
    assert.match(cmds('pre_build'), /aws s3 sync "s3:\/\/\$CONTENT_BUCKET\/content\/\$c"/);
  });

  it('validates and builds, then checks the CSP, then uploads assets, then pages, then clears the cache', () => {
    const b = cmds('build');
    const order = ['npm run build', 'verify-csp.mjs', 'dist/_astro', 'aws s3 sync dist "s3://$SITE_BUCKET" --delete', 'create-invalidation'].map((s) => b.indexOf(s));
    assert.ok(order.every((i) => i >= 0), `missing step: ${order}`);
    assert.deepEqual([...order].sort((x, y) => x - y), order, 'steps are in order');
  });

  it('caches hashed assets for a year and pages for five minutes', () => {
    const b = cmds('build');
    assert.match(b, /_astro.*max-age=31536000,immutable/);
    assert.match(b, /--exclude "_astro\/\*" --cache-control "public,max-age=300"/);
  });

  it('keeps the site\'s timezone-sensitive code on Indian time', () => {
    assert.equal(spec.env.variables.TZ, 'Asia/Kolkata');
  });
});

describe('verify-csp', () => {
  it('passes when the built hashes are exactly the deployed ones', () => assert.deepEqual(compareHashes(['sha256-a='], ['sha256-a=']), []));
  it('blocks publishing when the script changed (a stale CSP would break every page)', () => {
    const problems = compareHashes(['sha256-new='], ['sha256-old=']);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /does not allow: 'sha256-new='/);
  });
  it('flags an inline script that disappeared too', () => assert.equal(compareHashes([], ['sha256-old=']).length, 1));
  it('parses the environment list', () => assert.deepEqual(parseExpected(' sha256-a= , sha256-b=,, '), ['sha256-a=', 'sha256-b=']));
});
