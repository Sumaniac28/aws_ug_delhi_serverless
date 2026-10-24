import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BatchGetBuildsCommand, ListBuildsForProjectCommand, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { MAX_UPLOAD_BYTES, sign } from '../lambda/api/handlers/uploads.ts';
import { publish, publishStatus } from '../lambda/api/handlers/publish.ts';
import { HttpError, type ApiResult } from '../lambda/api/lib/http.ts';
import { MEDIA_BUCKET, makeDeps, makeEvent } from './helpers/fake-aws.ts';

const org = { username: 'asha', sub: 's1' };

async function call(fn: (...a: any[]) => Promise<ApiResult>, ...args: any[]) {
  const log = console.log;
  console.log = () => {};
  try {
    const r = await fn(...args);
    return { status: r.statusCode, body: JSON.parse(r.body ?? 'null') };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
    throw e;
  } finally {
    console.log = log;
  }
}

const signReq = (body: unknown) => makeEvent({ routeKey: 'POST /uploads', body });

describe('sign upload', () => {
  const { deps } = makeDeps();
  const ctx = { organizer: org, deps };
  const ok = { folder: 'events/meetup-13-gurugram', filename: 'Venue Photo (1).JPG', contentType: 'image/jpeg' };

  it('returns a presigned POST whose policy pins the key, type, uploader and a size limit', async () => {
    const r = await call(sign, signReq(ok), ctx);
    assert.equal(r.status, 200);
    assert.match(r.body.url, new RegExp(MEDIA_BUCKET));
    const policy = JSON.parse(Buffer.from(r.body.fields.Policy, 'base64').toString());
    const cond = JSON.stringify(policy.conditions);
    assert.match(cond, /"bucket":"media-bucket"/);
    assert.match(cond, new RegExp(`\\["eq","\\$key","uploads/${r.body.mediaKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]`));
    assert.match(cond, /\["eq","\$Content-Type","image\/jpeg"\]/);
    assert.match(cond, /\["eq","\$x-amz-meta-uploaded-by","asha"\]/);
    assert.match(cond, new RegExp(`\\["content-length-range",1,${MAX_UPLOAD_BYTES}\\]`));
    assert.ok(new Date(policy.expiration).getTime() - Date.now() < 6 * 60 * 1000, 'expires within minutes');
  });

  it('only allows writing under uploads/, never media/ or the content area', async () => {
    const r = await call(sign, signReq(ok), ctx);
    assert.match(r.body.fields.key, /^uploads\/events\/meetup-13-gurugram\//);
    assert.ok(!r.body.fields.key.startsWith('media/') && !r.body.fields.key.startsWith('content/'));
  });

  it('gives a clean, unique media key per upload and names the variants the resize function will create', async () => {
    const a = await call(sign, signReq(ok), ctx);
    const b = await call(sign, signReq(ok), ctx);
    assert.match(a.body.mediaKey, /^events\/meetup-13-gurugram\/venue-photo-1-r\d{7}\.jpg$/);
    assert.notEqual(a.body.mediaKey, b.body.mediaKey);
    const stem = a.body.mediaKey.replace(/\.jpg$/, '');
    assert.deepEqual(a.body.variants, [`media/${stem}-480.webp`, `media/${stem}-960.webp`, `media/${stem}-1600.webp`]);
  });

  it('rejects folders outside the known item folders, including traversal', async () => {
    for (const folder of ['uploads/x', 'media/x', 'content/events/x', 'events', 'events/', 'events/../x', 'events/Bad_Id', '/events/x', 'secrets/x']) {
      assert.equal((await call(sign, signReq({ ...ok, folder }), ctx)).status, 400, folder);
    }
  });

  it('rejects non-images, with a specific hint for iPhone HEIC', async () => {
    const pdf = await call(sign, signReq({ ...ok, filename: 'brochure.pdf', contentType: 'application/pdf' }), ctx);
    assert.equal(pdf.status, 415);
    const heic = await call(sign, signReq({ ...ok, filename: 'IMG_0001.HEIC', contentType: 'image/heic' }), ctx);
    assert.equal(heic.status, 415);
    assert.match(heic.body.error.message, /HEIC.*JPEG/);
    assert.equal((await call(sign, signReq({ ...ok, filename: 'noextension', contentType: 'image/jpeg' }), ctx)).status, 415);
  });

  it('rejects a content type that does not match the extension', async () => {
    assert.equal((await call(sign, signReq({ ...ok, contentType: 'text/html' }), ctx)).status, 415);
    assert.equal((await call(sign, signReq({ ...ok, contentType: 'image/png' }), ctx)).status, 415);
  });

  it('rejects missing fields and non-JSON', async () => {
    assert.equal((await call(sign, signReq({ folder: ok.folder }), ctx)).status, 400);
    assert.equal((await call(sign, signReq('nope'), ctx)).status, 400);
  });
});

describe('publish', () => {
  const builds = (list: { id: string; buildStatus: string }[], started: string[] = []) => ({
    send: async (cmd: any) => {
      if (cmd instanceof ListBuildsForProjectCommand) return { ids: list.map((b) => b.id) };
      if (cmd instanceof BatchGetBuildsCommand) return { builds: list.filter((b) => (cmd.input.ids ?? []).includes(b.id)) };
      if (cmd instanceof StartBuildCommand) {
        started.push(cmd.input.projectName!);
        return { build: { id: 'proj:new', buildStatus: 'IN_PROGRESS', currentPhase: 'SUBMITTED' } };
      }
      throw new Error('unexpected command');
    },
  });

  it('answers 503 until the build project exists (Phase 6), for both routes', async () => {
    const { deps } = makeDeps();
    const ctx = { organizer: org, deps };
    for (const fn of [publish, publishStatus]) {
      const r = await call(fn, makeEvent({}), ctx);
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, 'publishing_not_configured');
    }
  });

  it('starts a build when none is running (202)', async () => {
    const started: string[] = [];
    const { deps } = makeDeps({ codebuild: builds([{ id: 'proj:1', buildStatus: 'SUCCEEDED' }], started), buildProject: 'awsug-site' });
    const r = await call(publish, makeEvent({}), { organizer: org, deps });
    assert.equal(r.status, 202);
    assert.equal(r.body.status, 'started');
    assert.equal(r.body.buildId, 'proj:new');
    assert.deepEqual(started, ['awsug-site']);
  });

  it('does not start a second build while one is running, and says which', async () => {
    const started: string[] = [];
    const { deps } = makeDeps({ codebuild: builds([{ id: 'proj:2', buildStatus: 'IN_PROGRESS' }, { id: 'proj:1', buildStatus: 'SUCCEEDED' }], started), buildProject: 'awsug-site' });
    const r = await call(publish, makeEvent({}), { organizer: org, deps });
    assert.equal(r.status, 202);
    assert.equal(r.body.status, 'already-running');
    assert.equal(r.body.buildId, 'proj:2');
    assert.equal(r.body.buildStatus, 'IN_PROGRESS', 'the marker and the CodeBuild status are separate fields');
    assert.deepEqual(started, []);
  });

  it('starts the first ever build when there is no history', async () => {
    const started: string[] = [];
    const { deps } = makeDeps({ codebuild: builds([], started), buildProject: 'awsug-site' });
    assert.equal((await call(publish, makeEvent({}), { organizer: org, deps })).body.status, 'started');
    assert.equal(started.length, 1);
  });

  it('reports the latest build, or null when there is none', async () => {
    const withHistory = makeDeps({ codebuild: builds([{ id: 'proj:1', buildStatus: 'FAILED' }]), buildProject: 'awsug-site' });
    assert.equal((await call(publishStatus, makeEvent({}), { organizer: org, deps: withHistory.deps })).body.latest.buildStatus, 'FAILED');
    const empty = makeDeps({ codebuild: builds([]), buildProject: 'awsug-site' });
    assert.equal((await call(publishStatus, makeEvent({}), { organizer: org, deps: empty.deps })).body.latest, null);
  });
});
