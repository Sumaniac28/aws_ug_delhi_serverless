import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BatchGetBuildsCommand, ListBuildsForProjectCommand, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { MAX_UPLOAD_BYTES, sign } from '../lambda/api/handlers/uploads.ts';
import { publish, publishStatus } from '../lambda/api/handlers/publish.ts';
import { HttpError, type ApiResult } from '../lambda/api/lib/http.ts';
import { FakeS3, MEDIA_BUCKET, eventDoc, makeDeps, makeEvent, speakerDoc } from './helpers/fake-aws.ts';

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
  type B = { id: string; buildStatus: string; startTime?: Date };
  const builds = (list: B[], started: string[] = []) => ({
    send: async (cmd: any) => {
      if (cmd instanceof ListBuildsForProjectCommand) return { ids: list.map((b) => b.id) };
      // Deliberately answers in reverse: BatchGetBuilds does not promise the order it was asked in.
      if (cmd instanceof BatchGetBuildsCommand) return { builds: list.filter((b) => (cmd.input.ids ?? []).includes(b.id)).reverse() };
      if (cmd instanceof StartBuildCommand) {
        started.push(cmd.input.projectName!);
        return { build: { id: 'proj:new', buildStatus: 'IN_PROGRESS', currentPhase: 'SUBMITTED' } };
      }
      throw new Error('unexpected command');
    },
  });
  const at = (iso: string) => new Date(iso);
  /** Seeds one saved document at a chosen time. */
  const save = (s3: FakeS3, key: string, body: unknown, when: string) => {
    s3.now = () => at(when);
    s3.seed(key, body);
  };
  const ctxOf = (d: ReturnType<typeof makeDeps>) => ({ organizer: org, deps: d.deps });

  it('answers 503 until the build project exists (Phase 6), for both routes', async () => {
    const { deps } = makeDeps();
    const ctx = { organizer: org, deps };
    for (const fn of [publish, publishStatus]) {
      const r = await call(fn, makeEvent({}), ctx);
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, 'publishing_not_configured');
    }
  });

  it('starts the first ever build when there is no history', async () => {
    const started: string[] = [];
    const { deps } = makeDeps({ codebuild: builds([], started), buildProject: 'awsug-site' });
    assert.equal((await call(publish, makeEvent({}), { organizer: org, deps })).body.status, 'started');
    assert.equal(started.length, 1);
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

  describe('only when something is waiting', () => {
    const lastGood: B = { id: 'proj:1', buildStatus: 'SUCCEEDED', startTime: at('2027-01-10T10:00:00Z') };

    it('refuses with 409 when the last build succeeded and nothing was saved or deleted since', async () => {
      const started: string[] = [];
      const d = makeDeps({ codebuild: builds([lastGood], started), buildProject: 'awsug-site' });
      save(d.s3, 'content/events/old.json', eventDoc(), '2027-01-09T09:00:00Z');
      const r = await call(publish, makeEvent({}), ctxOf(d));
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'nothing_to_publish');
      assert.deepEqual(started, [], 'no build was started');
    });

    it('starts a build once something was saved after the last good build began', async () => {
      const started: string[] = [];
      const d = makeDeps({ codebuild: builds([lastGood], started), buildProject: 'awsug-site' });
      save(d.s3, 'content/events/new.json', eventDoc({ title: 'Fresh' }), '2027-01-10T10:05:00Z');
      const r = await call(publish, makeEvent({}), ctxOf(d));
      assert.equal(r.body.status, 'started');
      assert.deepEqual(started, ['awsug-site']);
    });

    it('counts a deletion as a change, which a plain listing could never show', async () => {
      const d = makeDeps({ codebuild: builds([lastGood]), buildProject: 'awsug-site' });
      save(d.s3, 'content/speakers/gone.json', speakerDoc, '2027-01-09T09:00:00Z');
      d.s3.now = () => at('2027-01-10T11:00:00Z');
      await d.s3.send(new DeleteObjectCommand({ Bucket: 'content-bucket', Key: 'content/speakers/gone.json' }));
      const r = await call(publishStatus, makeEvent({}), ctxOf(d));
      assert.equal(r.body.pending.count, 1);
      const [item] = r.body.pending.items;
      assert.deepEqual({ collection: item.collection, id: item.id, kind: item.kind }, { collection: 'speakers', id: 'gone', kind: 'deleted' });
    });

    it('lists each document once however often it was saved, with its name and who saved it', async () => {
      const d = makeDeps({ codebuild: builds([lastGood]), buildProject: 'awsug-site' });
      save(d.s3, 'content/events/x.json', eventDoc({ title: 'First draft' }), '2027-01-10T10:01:00Z');
      d.s3.now = () => at('2027-01-10T10:09:00Z');
      await d.s3.send(new PutObjectCommand({ Bucket: 'content-bucket', Key: 'content/events/x.json', Body: JSON.stringify(eventDoc({ title: 'Final title' })), Metadata: { 'edited-by': 'asha' } }));
      const r = await call(publishStatus, makeEvent({}), ctxOf(d));
      assert.equal(r.body.pending.count, 1);
      assert.equal(r.body.pending.items[0].label, 'Final title');
      assert.equal(r.body.pending.items[0].editor, 'asha');
      assert.equal(r.body.pending.items[0].kind, 'saved');
    });

    it('counts everything as waiting when no build has ever succeeded', async () => {
      const d = makeDeps({ codebuild: builds([{ id: 'proj:1', buildStatus: 'FAILED', startTime: at('2027-01-10T10:00:00Z') }]), buildProject: 'awsug-site' });
      save(d.s3, 'content/events/a.json', eventDoc(), '2027-01-01T00:00:00Z');
      save(d.s3, 'content/speakers/b.json', speakerDoc, '2027-01-02T00:00:00Z');
      const r = await call(publishStatus, makeEvent({}), ctxOf(d));
      assert.equal(r.body.pending.count, 2);
      assert.equal(r.body.lastSuccess, null);
    });

    it('lets a failed build be retried even when nothing new was saved', async () => {
      const started: string[] = [];
      const failed: B = { id: 'proj:2', buildStatus: 'FAILED', startTime: at('2027-01-11T10:00:00Z') };
      const d = makeDeps({ codebuild: builds([failed, lastGood], started), buildProject: 'awsug-site' });
      save(d.s3, 'content/events/old.json', eventDoc(), '2027-01-09T09:00:00Z');
      assert.equal((await call(publish, makeEvent({}), ctxOf(d))).body.status, 'started');
      assert.deepEqual(started, ['awsug-site']);
    });

    it('measures from the last SUCCESSFUL build, not from a newer failed one', async () => {
      const failed: B = { id: 'proj:2', buildStatus: 'FAILED', startTime: at('2027-01-11T10:00:00Z') };
      const d = makeDeps({ codebuild: builds([failed, lastGood]), buildProject: 'awsug-site' });
      save(d.s3, 'content/events/between.json', eventDoc(), '2027-01-10T12:00:00Z'); // after the good build, before the failed one
      const r = await call(publishStatus, makeEvent({}), ctxOf(d));
      assert.equal(r.body.pending.count, 1, 'the failed build never put it live');
    });

    it('pages through a long version list and reports the true count while listing only the newest', async () => {
      const s3 = new FakeS3(10);
      const d = makeDeps({ s3, codebuild: builds([lastGood]), buildProject: 'awsug-site' });
      for (let n = 0; n < 40; n++) save(s3, `content/speakers/person-${String(n).padStart(2, '0')}.json`, speakerDoc, '2027-01-10T10:30:00Z');
      const r = await call(publishStatus, makeEvent({}), ctxOf(d));
      assert.equal(r.body.pending.count, 40);
      assert.equal(r.body.pending.items.length, 25);
    });

    it('ignores files that are not content documents', async () => {
      const d = makeDeps({ codebuild: builds([lastGood]), buildProject: 'awsug-site' });
      save(d.s3, 'content/other/thing.json', {}, '2027-01-10T10:30:00Z');
      save(d.s3, 'content/events/readme.txt', 'x', '2027-01-10T10:30:00Z');
      assert.equal((await call(publishStatus, makeEvent({}), ctxOf(d))).body.pending.count, 0);
    });
  });

  it('reports the latest build even when BatchGetBuilds answers out of order, or null when there is none', async () => {
    const withHistory = makeDeps({ codebuild: builds([{ id: 'proj:2', buildStatus: 'FAILED' }, { id: 'proj:1', buildStatus: 'SUCCEEDED' }]), buildProject: 'awsug-site' });
    const r = await call(publishStatus, makeEvent({}), { organizer: org, deps: withHistory.deps });
    assert.equal(r.body.latest.buildStatus, 'FAILED');
    assert.equal(r.body.lastSuccess.buildId, 'proj:1');
    const empty = makeDeps({ codebuild: builds([]), buildProject: 'awsug-site' });
    const e = await call(publishStatus, makeEvent({}), { organizer: org, deps: empty.deps });
    assert.equal(e.body.latest, null);
    assert.deepEqual(e.body.pending, { count: 0, items: [] });
  });
});
