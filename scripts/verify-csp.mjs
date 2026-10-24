// Run by the publish build (buildspec.yml) before anything is uploaded.
//
// CloudFront's Content-Security-Policy was deployed with the SHA-256 of the site's one inline script (the theme
// bootstrap). If the script has changed since, every page would load with a policy that blocks it. Better to
// stop here, with a clear message, than to publish a site whose dark-mode toggle silently breaks.
//
//   EXPECTED_CSP_HASHES="sha256-...,sha256-..." node scripts/verify-csp.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Returns problems, or an empty array when the built site's hashes are exactly the deployed ones. */
export function compareHashes(actual, expected) {
  const a = new Set(actual);
  const e = new Set(expected);
  const problems = [];
  const missing = [...a].filter((h) => !e.has(h));
  const extra = [...e].filter((h) => !a.has(h));
  if (missing.length) problems.push(`The built site has inline script(s) the deployed CSP does not allow: ${missing.map((h) => `'${h}'`).join(', ')}`);
  if (extra.length) problems.push(`The deployed CSP allows script(s) the built site no longer has: ${extra.map((h) => `'${h}'`).join(', ')}`);
  return problems;
}

export function parseExpected(value) {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = fileURLToPath(new URL('../csp-hashes.json', import.meta.url));
  const { scriptHashes } = JSON.parse(readFileSync(file, 'utf8'));
  const expectedRaw = process.env.EXPECTED_CSP_HASHES;
  if (expectedRaw === undefined) {
    console.log('verify-csp: EXPECTED_CSP_HASHES is not set, skipping (local build).');
  } else {
    const problems = compareHashes(scriptHashes, parseExpected(expectedRaw));
    if (problems.length) {
      console.error('verify-csp: the site was NOT published.\n  ' + problems.join('\n  '));
      console.error('  Fix: redeploy the Site stack (cd infra && npx cdk deploy AwsugSite) so its CSP matches this build, then publish again.');
      process.exit(1);
    }
    console.log(`verify-csp: ok (${scriptHashes.length} inline script hash(es) match the deployed CSP).`);
  }
}
