import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Config } from '../lib/config.ts';
import { loadRedirects } from '../lib/redirects.ts';
import { createStacks } from '../lib/stacks.ts';
import { renderViewerRequest } from '../lib/viewer-request.ts';

const FILE = fileURLToPath(new URL('../redirects.json', import.meta.url));
const { redirects: ENTRIES } = JSON.parse(readFileSync(FILE, 'utf8')) as { redirects: { from: string; to: string }[] };
const HOST = 'example.org';

function run(source: string, uri: string, host = HOST) {
  const handler = new Function(`${source}; return handler;`)() as (e: any) => any;
  return handler({ request: { uri, headers: { host: { value: host } }, querystring: {} } });
}

describe('old-site redirects (infra/redirects.json)', () => {
  const source = renderViewerRequest({ canonicalHost: HOST, redirects: loadRedirects() });

  it('covers every route the old React site served', () => {
    const froms = ENTRIES.map((e) => e.from.toLowerCase());
    for (const old of ['/acd2024', '/gameday2025', '/astutedev', '/awsmeetup', '/awssecurityhub', '/innovateaws', '/agenticaiaws', '/reinventrecap', '/reimaginingcli', '/wit2025', '/sponsorship', '/dipali_kulshrestha']) {
      assert.ok(froms.includes(old), `missing ${old}`);
    }
  });

  it('sends each old URL to its new home with one permanent redirect, in any capitalisation and with or without a slash', () => {
    for (const { from, to } of ENTRIES) {
      for (const variant of [from, from.toLowerCase(), from.toUpperCase(), `${from}/`]) {
        const res = run(source, variant);
        assert.equal(res.statusCode, 301, variant);
        assert.equal(res.headers.location.value, `https://${HOST}${to}`, variant);
      }
    }
  });

  it('does it in one hop even from www or the cloudfront.net name', () => {
    const res = run(source, '/acd2024', 'www.example.org');
    assert.equal(res.headers.location.value, 'https://example.org/events/2024/community-day-delhi-2024/');
  });

  it('never redirects a page that exists on the new site (that would be a loop or a lost page)', () => {
    for (const uri of ['/', '/events/', '/events', '/events/past/', '/about/', '/blog/', '/sponsors/', '/speakers/', '/community-day/', '/events/2025/game-day-gen-ai/']) {
      const res = run(source, uri);
      const loc = res.headers?.location?.value as string | undefined;
      // Allowed: normal serving, or the generic add-a-slash redirect. Never one of the old-route entries.
      assert.ok(!ENTRIES.some((e) => loc === `https://${HOST}${e.to}` && uri.replace(/\/$/, '') !== e.to.replace(/\/$/, '')), `${uri} -> ${loc}`);
    }
    for (const { to } of ENTRIES) assert.equal(run(source, to).uri ?? run(source, to).statusCode, to + 'index.html', `${to} must be served, not redirected`);
  });

  it('points only at the shapes the new site has: an event page, sponsors or about', () => {
    for (const { to } of ENTRIES) assert.match(to, /^\/(events\/\d{4}\/[a-z0-9]+(-[a-z0-9]+)*\/|sponsors\/|about\/)$/, to);
  });

  it('gives every migrated event an id that fits the 80-character limit', () => {
    for (const { to } of ENTRIES) {
      const id = to.match(/^\/events\/\d{4}\/([^/]+)\/$/)?.[1];
      if (id) assert.ok(id.length <= 80, id);
    }
  });
});

describe('redirect file validation', () => {
  const load = (entries: { from: string; to: string }[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'redir-'));
    const f = join(dir, 'r.json');
    writeFileSync(f, JSON.stringify({ redirects: entries }));
    return loadRedirects(f);
  };

  it('lowercases sources and drops trailing slashes', () => {
    assert.deepEqual(load([{ from: '/ACD2024/', to: '/events/2024/x/' }]), { '/acd2024': '/events/2024/x/' });
  });
  it('rejects duplicates that differ only by case', () => {
    assert.throws(() => load([{ from: '/Foo', to: '/a/' }, { from: '/foo', to: '/b/' }]), /twice/);
  });
  it('rejects loops and chains', () => {
    assert.throws(() => load([{ from: '/a', to: '/b/' }, { from: '/b', to: '/a/' }]), /chain or loop/);
    assert.throws(() => load([{ from: '/a', to: '/a/' }]), /chain or loop/);
  });
  it('rejects targets that leave the site or lack a trailing slash', () => {
    assert.throws(() => load([{ from: '/a', to: 'https://evil.example/' }]), /target/);
    assert.throws(() => load([{ from: '/a', to: '/events/2024/x' }]), /target/);
  });
  it('rejects odd sources', () => {
    assert.throws(() => load([{ from: 'events', to: '/x/' }]), /source/);
    assert.throws(() => load([{ from: '/a b', to: '/x/' }]), /source/);
  });
});

describe('deployed function', () => {
  it('carries the redirect map', () => {
    const app = new App();
    app.node.setContext('aws:cdk:bundling-stacks', []);
    const config: Config = { region: 'ap-south-1', account: '123456789012', wwwRedirect: false, adminOrigins: [], githubBranch: 'main' };
    const s = createStacks(app, config, { scriptHashes: ['sha256-8IykBE61QzApYKkpPepGwi55OP1gRPPaf1D1vbjGk0Q='], adminAssets: s3deploy.Source.data('index.html', '<html></html>'), resizeCode: lambda.Code.fromInline('exports.handler = async () => {}') });
    const fn: any = Object.values(Template.fromStack(s.site).findResources('AWS::CloudFront::Function'))[0];
    assert.match(fn.Properties.FunctionCode, /"\/awssecurityhub":"\/events\/2023\/aws-security-hub-workshop\/"/);
    assert.ok(fn.Properties.FunctionCode.length < 10_000, 'CloudFront Functions are limited to 10 KB');
  });
});
