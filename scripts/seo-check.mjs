// SEO audit of the BUILT site (dist/). Runs after every build (npm run build -> postbuild), so a page that would
// hurt search results fails the build before anything is published. Covers the P0/P1 list in ADR-002:
// titles and descriptions, canonical URLs, link previews, structured data, images, internal links,
// sitemap, robots.txt and the feed, plus old-route redirect targets.
//
//   node scripts/seo-check.mjs          errors fail the run (exit 1); warnings are printed
//   SEO_STRICT_REDIRECTS=1 ...          also fail when an old-route redirect points at a page that does not exist
//   SEO_LAUNCH=1 ...                    the pre-launch gate: strict redirects, plus no unconfirmed facts, sample content or placeholder domain
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'node-html-parser';

const OFFSET = /[+-]\d\d:\d\d$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** '/events/past/' for dist/events/past/index.html, '/' for dist/index.html. */
const pagePath = (dist, file) => {
  const rel = relative(dist, file).split(sep).join('/');
  return rel === 'index.html' ? '/' : `/${rel.replace(/index\.html$/, '')}`;
};

/** Does this site path exist in dist as a file, or as a directory with an index page? */
const exists = (dist, path) => {
  const p = decodeURIComponent(path.split('#')[0].split('?')[0]);
  const f = join(dist, p);
  return existsSync(f) && (statSync(f).isFile() || existsSync(join(f, 'index.html')));
};

function pngSize(file) {
  const b = readFileSync(file);
  return b.slice(1, 4).toString() === 'PNG' ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
}

// Text that means content or configuration was never finished. Unconfirmed facts only warn (they are listed by
// npm run migrate:status); in launch mode everything here fails the build.
const UNCONFIRMED = /Address to be confirmed|\bTBC\b|to be confirmed/i;
const PLACEHOLDER = /example\.org|awsug-delhi-ncr\.example|\bSample (Speaker|Organizer|Venue)|Placeholder (bio|sponsor|content)/i;

