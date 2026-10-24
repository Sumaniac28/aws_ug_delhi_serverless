import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATE = fileURLToPath(new URL('../functions/viewer-request.js', import.meta.url));

export interface ViewerRequestOptions {
  /** Canonical host. Omit for no host redirect (default cloudfront.net domain). */
  canonicalHost?: string;
  /** Exact old path -> new path. Added in Phase 7 for the previous site's routes. */
  redirects?: Record<string, string>;
}

/** Renders the CloudFront Function source with this deployment's values substituted in. */
export function renderViewerRequest({ canonicalHost = '', redirects = {} }: ViewerRequestOptions = {}): string {
  if (canonicalHost && !/^[a-z0-9.-]+$/i.test(canonicalHost)) throw new Error(`Unsafe canonical host: ${canonicalHost}`);
  for (const [from, to] of Object.entries(redirects)) {
    if (!from.startsWith('/') || !to.startsWith('/')) throw new Error(`Redirects must be absolute paths: ${from} -> ${to}`);
  }
  // The function looks paths up lowercased and without a trailing slash.
  const normalized = Object.fromEntries(Object.entries(redirects).map(([from, to]) => [from.toLowerCase().replace(/\/$/, ''), to]));
  return readFileSync(TEMPLATE, 'utf8')
    .replace('__CANONICAL_HOST__', () => canonicalHost)
    .replace('__REDIRECTS__', () => JSON.stringify(normalized));
}
