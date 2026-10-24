import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderViewerRequest } from '../lib/viewer-request.ts';

type Req = { uri: string; headers: Record<string, { value: string }>; querystring: Record<string, { value: string; multiValue?: { value: string }[] }> };

function run(source: string, uri: string, host = 'example.org', querystring: Req['querystring'] = {}) {
  const handler = new Function(`${source}; return handler;`)() as (e: { request: Req }) => any;
  return handler({ request: { uri, headers: { host: { value: host } }, querystring } });
}
const loc = (res: any) => res.headers.location.value as string;

describe('viewer-request function', () => {
  const canonical = renderViewerRequest({ canonicalHost: 'example.org', redirects: { '/acd2024': '/events/2024/community-day-2024/' } });
  const noDomain = renderViewerRequest();

  it('rewrites directory URLs to index.html', () => {
    assert.equal(run(canonical, '/').uri, '/index.html');
    assert.equal(run(canonical, '/events/2026/foo/').uri, '/events/2026/foo/index.html');
  });

  it('301s slashless page URLs to the trailing-slash URL, keeping the query string', () => {
    const res = run(canonical, '/events/2026/foo', 'example.org', { ref: { value: 'x' } });
    assert.equal(res.statusCode, 301);
    assert.equal(loc(res), 'https://example.org/events/2026/foo/?ref=x');
  });

  it('passes files with an extension straight through', () => {
    for (const uri of ['/_astro/a.B79iSqc4.css', '/robots.txt', '/sitemap-index.xml', '/events/2026/foo/event.ics', '/media/events/x/poster-480.webp', '/404.html']) {
      assert.equal(run(canonical, uri).uri, uri, uri);
    }
  });

  it('redirects any other host to the canonical host (www, cloudfront.net)', () => {
    for (const host of ['www.example.org', 'd111111abcdef8.cloudfront.net']) {
      const res = run(canonical, '/about/', host);
      assert.equal(res.statusCode, 301);
      assert.equal(loc(res), 'https://example.org/about/');
    }
  });

  it('applies old-route redirects in a single hop, with or without a trailing slash', () => {
    assert.equal(loc(run(canonical, '/acd2024')), 'https://example.org/events/2024/community-day-2024/');
    assert.equal(loc(run(canonical, '/acd2024/', 'www.example.org')), 'https://example.org/events/2024/community-day-2024/');
  });

  it('does no host redirect without a custom domain, and uses the request host for slash redirects', () => {
    assert.equal(run(noDomain, '/events/', 'd111.cloudfront.net').uri, '/events/index.html');
    assert.equal(loc(run(noDomain, '/events', 'd111.cloudfront.net')), 'https://d111.cloudfront.net/events/');
  });

  it('refuses unsafe hosts and relative redirect targets at synth time', () => {
    assert.throws(() => renderViewerRequest({ canonicalHost: "x';alert(1);//" }));
    assert.throws(() => renderViewerRequest({ redirects: { '/a': 'https://evil.example/' } }));
  });

  it('leaves no unfilled placeholders and stays ES5-style safe for CloudFront', () => {
    assert.ok(!/__[A-Z_]+__/.test(canonical));
    assert.ok(!/=>|\blet\b|\bconst\b|`/.test(canonical.replace(/\/\/.*$/gm, '')), 'uses only constructs CloudFront JS 2.0 handles');
  });
});
