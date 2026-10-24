// Loads the REAL bundled Lambda code that `cdk synth` produced (cdk.out/asset.*/index.js) and calls it,
// to prove the artifacts that will ship actually run on Node 22: SDK, Zod 4 and the shared site schema
// all resolved by esbuild, auth enforced, validation working. No AWS access needed.
//   npx cdk synth --quiet && node scripts/smoke-bundles.mjs
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../cdk.out/', import.meta.url));
const template = JSON.parse(readFileSync(`${out}AwsugAdmin.template.json`, 'utf8'));
const require = createRequire(import.meta.url);
// Lambda unzips each bundle into a folder with no package.json, so it loads as CommonJS. Inside infra/ the
// nearest package.json says "type": "module", so run copies from a neutral temp directory instead.
const sandbox = mkdtempSync(join(tmpdir(), 'awsug-bundles-'));

// Fake environment: nothing here is ever contacted.
process.env.CONTENT_BUCKET = 'content-bucket';
process.env.MEDIA_BUCKET = 'media-bucket';
process.env.AWS_REGION = 'ap-south-1';
process.env.AWS_ACCESS_KEY_ID = 'AKIAFAKEFAKEFAKEFAKE';
process.env.AWS_SECRET_ACCESS_KEY = 'fake';
// As deployed once the Build stack exists: the Save and Delete bundles then construct a Scheduler client too.
process.env.SCHEDULE_GROUP = 'awsug-events';
process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::000000000000:role/smoke';
process.env.BUILD_PROJECT = 'awsug-site';

function load(logicalPrefix) {
  const [id, fn] = Object.entries(template.Resources).find(([k, v]) => v.Type === 'AWS::Lambda::Function' && k.startsWith(logicalPrefix));
  const hash = fn.Properties.Code.S3Key.replace(/\.zip$/, '');
  const dir = join(sandbox, hash);
  cpSync(`${out}asset.${hash}`, dir, { recursive: true });
  return require(join(dir, 'index.js')).handler;
}

const claims = (groups = '[organizers]') => ({ token_use: 'access', username: 'asha', sub: 's1', 'cognito:groups': groups });
const event = (over = {}) => ({ headers: {}, requestContext: { authorizer: { jwt: { claims: claims() } } }, ...over });
const call = async (handler, e) => {
  const r = await handler(e);
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
};

let passed = 0;
process.on('uncaughtException', (e) => { console.error(`FAILED: ${String(e?.message ?? e).slice(0, 600)}`); process.exit(1); });
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

await check('Save bundle loads and refuses non-organizers (403) and missing auth (401)', async () => {
  const save = load('Save');
  const base = { pathParameters: { collection: 'events', id: 'x' }, headers: { 'if-none-match': '*' }, body: '{}' };
  assert.equal((await call(save, event({ ...base, requestContext: { authorizer: { jwt: { claims: claims('[viewers]') } } } }))).status, 403);
  assert.equal((await call(save, event({ ...base, requestContext: {} }))).status, 401);
});

await check('Save bundle validates with the bundled site schema (422, with field paths)', async () => {
  const save = load('Save');
  const bad = { title: 'x', summary: 'y'.repeat(300), series: 'rave', size: 'small', mode: 'online', start: '2027-03-01T19:00:00', end: '2027-03-01T20:00:00+05:30', overview: 'Hello' };
  const r = await call(save, event({ pathParameters: { collection: 'events', id: 'x' }, headers: { 'if-none-match': '*' }, body: JSON.stringify(bad) }));
  assert.equal(r.status, 422);
  const paths = r.body.error.details.map((d) => d.path);
  for (const p of ['summary', 'series', 'start']) assert.ok(paths.includes(p), `expected an issue at ${p}, got ${paths}`);
});

await check('Save bundle has the join-link guard (an otherwise valid event with a Zoom link is rejected)', async () => {
  const save = load('Save');
  const ok = { title: 'Session', summary: 'A session.', series: 'online-session', size: 'small', mode: 'online', start: '2027-03-01T19:00:00+05:30', end: '2027-03-01T20:00:00+05:30', overview: 'Hello' };
  const r = await call(save, event({ pathParameters: { collection: 'events', id: 'x' }, headers: { 'if-none-match': '*' }, body: JSON.stringify({ ...ok, overview: 'Join https://us02web.zoom.us/j/123' }) }));
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.body), /join links/i);
});

await check('Save bundle demands a precondition before writing anything (428)', async () => {
  const save = load('Save');
  const doc = { name: 'Asha', role: 'Lead' };
  const r = await call(save, event({ pathParameters: { collection: 'organizers', id: 'asha' }, body: JSON.stringify(doc) }));
  assert.equal(r.status, 428);
});

await check('Save bundle rejects unknown collections and unsafe ids', async () => {
  const save = load('Save');
  assert.equal((await call(save, event({ pathParameters: { collection: 'secrets', id: 'x' }, body: '{}' }))).status, 404);
  assert.equal((await call(save, event({ pathParameters: { collection: 'events', id: '../x' }, body: '{}' }))).status, 400);
});

await check('SignUpload bundle returns a presigned POST pinned to uploads/', async () => {
  const sign = load('SignUpload');
  const r = await call(sign, event({ body: JSON.stringify({ folder: 'events/meetup-13', filename: 'Photo.JPG', contentType: 'image/jpeg' }) }));
  assert.equal(r.status, 200);
  assert.match(r.body.fields.key, /^uploads\/events\/meetup-13\/photo-[0-9a-f]{8}\.jpg$/);
  assert.match(r.body.mediaKey, /^events\/meetup-13\/photo-[0-9a-f]{8}\.jpg$/);
  assert.equal((await call(sign, event({ body: JSON.stringify({ folder: 'events/x', filename: 'a.heic', contentType: 'image/heic' }) }))).status, 415);
});

await check('Save and Delete bundles start with scheduling configured, and still validate before touching it', async () => {
  const save = load('Save');
  const bad = await call(save, event({ pathParameters: { collection: 'events', id: 'x' }, headers: { 'if-none-match': '*' }, body: JSON.stringify({ title: 'only a title' }) }));
  assert.equal(bad.status, 422); // rejected by the schema; the scheduler was never reached
  const del = load('Delete');
  assert.equal((await call(del, event({ pathParameters: { collection: 'nothing', id: 'x' } }))).status, 404);
});

await check('Publish bundle starts with the build project configured (it would call CodeBuild, so only auth is exercised)', async () => {
  const publish = load('Publish');
  const r = await call(publish, event({ routeKey: 'POST /publish', requestContext: { authorizer: { jwt: { claims: claims('[viewers]') } } } }));
  assert.equal(r.status, 403);
});

await check('Every route function loads and enforces the organizers group', async () => {
  for (const name of ['List', 'Get', 'Save', 'Delete', 'SignUpload', 'Publish']) {
    const handler = load(name);
    const r = await call(handler, event({ requestContext: { authorizer: { jwt: { claims: claims('[viewers]') } } } }));
    assert.equal(r.status, 403, name);
  }
});

console.log(`\n${passed} bundle smoke checks passed.`);
