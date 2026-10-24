import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/lib/api.ts';
import { AuthError } from '../src/lib/auth.ts';

const BASE = 'https://api.example.org';
const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

function client(handler: (url: string, init: RequestInit) => Response | Promise<Response>, over: { onUnauthorized?: () => void; token?: () => Promise<string> } = {}) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  return { api: new ApiClient({ baseUrl: BASE, token: over.token ?? (async () => 'tok-1'), onUnauthorized: over.onUnauthorized, fetch: fetch as any }), fetch };
}
const headersOf = (fetch: ReturnType<typeof vi.fn>, call = 0) => (fetch.mock.calls[call] as any)[1].headers as Record<string, string>;

describe('ApiClient requests', () => {
  it('sends the bearer token and reads list results', async () => {
    const { api, fetch } = client(() => reply(200, { items: [{ id: 'a', etag: '"1"' }] }));
    expect(await api.list('events')).toEqual([{ id: 'a', etag: '"1"' }]);
    expect(fetch.mock.calls[0]![0]).toBe(`${BASE}/content/events`);
    expect(headersOf(fetch).authorization).toBe('Bearer tok-1');
  });

  it('creates with If-None-Match: * and updates with If-Match: <etag>', async () => {
    const { api, fetch } = client(() => reply(200, { etag: '"new"' }));
    await api.create('speakers', 'asha', { name: 'Asha' });
    await api.update('speakers', 'asha', { name: 'Asha V' }, '"old"');
    expect(headersOf(fetch, 0)).toMatchObject({ 'if-none-match': '*', 'content-type': 'application/json' });
    expect(headersOf(fetch, 0)['if-match']).toBeUndefined();
    expect(headersOf(fetch, 1)['if-match']).toBe('"old"');
    expect(headersOf(fetch, 1)['if-none-match']).toBeUndefined();
    expect(JSON.parse((fetch.mock.calls[1] as any)[1].body)).toEqual({ name: 'Asha V' });
  });

  it('returns the new ETag from a save', async () => {
    const { api } = client(() => reply(201, { etag: '"abc"' }));
    expect(await api.create('speakers', 'asha', {})).toEqual({ etag: '"abc"', warnings: [] });
  });

  it('passes along warnings from a save, such as a failed schedule', async () => {
    const { api } = client(() => reply(200, { etag: '"e"', warnings: [{ code: 'schedule_failed', message: 'Could not schedule.' }] }));
    expect((await api.update('events', 'e', {}, '"old"')).warnings).toEqual([{ code: 'schedule_failed', message: 'Could not schedule.' }]);
  });

  it('deletes with an optional If-Match', async () => {
    const { api, fetch } = client(() => reply(200, { deleted: true }));
    await api.remove('posts', 'hello', '"e"');
    await api.remove('posts', 'hello');
    expect(headersOf(fetch, 0)['if-match']).toBe('"e"');
    expect(headersOf(fetch, 1)['if-match']).toBeUndefined();
    expect((fetch.mock.calls[0] as any)[1].method).toBe('DELETE');
  });
});

describe('ApiClient errors', () => {
  it('turns API errors into ApiError with the code, message and details', async () => {
    const { api } = client(() => reply(422, { error: { code: 'missing_references', message: 'Refers to missing items.', details: [{ collection: 'speakers', id: 'x' }] } }));
    const err = await api.create('events', 'e', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'missing_references', message: 'Refers to missing items.', details: [{ collection: 'speakers', id: 'x' }] });
  });

  it('flags version conflicts (412) so the editor can offer a reload', async () => {
    const { api } = client(() => reply(412, { error: { code: 'conflict', message: 'Someone else changed this.' } }));
    const err = await api.update('events', 'e', {}, '"old"').catch((e) => e);
    expect(err.isConflict).toBe(true);
  });

  it('calls onUnauthorized for a 401', async () => {
    const onUnauthorized = vi.fn();
    const { api } = client(() => reply(401, { error: { code: 'unauthenticated', message: 'Sign in.' } }), { onUnauthorized });
    await api.list('events').catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('copes with a non-JSON error body', async () => {
    const { api } = client(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await api.list('events').catch((e) => e)).toMatchObject({ status: 502, code: 'http_502' });
  });

  it('reports network failures in plain English', async () => {
    const { api } = client(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await api.list('events').catch((e) => e)).toMatchObject({ status: 0, code: 'network', message: expect.stringMatching(/connection/i) });
  });

  it('lets an AuthError from the token provider through, so the app can send the user to sign in', async () => {
    const { api, fetch } = client(() => reply(200, {}), {
      token: async () => {
        throw new AuthError('login_required', 'Sign in.');
      },
    });
    expect(await api.list('events').catch((e) => e)).toBeInstanceOf(AuthError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('uploadFile', () => {
  const signed = { url: 'https://media-bucket.s3.ap-south-1.amazonaws.com/', fields: { key: 'uploads/a.jpg', 'Content-Type': 'image/jpeg', Policy: 'p' }, expiresInSeconds: 300, maxBytes: 1000, mediaKey: 'a.jpg', variants: [] };

  it('posts the signed fields first and the file LAST (S3 requires this order), with no auth header', async () => {
    const { api, fetch } = client(() => new Response(null, { status: 204 }));
    await api.uploadFile(signed, new Blob(['x'.repeat(10)], { type: 'image/jpeg' }));
    const [url, init] = fetch.mock.calls[0] as any;
    expect(url).toBe(signed.url);
    expect(init.headers).toBeUndefined();
    const keys = [...(init.body as FormData).keys()];
    expect(keys).toEqual(['key', 'Content-Type', 'Policy', 'file']);
  });

  it('refuses an oversized file before uploading anything', async () => {
    const { api, fetch } = client(() => new Response(null, { status: 204 }));
    await expect(api.uploadFile(signed, new Blob(['x'.repeat(2000)]))).rejects.toMatchObject({ status: 413 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a rejected upload', async () => {
    const { api } = client(() => new Response('<Error/>', { status: 403 }));
    await expect(api.uploadFile(signed, new Blob(['x']))).rejects.toMatchObject({ code: 'upload_failed' });
  });
});

describe('publish', () => {
  it('starts a build and reads the latest status', async () => {
    const { api } = client((_url, init) => (init.method === 'POST' ? reply(202, { status: 'started', buildId: 'b1' }) : reply(200, { latest: { buildStatus: 'SUCCEEDED' } })));
    expect(await api.publish()).toMatchObject({ status: 'started', buildId: 'b1' });
    expect(await api.publishStatus()).toEqual({ latest: { buildStatus: 'SUCCEEDED' }, lastSuccess: null, pending: { count: 0, items: [] } });
  });
});
