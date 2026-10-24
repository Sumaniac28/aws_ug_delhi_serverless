import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { get, list, remove, save } from '../lambda/api/handlers/content.ts';
import { HttpError, type ApiResult } from '../lambda/api/lib/http.ts';
import { CONTENT_BUCKET, FakeS3, eventDoc, makeDeps, makeEvent, organizerDoc, postDoc, speakerDoc, sponsorDoc } from './helpers/fake-aws.ts';

const quiet = () => {
  const log = console.log;
  console.log = () => {};
  return () => (console.log = log);
};

/** Runs a handler and returns its response, or the HttpError it threw, in one shape. */
async function call(fn: (...a: any[]) => Promise<ApiResult>, ...args: any[]) {
  const restore = quiet();
  try {
    const r = await fn(...args);
    return { status: r.statusCode, body: JSON.parse(r.body ?? 'null'), headers: r.headers ?? {} };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } }, headers: {} as Record<string, string> };
    throw e;
  } finally {
    restore();
  }
}

const org = { username: 'asha', sub: 's1' };
let s3: FakeS3;
let ctx: { organizer: typeof org; deps: ReturnType<typeof makeDeps>['deps'] };
const params = (collection: string, id?: string) => ({ collection, ...(id ? { id } : {}) });
const create = (collection: string, id: string, doc: unknown) => call(save, makeEvent({ params: params(collection, id), headers: { 'if-none-match': '*' }, body: doc }), ctx);

beforeEach(() => {
  const made = makeDeps({ s3: new FakeS3(2) }); // page size 2 so listing pagination is exercised
  s3 = made.s3;
  ctx = { organizer: org, deps: made.deps };
});

