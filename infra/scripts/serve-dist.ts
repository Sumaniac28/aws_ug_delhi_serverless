// Serves ../dist the way CloudFront will: the real viewer-request function decides routing, and the real
// security headers (including the CSP built from csp-hashes.json) are attached to every response.
// Use it to check that the strict CSP does not break the site before deploying:
//   npm run build            (in the repo root)
//   npm run serve:dist       (in infra/)   ->  http://localhost:4400
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsp, loadScriptHashes } from '../lib/csp.ts';
import { renderViewerRequest } from '../lib/viewer-request.ts';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 4400);
const handler = new Function(`${renderViewerRequest()}; return handler;`)() as (e: any) => any;
const csp = buildCsp(loadScriptHashes());

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml',
  '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.ics': 'text/calendar', '.webp': 'image/webp', '.png': 'image/png',
};

const securityHeaders = {
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const request = {
    uri: decodeURIComponent(url.pathname),
    headers: { host: { value: req.headers.host ?? '' } },
    querystring: Object.fromEntries([...url.searchParams].map(([k, v]) => [k, { value: v }])),
  };
  const out = handler({ request });

  if (out.statusCode) {
    res.writeHead(out.statusCode, { Location: out.headers.location.value, ...securityHeaders });
    return res.end();
  }

  let file = normalize(join(dist, out.uri));
  let status = 200;
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(dist, '404.html'); // CloudFront maps S3's 403/404 to this page with a 404 status
    status = 404;
  }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...securityHeaders });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`Serving dist/ with production headers at http://localhost:${port}`));
