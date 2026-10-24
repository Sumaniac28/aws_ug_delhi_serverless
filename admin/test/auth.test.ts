import { describe, expect, it, vi } from 'vitest';
import { AuthError, CognitoAuth, challengeFor, decodeJwt, randomString } from '../src/lib/auth.ts';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
const DOMAIN = 'https://awsug.auth.ap-south-1.amazoncognito.com';
const REDIRECT = 'https://admin.example.org/';

function setup(over: { fetch?: typeof fetch; now?: () => number } = {}) {
  const navigate = vi.fn();
  const storage = sessionStorage;
  const auth = new CognitoAuth({ domain: DOMAIN, clientId: 'client-1', redirectUri: REDIRECT, navigate, storage, ...over });
  return { auth, navigate, storage };
}
const tokenResponse = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: jwt({ username: 'asha', 'cognito:groups': ['organizers'] }), id_token: 'id', refresh_token: 'refresh-1', expires_in: 3600, ...over }), { status: 200 });

describe('PKCE helpers', () => {
  it('produces the RFC 7636 S256 challenge', async () => {
    // Test vector from RFC 7636, appendix B.
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes unique URL-safe random strings', () => {
    const a = randomString(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(randomString(32));
  });
  it('decodes JWT payloads and tolerates garbage', () => {
    expect(decodeJwt(jwt({ username: 'asha' }))).toEqual({ username: 'asha' });
    expect(decodeJwt('not-a-jwt')).toEqual({});
  });
});

describe('login', () => {
  it('redirects to the hosted page with a code challenge and remembers the verifier and state', async () => {
    const { auth, navigate, storage } = setup();
    await auth.login('/c/events');
    const url = new URL(navigate.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe(`${DOMAIN}/oauth2/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const saved = JSON.parse(storage.getItem('awsug.pkce')!);
    expect(url.searchParams.get('code_challenge')).toBe(await challengeFor(saved.verifier));
    expect(url.searchParams.get('state')).toBe(saved.state);
    expect(saved.returnTo).toBe('/c/events');
  });
});

describe('handleRedirect', () => {
  it('returns null when the URL is not a sign-in redirect', async () => {
    const { auth } = setup();
    expect(await auth.handleRedirect(new URL(REDIRECT))).toBeNull();
  });

  it('exchanges the code with the stored verifier, stores tokens and returns where to go next', async () => {
    const fetch = vi.fn(async () => tokenResponse());
    const { auth, storage } = setup({ fetch: fetch as any, now: () => 1_000_000 });
    await auth.login('/c/speakers');
    const { verifier, state } = JSON.parse(storage.getItem('awsug.pkce')!);

    const next = await auth.handleRedirect(new URL(`${REDIRECT}?code=abc&state=${state}`));
    expect(next).toBe('/c/speakers');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DOMAIN}/oauth2/token`);
    const body = new URLSearchParams((init.body as URLSearchParams).toString());
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'authorization_code', client_id: 'client-1', code: 'abc', redirect_uri: REDIRECT, code_verifier: verifier });
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.user()).toEqual({ username: 'asha', groups: ['organizers'] });
    expect(storage.getItem('awsug.pkce')).toBeNull();
  });

  it('refuses a redirect whose state does not match (cross-site request) without calling Cognito', async () => {
    const fetch = vi.fn();
    const { auth } = setup({ fetch: fetch as any });
    await auth.login();
    await expect(auth.handleRedirect(new URL(`${REDIRECT}?code=abc&state=forged`))).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a redirect that this tab never started', async () => {
    const { auth } = setup({ fetch: vi.fn() as any });
    await expect(auth.handleRedirect(new URL(`${REDIRECT}?code=abc&state=x`))).rejects.toMatchObject({ code: 'state_mismatch' });
  });

  it('reports a cancelled or denied sign-in', async () => {
    const { auth } = setup();
    await expect(auth.handleRedirect(new URL(`${REDIRECT}?error=access_denied&error_description=Nope`))).rejects.toMatchObject({ code: 'denied', message: 'Nope' });
  });

  it('reports a failed code exchange', async () => {
    const { auth, storage } = setup({ fetch: (async () => new Response('{}', { status: 400 })) as any });
    await auth.login();
    const { state } = JSON.parse(storage.getItem('awsug.pkce')!);
    await expect(auth.handleRedirect(new URL(`${REDIRECT}?code=bad&state=${state}`))).rejects.toMatchObject({ code: 'exchange_failed' });
    expect(auth.isSignedIn()).toBe(false);
  });
});

describe('accessToken', () => {
  const seed = (storage: Storage, over: Record<string, unknown> = {}) =>
    storage.setItem('awsug.tokens', JSON.stringify({ accessToken: jwt({ username: 'asha', 'cognito:groups': ['organizers'] }), refreshToken: 'refresh-1', expiresAt: 10_000_000, ...over }));

  it('rejects when nobody is signed in', async () => {
    const { auth } = setup();
    await expect(auth.accessToken()).rejects.toMatchObject({ name: 'AuthError', code: 'login_required' });
  });

  it('returns a still-valid token without calling Cognito', async () => {
    const fetch = vi.fn();
    const { auth, storage } = setup({ fetch: fetch as any, now: () => 1_000_000 });
    seed(storage);
    expect(await auth.accessToken()).toContain('.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes a token about to expire and keeps the refresh token Cognito does not re-issue', async () => {
    const fetch = vi.fn(async () => tokenResponse({ refresh_token: undefined, access_token: jwt({ username: 'asha-new' }) }));
    const { auth, storage } = setup({ fetch: fetch as any, now: () => 9_990_000 }); // 10 s before expiry
    seed(storage);
    await auth.accessToken();
    const body = (fetch.mock.calls[0] as any)[1].body as URLSearchParams;
    expect(Object.fromEntries(new URLSearchParams(body.toString()))).toEqual({ grant_type: 'refresh_token', client_id: 'client-1', refresh_token: 'refresh-1' });
    expect(JSON.parse(storage.getItem('awsug.tokens')!).refreshToken).toBe('refresh-1');
    expect(auth.user()?.username).toBe('asha-new');
  });

  it('shares one refresh between simultaneous calls', async () => {
    const fetch = vi.fn(async () => tokenResponse());
    const { auth, storage } = setup({ fetch: fetch as any, now: () => 9_990_000 });
    seed(storage);
    await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('signs the user out when the refresh is refused', async () => {
    const { auth, storage } = setup({ fetch: (async () => new Response('{}', { status: 400 })) as any, now: () => 9_990_000 });
    seed(storage);
    await expect(auth.accessToken()).rejects.toBeInstanceOf(AuthError);
    expect(storage.getItem('awsug.tokens')).toBeNull();
  });

  it('requires sign-in again when the token expired and there is no refresh token', async () => {
    const { auth, storage } = setup({ now: () => 20_000_000 });
    seed(storage, { refreshToken: undefined });
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'login_required' });
  });
});

describe('logout', () => {
  it('clears the tokens and ends the Cognito session', () => {
    const { auth, navigate, storage } = setup();
    storage.setItem('awsug.tokens', '{}');
    auth.logout();
    expect(storage.getItem('awsug.tokens')).toBeNull();
    const url = new URL(navigate.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('logout_uri')).toBe(REDIRECT);
  });
});