describe('save: create and update', () => {
  it('creates an item (201), returns its ETag and records who edited it', async () => {
    const r = await create('organizers', 'asha-verma', organizerDoc);
    assert.equal(r.status, 201);
    assert.ok(r.headers.etag);
    assert.equal(r.body.etag, r.headers.etag);
    const v = s3.history('content/organizers/asha-verma.json').at(-1)!;
    assert.equal(v.metadata['edited-by'], 'asha');
    assert.equal(JSON.parse(v.body).active, true, 'schema defaults are stored');
  });

  it('refuses to create over an existing item (412)', async () => {
    await create('organizers', 'asha-verma', organizerDoc);
    const r = await create('organizers', 'asha-verma', organizerDoc);
    assert.equal(r.status, 412);
    assert.equal(r.body.error.code, 'conflict');
  });

  it('updates with the current ETag (200) and gives a new one', async () => {
    const created = await create('organizers', 'asha-verma', organizerDoc);
    const r = await call(save, makeEvent({ params: params('organizers', 'asha-verma'), headers: { 'if-match': created.headers.etag! }, body: { ...organizerDoc, role: 'Programme lead' } }), ctx);
    assert.equal(r.status, 200);
    assert.notEqual(r.headers.etag, created.headers.etag);
    assert.equal(r.body.data.role, 'Programme lead');
  });

  it('accepts an ETag the browser sent without quotes', async () => {
    const created = await create('organizers', 'asha-verma', organizerDoc);
    const bare = created.headers.etag!.replace(/"/g, '');
    const r = await call(save, makeEvent({ params: params('organizers', 'asha-verma'), headers: { 'if-match': bare }, body: organizerDoc }), ctx);
    assert.equal(r.status, 200);
  });

  it('stops two organizers silently overwriting each other (412), keeping the first edit', async () => {
    const created = await create('organizers', 'asha-verma', organizerDoc);
    const base = created.headers.etag!;
    const first = await call(save, makeEvent({ params: params('organizers', 'asha-verma'), headers: { 'if-match': base }, body: { ...organizerDoc, role: 'First edit' } }), ctx);
    assert.equal(first.status, 200);
    const second = await call(save, makeEvent({ params: params('organizers', 'asha-verma'), headers: { 'if-match': base }, body: { ...organizerDoc, role: 'Second edit' } }), ctx);
    assert.equal(second.status, 412);
    assert.match(second.body.error.message, /Someone else changed/);
    const now = await call(get, makeEvent({ params: params('organizers', 'asha-verma') }), ctx);
    assert.equal(now.body.data.role, 'First edit');
  });

  it('keeps every earlier version, so a bad edit can be rolled back', async () => {
    const created = await create('organizers', 'asha-verma', organizerDoc);
    await call(save, makeEvent({ params: params('organizers', 'asha-verma'), headers: { 'if-match': created.headers.etag! }, body: { ...organizerDoc, role: 'v2' } }), ctx);
    assert.equal(s3.history('content/organizers/asha-verma.json').length, 2);
  });

  it('says 404 when updating something that is gone', async () => {
    const r = await call(save, makeEvent({ params: params('organizers', 'nobody'), headers: { 'if-match': '"abc"' }, body: organizerDoc }), ctx);
    assert.equal(r.status, 404);
  });

  it('demands a precondition: neither header, or both, is 428', async () => {
    const neither = await call(save, makeEvent({ params: params('organizers', 'asha-verma'), body: organizerDoc }), ctx);
    assert.equal(neither.status, 428);
    const both = await call(save, makeEvent({ params: params('organizers', 'asha-verma'), headers: { 'if-match': '"a"', 'if-none-match': '*' }, body: organizerDoc }), ctx);
    assert.equal(both.status, 428);
    assert.equal(s3.history('content/organizers/asha-verma.json').length, 0, 'nothing was written');
  });
});

describe('save: validation uses the site schema', () => {
  it('rejects an invalid document with the field and a readable message (422)', async () => {
    const r = await create('events', 'bad-event', eventDoc({ summary: 'x'.repeat(200), series: 'rave' }));
    assert.equal(r.status, 422);
    const paths = r.body.error.details.map((d: { path: string }) => d.path);
    assert.ok(paths.includes('summary') && paths.includes('series'), `paths: ${paths}`);
  });

  it('rejects online join links pasted into free text', async () => {
    const r = await create('events', 'leaky', eventDoc({ overview: 'Join here: https://us02web.zoom.us/j/123' }));
    assert.equal(r.status, 422);
    assert.match(JSON.stringify(r.body), /join links/i);
  });

  it('rejects a joinUrl field outright', async () => {
    const r = await create('events', 'leaky', eventDoc({ joinUrl: 'https://example.org/room' }));
    assert.equal(r.status, 422);
  });

  it('rejects a time with no UTC offset, which would shift by 5.5 hours', async () => {
    const r = await create('events', 'no-offset', eventDoc({ start: '2027-03-01T19:00:00' }));
    assert.equal(r.status, 422);
  });

  it('requires a venue unless the event is online-only', async () => {
    const r = await create('events', 'no-venue', eventDoc({ mode: 'offline' }));
    assert.equal(r.status, 422);
    assert.ok(r.body.error.details.some((d: { path: string }) => d.path === 'venue'));
  });

  it('rejects malformed JSON (400) and oversized bodies (413)', async () => {
    assert.equal((await create('events', 'x', '{not json')).status, 400);
    assert.equal((await create('events', 'x', { ...eventDoc(), overview: 'a'.repeat(300 * 1024) })).status, 413);
  });

  it('rejects unknown collections (404) and unsafe IDs (400)', async () => {
    assert.equal((await create('secrets', 'x', {})).status, 404);
    for (const id of ['Bad_ID', 'has space', '-lead', 'x'.repeat(81), '..%2Fetc']) assert.equal((await create('organizers', id, organizerDoc)).status, 400, id);
  });
});

describe('references', () => {
  it('refuses an event that names a speaker or host who does not exist (422), because the site build would fail', async () => {
    const r = await create('events', 'talk', eventDoc({ speakers: ['ravi-kumar'], hosts: ['asha-verma'] }));
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'missing_references');
    assert.deepEqual(r.body.error.details.map((m: { id: string }) => m.id).sort(), ['asha-verma', 'ravi-kumar']);
    assert.equal(s3.history('content/events/talk.json').length, 0);
  });

  it('accepts it once the referenced items exist', async () => {
    await create('speakers', 'ravi-kumar', speakerDoc);
    await create('organizers', 'asha-verma', organizerDoc);
    assert.equal((await create('events', 'talk', eventDoc({ speakers: ['ravi-kumar'], hosts: ['asha-verma'] }))).status, 201);
  });

  it('checks speakers named inside the agenda and sponsors with a tier', async () => {
    const agenda = [{ start: '2027-03-01T19:00:00+05:30', end: '2027-03-01T19:30:00+05:30', title: 'Intro', speakers: ['ghost'] }];
    const r1 = await create('events', 'talk', eventDoc({ agenda }));
    assert.deepEqual(r1.body.error.details, [{ collection: 'speakers', id: 'ghost' }]);
    const r2 = await create('events', 'talk', eventDoc({ sponsors: [{ sponsor: 'acme', tier: 'gold' }] }));
    assert.deepEqual(r2.body.error.details, [{ collection: 'sponsors', id: 'acme' }]);
  });

  it('checks a post\'s author and related event', async () => {
    const r = await create('posts', 'hello', postDoc({ relatedEvent: 'no-such-event' }));
    assert.deepEqual(r.body.error.details.map((m: { collection: string; id: string }) => `${m.collection}/${m.id}`).sort(), ['events/no-such-event', 'organizers/asha-verma']);
  });
});

