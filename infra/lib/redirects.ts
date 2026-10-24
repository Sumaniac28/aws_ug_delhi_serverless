import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../redirects.json', import.meta.url));

export interface Redirect {
  from: string;
  to: string;
  note?: string;
}

/**
 * Reads infra/redirects.json and returns the map the CloudFront function uses. Keys are lowercased and have no
 * trailing slash, because the function matches that way (the old site linked to /reInventRecap and /reimaginingcli
 * alike). Anything that could send a visitor in a loop or off the site is refused here, at synth time.
 */
export function loadRedirects(file = FILE): Record<string, string> {
  const { redirects } = JSON.parse(readFileSync(file, 'utf8')) as { redirects: Redirect[] };
  const map: Record<string, string> = {};
  for (const { from, to } of redirects) {
    if (!/^\/[A-Za-z0-9_\-./]+$/.test(from)) throw new Error(`Redirect source must be a plain absolute path: ${from}`);
    if (!/^\/[a-z0-9\-/]*\/$/.test(to) && to !== '/') throw new Error(`Redirect target must be an absolute, lowercase path ending in "/": ${to}`);
    const key = from.toLowerCase().replace(/\/$/, '');
    if (key in map) throw new Error(`Redirect source appears twice (matching ignores case): ${from}`);
    map[key] = to;
  }
  for (const [from, to] of Object.entries(map)) {
    if (map[to.replace(/\/$/, '').toLowerCase()] !== undefined) throw new Error(`Redirect chain or loop: ${from} -> ${to}`);
  }
  return map;
}
