/**
 * Sign-in with Cognito's hosted page, using the authorization-code flow with PKCE (no client secret exists
 * in a browser app; the one-time verifier proves the code was requested by this tab).
 *
 * The hosted page handles passwords, the temporary-password change and authenticator-app set-up. This file
 * only starts the redirect, exchanges the returned code, and keeps the tokens fresh.
 *
 * Tokens live in sessionStorage: they survive a reload but not a closed tab. Cognito's own session cookie
 * makes signing in again quick. The strict CSP on the admin origin is what protects them from injected script.
 */

export interface Tokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface User {
  username: string;
  groups: string[];
}

/** What the rest of the app needs from authentication. */
export interface Auth {
  isSignedIn(): boolean;
  user(): User | null;
  /** A valid access token, refreshing it if needed. Rejects with AuthError('login_required') if it cannot. */
  accessToken(): Promise<string>;
  login(returnTo?: string): Promise<void>;
  logout(): void;
}

export class AuthError extends Error {
  constructor(
    public readonly code: 'login_required' | 'exchange_failed' | 'state_mismatch' | 'denied',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomString(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function challengeFor(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export interface CognitoAuthOptions {
  /** https://<prefix>.auth.<region>.amazoncognito.com */
  domain: string;
  clientId: string;
  /** Must exactly match a callback URL registered on the app client (the admin origin plus "/"). */
  redirectUri: string;
  fetch?: typeof fetch;
  storage?: Storage;
  /** Navigates the browser. Injected so tests do not need a real page. */
  navigate?: (url: string) => void;
  now?: () => number;
}

const TOKENS_KEY = 'awsug.tokens';
const PKCE_KEY = 'awsug.pkce';
const REFRESH_MARGIN_MS = 60_000;

export class CognitoAuth implements Auth {
  private readonly fetch: typeof fetch;
  private readonly storage: Storage;
  private readonly navigate: (url: string) => void;
  private readonly now: () => number;
  private refreshing: Promise<Tokens> | null = null;

  constructor(private readonly opts: CognitoAuthOptions) {
    this.fetch = opts.fetch ?? ((...a) => fetch(...a));
    this.storage = opts.storage ?? sessionStorage;
    this.navigate = opts.navigate ?? ((url) => window.location.assign(url));
    this.now = opts.now ?? Date.now;
  }

  private read(): Tokens | null {
    try {
      const raw = this.storage.getItem(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  }
  private write(t: Tokens | null) {
    if (t) this.storage.setItem(TOKENS_KEY, JSON.stringify(t));
    else this.storage.removeItem(TOKENS_KEY);
  }

  isSignedIn() {
    const t = this.read();
    return !!t && (t.expiresAt > this.now() || !!t.refreshToken);
  }

  user(): User | null {
    const t = this.read();
    if (!t) return null;
    const claims = decodeJwt(t.accessToken);
    const groups = claims['cognito:groups'];
    return {
      username: typeof claims.username === 'string' ? claims.username : 'organizer',
      groups: Array.isArray(groups) ? groups.map(String) : [],
    };
  }

  /** Sends the browser to Cognito. Remembers where to come back to. */
  async login(returnTo = '/') {
    const verifier = randomString(48);
    const state = randomString(16);
    this.storage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo }));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.opts.clientId,
      redirect_uri: this.opts.redirectUri,
      scope: 'openid email profile',
      state,
      code_challenge_method: 'S256',
      code_challenge: await challengeFor(verifier),
    });
    this.navigate(`${this.opts.domain}/oauth2/authorize?${params}`);
  }

  /**
   * Call once on page load. If the URL carries a code from Cognito, exchanges it for tokens and returns the
   * path to continue to; returns null when this is not a sign-in redirect.
   */
  async handleRedirect(url: URL): Promise<string | null> {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!code && !error) return null;

    const saved = this.storage.getItem(PKCE_KEY);
    this.storage.removeItem(PKCE_KEY);
    if (error) throw new AuthError('denied', url.searchParams.get('error_description') ?? 'Sign-in was cancelled.');

    const pkce = saved ? (JSON.parse(saved) as { verifier: string; state: string; returnTo: string }) : null;
    if (!pkce || pkce.state !== url.searchParams.get('state')) {
      throw new AuthError('state_mismatch', 'This sign-in did not start in this browser tab. Please sign in again.');
    }

    const tokens = await this.token({
      grant_type: 'authorization_code',
      client_id: this.opts.clientId,
      code: code!,
      redirect_uri: this.opts.redirectUri,
      code_verifier: pkce.verifier,
    });
    this.write(tokens);
    return pkce.returnTo || '/';
  }

  async accessToken(): Promise<string> {
    const t = this.read();
    if (!t) throw new AuthError('login_required', 'Sign in to continue.');
    if (t.expiresAt - REFRESH_MARGIN_MS > this.now()) return t.accessToken;
    if (!t.refreshToken) {
      this.write(null);
      throw new AuthError('login_required', 'Your session has ended. Sign in again.');
    }
    // Share one refresh between simultaneous calls.
    this.refreshing ??= this.token({ grant_type: 'refresh_token', client_id: this.opts.clientId, refresh_token: t.refreshToken })
      .then((fresh) => {
        const merged = { ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken }; // Cognito does not re-issue it
        this.write(merged);
        return merged;
      })
      .catch(() => {
        this.write(null);
        throw new AuthError('login_required', 'Your session has ended. Sign in again.');
      })
      .finally(() => {
        this.refreshing = null;
      });
    return (await this.refreshing).accessToken;
  }

  logout() {
    this.write(null);
    const params = new URLSearchParams({ client_id: this.opts.clientId, logout_uri: this.opts.redirectUri });
    this.navigate(`${this.opts.domain}/logout?${params}`);
  }

  private async token(form: Record<string, string>): Promise<Tokens> {
    let res: Response;
    try {
      res = await this.fetch(`${this.opts.domain}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
    } catch {
      throw new AuthError('exchange_failed', 'Could not reach the sign-in service. Check your connection.');
    }
    if (!res.ok) throw new AuthError('exchange_failed', 'The sign-in could not be completed. Please sign in again.');
    const body = (await res.json()) as { access_token: string; id_token?: string; refresh_token?: string; expires_in: number };
    return { accessToken: body.access_token, idToken: body.id_token, refreshToken: body.refresh_token, expiresAt: this.now() + body.expires_in * 1000 };
  }
}

/** Local development only (config.devAuth): no Cognito, a fixed organizer. The mock API accepts any token. */
export class DevAuth implements Auth {
  isSignedIn() {
    return true;
  }
  user(): User {
    return { username: 'dev-organizer', groups: ['organizers'] };
  }
  async accessToken() {
    return 'dev-token';
  }
  async login() {}
  logout() {
    window.location.assign('/');
  }
}