describe('get and list', () => {
  it('gets an item with its ETag in the header and body', async () => {
    await create('sponsors', 'example-corp', sponsorDoc);
    const r = await call(get, makeEvent({ params: params('sponsors', 'example-corp') }), ctx);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, 'Example Corp');
    assert.equal(r.body.editor, 'asha');
    assert.equal(r.headers.etag, r.body.etag);
  });

  it('404s for a missing item', async () => {
    assert.equal((await call(get, makeEvent({ params: params('sponsors', 'nope') }), ctx)).status, 404);
  });

  it('lists summaries across several pages, in id order', async () => {
    for (const id of ['c-corp', 'a-corp', 'e-corp', 'b-corp', 'd-corp']) await create('sponsors', id, { ...sponsorDoc, name: id.toUpperCase() });
    const r = await call(list, makeEvent({ params: params('sponsors') }), ctx);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((i: { id: string }) => i.id), ['a-corp', 'b-corp', 'c-corp', 'd-corp', 'e-corp']);
    assert.equal(r.body.items[0].name, 'A-CORP');
    assert.ok(r.body.items[0].etag);
  });

  it('shows event summaries and flags a document that no longer matches the schema instead of hiding it', async () => {
    await create('events', 'good', eventDoc());
    s3.seed('content/events/broken.json', { title: 'Missing everything else' });
    const r = await call(list, makeEvent({ params: params('events') }), ctx);
    const byId = Object.fromEntries(r.body.items.map((i: { id: string }) => [i.id, i]));
    assert.equal(byId.good.title, 'Online session: IAM basics');
    assert.equal(byId.broken.invalid, true);
  });

  it('is empty for a collection with nothing in it', async () => {
    assert.deepEqual((await call(list, makeEvent({ params: params('posts') }), ctx)).body.items, []);
  });
});

describe('delete', () => {
  it('deletes an unused item but keeps its history (versioned bucket)', async () => {
    await create('sponsors', 'example-corp', sponsorDoc);
    const r = await call(remove, makeEvent({ params: params('sponsors', 'example-corp') }), ctx);
    assert.equal(r.status, 200);
    assert.equal((await call(get, makeEvent({ params: params('sponsors', 'example-corp') }), ctx)).status, 404);
    const history = s3.history('content/sponsors/example-corp.json');
    assert.equal(history.length, 2);
    assert.equal(history[0]!.deleteMarker, undefined, 'the original version is still there to restore');
  });

  it('refuses to delete a speaker an event still uses (409), naming the event', async () => {
    await create('speakers', 'ravi-kumar', speakerDoc);
    await create('events', 'talk', eventDoc({ speakers: ['ravi-kumar'] }));
    const r = await call(remove, makeEvent({ params: params('speakers', 'ravi-kumar') }), ctx);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'in_use');
    assert.deepEqual(r.body.error.details, [{ collection: 'events', id: 'talk' }]);
    assert.equal((await call(get, makeEvent({ params: params('speakers', 'ravi-kumar') }), ctx)).status, 200, 'still there');
  });

  it('refuses to delete an organizer who authored a post, and an event a post points at', async () => {
    await create('organizers', 'asha-verma', organizerDoc);
    await create('events', 'talk', eventDoc());
    await create('posts', 'hello', postDoc({ relatedEvent: 'talk' }));
    assert.equal((await call(remove, makeEvent({ params: params('organizers', 'asha-verma') }), ctx)).status, 409);
    assert.equal((await call(remove, makeEvent({ params: params('events', 'talk') }), ctx)).status, 409);
  });

  it('allows it once the references are gone', async () => {
    await create('speakers', 'ravi-kumar', speakerDoc);
    const ev = await create('events', 'talk', eventDoc({ speakers: ['ravi-kumar'] }));
    await call(remove, makeEvent({ params: params('events', 'talk') }), ctx);
    assert.equal((await call(remove, makeEvent({ params: params('speakers', 'ravi-kumar') }), ctx)).status, 200);
    assert.ok(ev.status === 201);
  });

  it('honours If-Match on delete (412 when stale) and 404s for a missing item', async () => {
    const created = await create('sponsors', 'example-corp', sponsorDoc);
    const stale = await call(remove, makeEvent({ params: params('sponsors', 'example-corp'), headers: { 'if-match': '"stale"' } }), ctx);
    assert.equal(stale.status, 412);
    const ok = await call(remove, makeEvent({ params: params('sponsors', 'example-corp'), headers: { 'if-match': created.headers.etag! } }), ctx);
    assert.equal(ok.status, 200);
    assert.equal((await call(remove, makeEvent({ params: params('sponsors', 'example-corp') }), ctx)).status, 404);
  });
});

describe('what the API touches', () => {
  it('only ever addresses content/<collection>/<id>.json in the content bucket', async () => {
    await create('organizers', 'asha-verma', organizerDoc);
    assert.deepEqual([...s3.versions.keys()], ['content/organizers/asha-verma.json']);
    assert.equal(CONTENT_BUCKET, 'content-bucket');
  });
});
