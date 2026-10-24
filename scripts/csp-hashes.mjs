// Post-build: finds every executable inline <script> in dist/, hashes it for the CloudFront
// Content-Security-Policy (script-src 'sha256-...'), and fails on anything a strict CSP would block
// (inline style= attributes, <style> blocks, inline event handlers).
// Output: csp-hashes.json at the repo root, read by the CDK Site stack in Phase 3.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}

const hashes = new Map(); // hash -> first page
const problems = [];
let pages = 0;

for (const file of htmlFiles(dist)) {
  pages++;
  const page = relative(dist, file);
  const html = readFileSync(file, 'utf8');

  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue; // external: covered by 'self'
    if (/type\s*=\s*["']application\/(ld\+)?json["']/i.test(attrs)) continue; // data block, never executed
    const hash = 'sha256-' + createHash('sha256').update(m[2], 'utf8').digest('base64');
    if (!hashes.has(hash)) hashes.set(hash, page);
  }
  if (/<style\b/i.test(html)) problems.push(`${page}: inline <style> block`);
  if (/\sstyle\s*=\s*["']/i.test(html)) problems.push(`${page}: inline style="" attribute`);
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) problems.push(`${page}: inline event handler attribute`);
}

writeFileSync(new URL('../csp-hashes.json', import.meta.url), JSON.stringify({ scriptHashes: [...hashes.keys()], pages }, null, 2) + '\n');
console.log(`csp-hashes: ${pages} pages, ${hashes.size} distinct inline script hash(es) written to csp-hashes.json`);
for (const [h, page] of hashes) console.log(`  '${h}'  (first seen on ${page})`);

if (problems.length) {
  console.error(`\nCSP blockers found (${problems.length}):`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  process.exit(1);
}
