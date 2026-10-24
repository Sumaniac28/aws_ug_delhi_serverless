import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildCsp, loadScriptHashes } from '../lib/csp.ts';

const HASH = 'sha256-8IykBE61QzApYKkpPepGwi55OP1gRPPaf1D1vbjGk0Q=';

describe('csp', () => {
  it('allows only self and the listed inline-script hashes, no inline styles, no framing', () => {
    const csp = buildCsp([HASH]);
    assert.match(csp, new RegExp(`script-src 'self' '${HASH}'`));
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  });

  it('reads hashes from csp-hashes.json and validates them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-'));
    const ok = join(dir, 'ok.json');
    writeFileSync(ok, JSON.stringify({ scriptHashes: [HASH], pages: 1 }));
    assert.deepEqual(loadScriptHashes(ok), [HASH]);

    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ scriptHashes: ["sha256-abc'; script-src *"] }));
    assert.throws(() => loadScriptHashes(bad), /Malformed/);
  });

  it('fails loudly when the site has not been built, rather than shipping a CSP that blocks the theme script', () => {
    assert.throws(() => loadScriptHashes(join(tmpdir(), 'definitely-missing.json')), /npm run build/);
  });
});
