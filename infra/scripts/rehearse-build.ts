/**
 * Rehearses the publish build (buildspec.yml) on this machine, with no AWS.
 *
 *  1. Content is saved through the REAL admin API handlers into an in-memory content bucket.
 *  2. It is written into a throwaway copy of the site where the build would put it (src/content/<collection>).
 *  3. The site is built there, exactly as the buildspec does (`npm run build`, then the CSP check).
 *  4. The result is checked, and a deliberately broken document is shown to stop the build before any upload.
 *
 *   cd infra && npm run rehearse
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { save } from '../lambda/api/handlers/content.ts';
import { FakeS3, eventDoc, makeDeps, makeEvent, organizerDoc, postDoc, speakerDoc, sponsorDoc } from '../test/helpers/fake-aws.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const COLLECTIONS = ['events', 'speakers', 'sponsors', 'organizers', 'posts'];
const step = (m: string) => console.log(`\n> ${m}`);

// ---- 1. Save content the way an organizer would ---------------------------------------------------------------
step('Saving content through the real admin API handlers');
const { deps, s3 } = makeDeps({ s3: new FakeS3() });
const ctx = { organizer: { username: 'rehearsal', sub: 'x' }, deps };
const log = console.log;
async function put(collection: string, id: string, body: unknown) {
  console.log = () => {};
  try {
    const r = await save(makeEvent({ params: { collection, id }, headers: { 'if-none-match': '*' }, body }), ctx);
    assert.equal(r.statusCode, 201, `${collection}/${id}: ${r.body}`);
  } finally {
    console.log = log;
  }
}
await put('organizers', 'asha-verma', organizerDoc);
await put('speakers', 'ravi-kumar', { ...speakerDoc, bio: 'Builds serverless systems.' });
await put('sponsors', 'example-corp', sponsorDoc);
await put('events', 'rehearsal-meetup', eventDoc({ title: 'Rehearsal Meetup', summary: 'Saved through the admin API.', series: 'meetup', size: 'small', mode: 'online', draft: false, start: '2037-05-01T19:00:00+05:30', end: '2037-05-01T20:30:00+05:30', speakers: ['ravi-kumar'], hosts: ['asha-verma'], sponsors: [{ sponsor: 'example-corp', tier: 'gold' }] }));
await put('events', 'a-draft-event', eventDoc({ title: 'Secret draft', draft: true }));
await put('posts', 'hello-world', postDoc({ title: 'Hello from the admin' }));
console.log('  saved 1 organizer, 1 speaker, 1 sponsor, 2 events (one a draft), 1 post');

// ---- 2. A throwaway copy of the site, with this content in place of the repo's own copy -----------------
step('Preparing a copy of the site');
const work = mkdtempSync(join(tmpdir(), 'awsug-rehearsal-'));
for (const f of ['src', 'public', 'scripts', 'astro.config.mjs', 'package.json', 'tsconfig.json']) cpSync(join(root, f), join(work, f), { recursive: true });
symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'junction'); // reuse installed packages
function writeContent() {
  for (const c of COLLECTIONS) {
    rmSync(join(work, 'src/content', c), { recursive: true, force: true }); // the bucket replaces the repo's own copy
    mkdirSync(join(work, 'src/content', c), { recursive: true });
  }
  for (const [key, versions] of s3.versions) {
    const v = versions.at(-1)!;
    if (v.deleteMarker) continue;
    writeFileSync(join(work, 'src', key), v.body); // key is content/<collection>/<id>.json, as in the bucket
  }
}
writeContent();

// A real CodeBuild container starts from a fresh checkout every time (no cache is configured), so Astro's content cache
// (.astro/ and node_modules/.astro/) never survives between builds. Reusing this folder would let a deleted file linger in that cache.
const freshContainer = () => {
  rmSync(join(work, '.astro'), { recursive: true, force: true });
  rmSync(join(work, 'node_modules/.astro'), { recursive: true, force: true }); // the content store lives here
};

const run = (args: string[], env: Record<string, string> = {}) => {
  freshContainer();
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: work, env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' });
};

// ---- 3. Build as the buildspec does --------------------------------------------------------------------------
step('Building (npm run build), then checking the CSP like buildspec.yml does');
const expected = (JSON.parse(readFileSync(join(root, 'csp-hashes.json'), 'utf8')) as { scriptHashes: string[] }).scriptHashes.join(',');
run(['run', 'build']);
const verify = execFileSync('node', ['scripts/verify-csp.mjs'], { cwd: work, env: { ...process.env, EXPECTED_CSP_HASHES: expected }, encoding: 'utf8' });
console.log('  ' + verify.trim());

// ---- 4. Check what was built ---------------------------------------------------------------------------------------
step('Checking the built site');
const dist = join(work, 'dist');
const page = (p: string) => readFileSync(join(dist, p, 'index.html'), 'utf8');
assert.ok(page('events/2037/rehearsal-meetup').includes('Rehearsal Meetup'), 'the event saved through the API has its own page');
assert.ok(page('events/2037/rehearsal-meetup').includes('Ravi Kumar'), 'its speaker is shown');
assert.ok(page('events/2037/rehearsal-meetup').includes('Example Corp'), 'its sponsor is shown');
assert.ok(page('speakers/ravi-kumar').includes('Builds serverless systems.'), 'the speaker has a page with their bio');
assert.ok(page('blog/hello-world').includes('Hello from the admin'), 'the post is published');
assert.ok(readFileSync(join(dist, 'sitemap-0.xml'), 'utf8').includes('/events/2037/rehearsal-meetup/'), 'it is in the sitemap');
assert.ok(!existsSync(join(dist, 'events/2037/a-draft-event')), 'a draft is NOT published');
assert.ok(!readFileSync(join(dist, 'events/index.html'), 'utf8').includes('Secret draft'), 'a draft is not listed');
assert.ok(!existsSync(join(dist, 'events/2026/serverless-meetup-nov-2026')), "the repo's own content is replaced by the bucket's");
console.log('  the event, speaker, sponsor and post saved through the admin are on the site; the draft is not');

// ---- 5. A broken document must stop the build before anything is uploaded -----------------------------------------------
step('Corrupting a document to show the build refuses to publish it');
rmSync(dist, { recursive: true, force: true });
writeFileSync(join(work, 'src/content/events/rehearsal-meetup.json'), JSON.stringify({ title: 'Edited by hand, badly', summary: 'x'.repeat(300) }));
let failed = false;
try {
  run(['run', 'build']);
} catch (e) {
  failed = true;
  const out = String((e as { stdout?: string; stderr?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
  assert.match(out, /rehearsal-meetup|does not match collection schema|InvalidContentEntryDataError/);
  console.log('  the build failed on the invalid document, so nothing would be uploaded and the live site stays as it is');
}
assert.ok(failed, 'an invalid document must fail the build');
assert.ok(!existsSync(join(dist, 'index.html')), 'no site was produced');

// ---- 6. A dangling reference must stop it too ---------------------------------------------------------------------------
step('Deleting a speaker an event uses (bypassing the API check) to show the build catches it');
writeContent();
rmSync(join(work, 'src/content/speakers/ravi-kumar.json'));
failed = false;
try {
  run(['run', 'build']);
} catch (e) {
  failed = true;
  const out = String((e as { stdout?: string; stderr?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
  assert.match(out, /ravi-kumar/);
  console.log('  the build failed on the missing speaker: "ravi-kumar" does not exist');
}
assert.ok(failed, 'a dangling reference must fail the build');

rmSync(work, { recursive: true, force: true });
console.log(`\nRehearsal passed. (${readdirSync(root).length ? 'work copy removed' : ''})`);