export function auditSite(dist, { strictRedirects = false, launch = false, redirectsFile } = {}) {
  strictRedirects ||= launch;
  const seenPlaceholders = new Set();
  const errors = [];
  const warnings = [];
  const err = (page, msg) => errors.push(`${page}: ${msg}`);
  const warn = (page, msg) => warnings.push(`${page}: ${msg}`);

  const pages = [...walk(dist)].filter((f) => f.endsWith('.html'));
  const titles = new Map();
  const descriptions = new Map();
  const urls = new Set();
  let origin;

  for (const file of pages) {
    const path = pagePath(dist, file);
    const is404 = path === '/404.html';
    const html = readFileSync(file, 'utf8');
    const root = parse(html);
    const meta = (sel) => root.querySelector(sel)?.getAttribute('content') ?? undefined;

    // --- robots
    const robots = meta('meta[name="robots"]');
    if (is404) {
      if (!/noindex/.test(robots ?? '')) warn(path, 'the 404 page should be noindex');
      continue;
    }
    if (/noindex/.test(robots ?? '')) err(path, 'is marked noindex but is a public page');
    urls.add(path);

    // --- unfinished content or configuration
    const unfinished = html.match(UNCONFIRMED)?.[0];
    if (unfinished) (launch ? err : warn)(path, `contains unconfirmed text ("${unfinished}"); see npm run migrate:status`);
    const placeholder = html.match(PLACEHOLDER)?.[0];
    if (placeholder && launch && !seenPlaceholders.has(placeholder.toLowerCase())) {
      seenPlaceholders.add(placeholder.toLowerCase());
      err(path, `contains placeholder text or a placeholder domain ("${placeholder}", first seen here; there may be more pages); set SITE_URL and replace sample content`);
    }

    // --- language, title, description, headings
    if (root.querySelector('html')?.getAttribute('lang') !== 'en-IN') err(path, '<html lang> should be "en-IN"');
    // Only the document title: inline SVGs may carry their own <title> as an accessible name.
    const titleEls = root.querySelectorAll('head title');
    const title = titleEls[0]?.text.trim() ?? '';
    if (titleEls.length !== 1 || !title) err(path, `needs exactly one non-empty <title> (found ${titleEls.length})`);
    else {
      // A warning, not an error: two events can legitimately share a name, and a content slip must not block publishing.
      if (titles.has(title)) warn(path, `title "${title}" is also used on ${titles.get(title)}`);
      titles.set(title, path);
      if (title.length > 70) warn(path, `title is ${title.length} characters; search results cut it near 60`);
    }
    const description = meta('meta[name="description"]');
    if (!description) err(path, 'missing meta description');
    else {
      if (description.length > 160) err(path, `meta description is ${description.length} characters (limit 160)`);
      else if (description.length < 50) warn(path, `meta description is only ${description.length} characters`);
      if (descriptions.has(description)) warn(path, `same description as ${descriptions.get(description)}`);
      descriptions.set(description, path);
    }
    const h1s = root.querySelectorAll('h1').length;
    if (h1s !== 1) err(path, `needs exactly one <h1> (found ${h1s})`);

    // --- canonical: absolute, https, this page, one origin across the site
    const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (!canonical) err(path, 'missing canonical link');
    else {
      let u;
      try {
        u = new URL(canonical);
      } catch {
        err(path, `canonical is not an absolute URL: ${canonical}`);
      }
      if (u) {
        origin ??= u.origin;
        if (u.protocol !== 'https:') err(path, 'canonical must be https');
        if (u.origin !== origin) err(path, `canonical origin ${u.origin} differs from ${origin}`);
        if (u.pathname !== path) err(path, `canonical path ${u.pathname} is not this page`);
        if (u.search || u.hash) err(path, 'canonical must not carry a query or fragment');
      }
    }

    // --- link previews
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type']) if (!meta(`meta[property="${p}"]`)) err(path, `missing ${p}`);
    if (!meta('meta[name="twitter:card"]')) err(path, 'missing twitter:card');
    if (meta('meta[property="og:url"]') !== canonical) err(path, 'og:url should equal the canonical URL');
    const ogImage = meta('meta[property="og:image"]');
    if (ogImage) {
      if (!/^https:\/\//.test(ogImage)) err(path, `og:image must be an absolute https URL: ${ogImage}`);
      const u = new URL(ogImage);
      if (u.origin === origin && !u.pathname.startsWith('/media/')) {
        if (!exists(dist, u.pathname)) err(path, `og:image ${u.pathname} was not built`);
        else if (u.pathname.endsWith('.png')) {
          const s = pngSize(join(dist, u.pathname));
          if (!s || s.width < 600) err(path, `og:image is smaller than 600px wide`);
        }
      }
    }

    // --- structured data
    const blocks = root.querySelectorAll('script[type="application/ld+json"]').flatMap((s) => {
      try {
        const j = JSON.parse(s.text);
        return j['@graph'] ?? [j];
      } catch {
        err(path, 'a JSON-LD block is not valid JSON');
        return [];
      }
    });
    const ofType = (t) => blocks.filter((b) => b['@type'] === t);
    const checkImageUrl = (url, what) => {
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) return err(path, `${what} must be an absolute https URL`);
      const u = new URL(url);
      if (u.origin === origin && !u.pathname.startsWith('/media/') && !exists(dist, u.pathname)) err(path, `${what} ${u.pathname} was not built`);
    };

    if (path === '/') {
      if (!ofType('Organization').length || !ofType('WebSite').length) err(path, 'the home page needs Organization and WebSite structured data');
      for (const org of ofType('Organization')) {
        for (const k of ['name', 'url', 'logo']) if (!org[k]) err(path, `Organization is missing ${k}`);
        if (org.logo) {
          checkImageUrl(org.logo, 'Organization logo');
          const lp = org.logo && new URL(org.logo).pathname;
          const s = lp && existsSync(join(dist, lp)) ? pngSize(join(dist, lp)) : null;
          if (!s || s.width < 112 || s.height < 112) err(path, 'Organization logo must be a raster image of at least 112x112');
        }
      }
    }

    if (/^\/events\/\d{4}\/[^/]+\/$/.test(path)) {
      const events = ofType('Event');
      if (events.length !== 1) err(path, `needs exactly one Event (found ${events.length})`);
      if (!ofType('BreadcrumbList').length) err(path, 'missing BreadcrumbList');
      for (const ev of events) {
        for (const k of ['name', 'startDate', 'endDate', 'location', 'eventStatus', 'eventAttendanceMode', 'organizer', 'description']) if (!ev[k]) err(path, `Event is missing ${k}`);
        for (const k of ['startDate', 'endDate']) if (ev[k] && !OFFSET.test(ev[k])) err(path, `Event ${k} needs an explicit UTC offset: ${ev[k]}`);
        if (ev.startDate && ev.endDate && Date.parse(ev.endDate) <= Date.parse(ev.startDate)) err(path, 'Event ends before it starts');
        const imgs = ev.image ?? [];
        if (!Array.isArray(imgs) || imgs.length < 1) err(path, 'Event needs at least one image (Google asks for 16:9, 4:3 and 1:1)');
        else imgs.forEach((u) => checkImageUrl(u, 'Event image'));
        const loc = [ev.location].flat();
        const place = loc.find((l) => l?.['@type'] === 'Place');
        if (ev.eventAttendanceMode !== 'https://schema.org/OnlineEventAttendanceMode' && !place) err(path, 'an in-person or hybrid Event needs a Place location');
        if (place) for (const k of ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode']) if (!place.address?.[k]) err(path, `Event address is missing ${k}`);
        if (ev.offers) {
          if (!/^https:\/\//.test(ev.offers.url ?? '')) err(path, 'Event offers.url must be an absolute https URL');
          if (ev.offers.price === undefined || ev.offers.priceCurrency !== 'INR') err(path, 'Event offers needs price and priceCurrency INR');
        }
        // Online join links must never be published anywhere in the page.
        if (/zoom\.us|meet\.google\.com|teams\.microsoft\.com|chime\.aws/i.test(JSON.stringify(ev))) err(path, 'structured data contains an online join link');
      }
    }

    if (/^\/blog\/[^/]+\/$/.test(path)) {
      const posts = ofType('BlogPosting');
      if (posts.length !== 1) err(path, `needs exactly one BlogPosting (found ${posts.length})`);
      for (const p of posts) for (const k of ['headline', 'datePublished', 'author', 'description']) if (!p[k]) err(path, `BlogPosting is missing ${k}`);
    }

    // --- images and links
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? '(no src)';
      if (img.getAttribute('alt') === undefined) err(path, `<img ${src}> has no alt attribute`);
      if (!img.getAttribute('width') || !img.getAttribute('height')) warn(path, `<img ${src}> has no width/height (layout shift)`);
    }
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (href.startsWith('/') && !href.startsWith('//')) {
        // Photos (/media/...) are served from the media bucket, not the build, so they cannot be checked here.
        if (!href.startsWith('/media/') && !exists(dist, href)) err(path, `broken internal link ${href}`);
      } else if (/^https?:\/\//.test(href) && a.getAttribute('target') === '_blank' && !/noopener/.test(a.getAttribute('rel') ?? '')) {
        err(path, `external link ${href} opens a new tab without rel="noopener"`);
      }
    }
  }

  // --- sitemap, robots.txt, feed
  const sitemapFile = join(dist, 'sitemap-0.xml');
  if (!existsSync(sitemapFile)) err('/sitemap-0.xml', 'was not built');
  else {
    const listed = new Set([...readFileSync(sitemapFile, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
    for (const u of urls) if (!listed.has(u)) err('sitemap', `${u} is a public page but is not in the sitemap`);
    for (const u of listed) if (!urls.has(u)) err('sitemap', `${u} is in the sitemap but is not a built page`);
  }
  if (!existsSync(join(dist, 'sitemap-index.xml'))) err('/sitemap-index.xml', 'was not built');
  const robots = existsSync(join(dist, 'robots.txt')) ? readFileSync(join(dist, 'robots.txt'), 'utf8') : '';
  if (!/User-agent:/i.test(robots) || !/Sitemap:\s*https:\/\/\S+\/sitemap-index\.xml/i.test(robots)) err('/robots.txt', 'must allow crawling and point at the sitemap index');
  if (/Disallow:\s*\/\s*$/m.test(robots)) err('/robots.txt', 'must not disallow the whole site');
  const rss = existsSync(join(dist, 'rss.xml')) ? readFileSync(join(dist, 'rss.xml'), 'utf8') : '';
  if (!/<rss[\s\S]*<channel>/.test(rss)) err('/rss.xml', 'the blog feed was not built');

  // --- old-route redirects: do their targets exist yet?
  if (redirectsFile && existsSync(redirectsFile)) {
    const { redirects } = JSON.parse(readFileSync(redirectsFile, 'utf8'));
    const missing = redirects.filter((r) => !exists(dist, r.to));
    for (const r of missing) (strictRedirects ? err : warn)(r.from, `old route redirects to ${r.to}, which this build does not contain${strictRedirects ? '' : ' (expected until the content is migrated)'}`);
  }

  return { errors, warnings, pageCount: urls.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const redirectsFile = fileURLToPath(new URL('../infra/redirects.json', import.meta.url));
  const { errors, warnings, pageCount } = auditSite(dist, { strictRedirects: process.env.SEO_STRICT_REDIRECTS === '1', launch: process.env.SEO_LAUNCH === '1', redirectsFile });
  console.log(`seo-check: ${pageCount} public page(s) audited, ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (warnings.length) console.log('  warnings:\n' + warnings.slice(0, 25).map((w) => `    - ${w}`).join('\n') + (warnings.length > 25 ? `\n    ... and ${warnings.length - 25} more` : ''));
  if (errors.length) {
    console.error('  errors (the site was NOT published):\n' + errors.slice(0, 40).map((e) => `    - ${e}`).join('\n') + (errors.length > 40 ? `\n    ... and ${errors.length - 40} more` : ''));
    process.exit(1);
  }
}
