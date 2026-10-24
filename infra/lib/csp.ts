import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_HASH_FILE = fileURLToPath(new URL('../../csp-hashes.json', import.meta.url));

/**
 * Reads the inline-script hashes that `npm run build` writes to csp-hashes.json (scripts/csp-hashes.mjs).
 * Failing here, rather than guessing, means a CSP that blocks the theme script can never ship.
 */
export function loadScriptHashes(file = DEFAULT_HASH_FILE): string[] {
  if (!existsSync(file)) {
    throw new Error(`${file} not found. Run "npm run build" in the repo root first; it writes the inline-script hashes the CSP needs.`);
  }
  const { scriptHashes } = JSON.parse(readFileSync(file, 'utf8')) as { scriptHashes: string[] };
  for (const h of scriptHashes) {
    if (!/^sha256-[A-Za-z0-9+/]+=*$/.test(h)) throw new Error(`Malformed CSP hash in ${file}: ${h}`);
  }
  return scriptHashes;
}

/** The strict policy from DESIGN.md / ADR-002: no inline styles, one hashed inline script, nothing third-party. */
export function buildCsp(scriptHashes: string[]): string {
  const script = ["'self'", ...scriptHashes.map((h) => `'${h}'`)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
