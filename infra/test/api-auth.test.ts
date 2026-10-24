import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGroups, requireOrganizer } from '../lambda/api/lib/auth.ts';
import { HttpError, json } from '../lambda/api/lib/http.ts';
import { route } from '../lambda/api/lib/route.ts';
import { makeDeps, makeEvent } from './helpers/fake-aws.ts';

const claims = (over: Record<string, unknown> = {}) => ({ token_use: 'access', username: 'asha', sub: 's1', 'cognito:groups': '[organizers]', ...over });

describe('parseGroups', () => {
  it('understands the forms API Gateway produces', () => {
    assert.deepEqual(parseGroups('[organizers]'), ['organizers']);
    assert.deepEqual(parseGroups('[admins organizers]'), ['admins', 'organizers']);
    assert.deepEqual(parseGroups('organizers'), ['organizers']);
    assert.deepEqual(parseGroups(['organizers']), ['organizers']);
    assert.deepEqual(parseGroups(undefined), []);
  });
});

describe('requireOrganizer', () => {
  const run = (c: Record<string, unknown> | null) => requireOrganizer(makeEvent({ claims: c }));
  const statusOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as HttpError).status;
    }
    return 200;
  };

  it('accepts an access token from an organizer', () => {
    assert.deepEqual(run(claims()), { username: 'asha', sub: 's1' });
    assert.equal(run(claims({ 'cognito:groups': '[admins organizers]' })).username, 'asha');
  });
  it('rejects requests with no claims (401)', () => assert.equal(statusOf(() => run(null)), 401));
  it('rejects ID tokens, which carry the same groups but are not meant for APIs (401)', () => assert.equal(statusOf(() => run(claims({ token_use: 'id' }))), 401));
  it('rejects signed-in users who are not organizers (403)', () => {
    assert.equal(statusOf(() => run(claims({ 'cognito:groups': '[viewers]' }))), 403);
    assert.equal(statusOf(() => run(claims({ 'cognito:groups': undefined }))), 403);
  });
  it('does not treat a lookalike group name as organizers', () => assert.equal(statusOf(() => run(claims({ 'cognito:groups': '[organizers-readonly]' }))), 403));
  it('rejects a token with no identity (401)', () => assert.equal(statusOf(() => run(claims({ username: undefined }))), 401));
});

describe('route wrapper', () => {
  const { deps } = makeDeps();
  const body = (r: { body?: string }) => JSON.parse(r.body ?? '{}');

  it('runs the handler for an organizer and passes the identity through', async () => {
    const res = await route(async (_e, ctx) => json(200, { who: ctx.organizer.username }), () => deps)(makeEvent({}));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body(res), { who: 'asha' });
  });

  it('never runs the handler for a non-organizer', async () => {
    let ran = false;
    const res = await route(async () => ((ran = true), json(200, {})), () => deps)(makeEvent({ claims: claims({ 'cognito:groups': '[viewers]' }) }));
    assert.equal(res.statusCode, 403);
    assert.equal(ran, false);
    assert.equal(body(res).error.code, 'forbidden');
  });

  it('turns HttpErrors into JSON errors with a code and details', async () => {
    const res = await route(async () => { throw new HttpError(422, 'invalid_document', 'Fix it', [{ path: 'title', message: 'required' }]); }, () => deps)(makeEvent({}));
    assert.equal(res.statusCode, 422);
    assert.deepEqual(body(res).error, { code: 'invalid_document', message: 'Fix it', details: [{ path: 'title', message: 'required' }] });
  });

  it('hides the internals of unexpected errors behind a generic 500', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (m: string) => errors.push(m);
    try {
      const res = await route(async () => { throw new Error('secret bucket name leaked: content-bucket'); }, () => deps)(makeEvent({}));
      assert.equal(res.statusCode, 500);
      assert.doesNotMatch(res.body ?? '', /secret|content-bucket/);
      assert.equal(body(res).error.code, 'internal');
      assert.match(errors[0] ?? '', /secret bucket name leaked/, 'the detail is logged server-side');
    } finally {
      console.error = original;
    }
  });
});
