// Proves the SEO audit actually fails on broken output, using a copy of the real build.
// Run with: npm run test:seo   (needs a build in dist/)
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import { auditSite } from './seo-check.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const REDIRECTS = fileURLToPath(new URL('../infra/redirects.json', import.meta.url));
const PAGE = 'events/2025/women-in-tech-2025/index.html';

describe('seo-check', () => {
  let work;
  const fresh = () => {
    rmSync(work, { recursive: true, force: true });
    cpSync(DIST, work, { recursive: true });
  };
  const edit = (file, fn) => writeFileSync(join(work, file), fn(readFileSync(join(work, file), 'utf8')));
  const audit = (opts) => auditSite(work, { redirectsFile: REDIRECTS, ...opts });
  const has = (res, re) => assert.ok(res.errors.some((e) => re.test(e)), `expected an error matching ${re}, got:\n${res.errors.join('\n')}`);

  before(() => {
    assert.ok(existsSync(join(DIST, 'index.html')), 'run npm run build first');
    work = mkdtempSync(join(tmpdir(), 'seo-'));
  });
  after(() => rmSync(work, { recursive: true, force: true }));

  it('passes on the real build', () => {
    fresh();
    assert.deepEqual(audit().errors, []);
  });

  it('fails when a page loses its description, canonical or h1', () => {
    fresh();
    edit('about/index.html', (h) => h.replace(/<meta name="description"[^>]*>/, ''));
    edit('contact/index.html', (h) => h.replace(/<link rel="canonical"[^>]*>/, ''));
    edit('privacy/index.html', (h) => h.replace(/<h1/g, '<h2').replace(/<\/h1>/g, '</h2>'));
    const r = audit();
    has(r, /\/about\/: missing meta description/);
    has(r, /\/contact\/: missing canonical/);
    has(r, /\/privacy\/: needs exactly one <h1>/);
  });

  it('fails on a canonical that points at another page, and on a stray noindex', () => {
    fresh();
    edit('about/index.html', (h) => h.replace(/(rel="canonical" href="https:\/\/[^/"]+)\/about\//, '$1/contact/'));
    edit('privacy/index.html', (h) => h.replace('<head>', '<head><meta name="robots" content="noindex">'));
    const r = audit();
    has(r, /\/about\/: canonical path/);
    has(r, /\/privacy\/: is marked noindex/);
  });

  it('fails when a link preview image is missing from the build', () => {
    fresh();
    rmSync(join(work, 'og/default/og.png'));
    has(audit(), /og:image \/og\/default\/og\.png was not built/);
  });

  it('fails on broken internal links and unsafe new-tab links', () => {
    fresh();
    edit('about/index.html', (h) => h.replace('</main>', '<a href="/nowhere/">x</a><a href="https://example.org/" target="_blank">y</a></main>'));
    const r = audit();
    has(r, /broken internal link \/nowhere\//);
    has(r, /without rel="noopener"/);
  });

  it('fails on event structured data without a UTC offset or without images', () => {
    fresh();
    edit(PAGE, (h) => h.replace(/("startDate":"[^"+Z]*)(\+05:30)"/, '$1"').replace(/"image":\[[^\]]*\],?/, ''));
    const r = audit();
    has(r, /Event startDate needs an explicit UTC offset/);
    has(r, /Event needs at least one image/);
  });

  it('fails on a page missing from the sitemap, and on a robots.txt without the sitemap', () => {
    fresh();
    edit('sitemap-0.xml', (x) => x.replace(/<url><loc>[^<]*\/about\/<\/loc>.*?<\/url>/, ''));
    writeFileSync(join(work, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    const r = audit();
    has(r, /\/about\/ is a public page but is not in the sitemap/);
    has(r, /robots\.txt: must allow crawling and point at the sitemap index/);
  });

  it('treats redirect targets that do not exist as warnings, and as errors in strict mode', () => {
    fresh();
    rmSync(join(work, 'events/2024/community-day-delhi-2024'), { recursive: true });
    const lax = audit();
    assert.ok(lax.warnings.some((w) => /acd2024/.test(w)));
    assert.ok(!lax.errors.some((e) => /old route redirects/.test(e)));
    has(audit({ strictRedirects: true }), /acd2024: old route redirects to/);
  });

  it('launch mode refuses unconfirmed facts and a placeholder domain, but a normal build only warns', () => {
    fresh();
    edit(PAGE, (h) => h.replace('</body>', '<p>Address to be confirmed</p></body>'));
    const normal = audit();
    assert.deepEqual(normal.errors, []);
    assert.ok(normal.warnings.some((w) => /unconfirmed text/.test(w)));
    const launch = audit({ launch: true });
    has(launch, /unconfirmed text/);
    has(launch, /placeholder domain/); // the test build uses the fallback SITE_URL
    assert.equal(launch.errors.filter((e) => /placeholder domain/.test(e)).length, 1, 'reported once, not once per page');
  });
});
