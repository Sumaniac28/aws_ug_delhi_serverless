/**
 * Runtime configuration. The same build is deployed anywhere: the CDK stack writes config.json next to
 * index.html from its own outputs, so no URL or id is baked into the JavaScript.
 */
export interface AppConfig {
  /** Base URL of the admin API (HTTP API endpoint). */
  apiUrl: string;
  /** Public site origin, used to preview uploaded photos (the site serves /media/*). */
  siteUrl: string;
  /** Cognito hosted sign-in. Absent only with devAuth. */
  cognito?: { domain: string; clientId: string };
  /** Local development against the mock API only: skips Cognito. Never set in a deployment. */
  devAuth?: boolean;
}

export class ConfigError extends Error {}

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v);
const strip = (u: string) => u.replace(/\/+$/, '');

export function parseConfig(raw: unknown): AppConfig {
  const c = raw as Partial<AppConfig> | null;
  if (!c || typeof c !== 'object') throw new ConfigError('config.json is not an object.');
  if (!isUrl(c.apiUrl)) throw new ConfigError('config.json needs "apiUrl" (the admin API address).');
  if (!isUrl(c.siteUrl)) throw new ConfigError('config.json needs "siteUrl" (the public site address).');
  if (!c.devAuth) {
    if (!c.cognito || !isUrl(c.cognito.domain) || !c.cognito.clientId) {
      throw new ConfigError('config.json needs "cognito": { "domain": "https://...", "clientId": "..." }.');
    }
  }
  return {
    apiUrl: strip(c.apiUrl),
    siteUrl: strip(c.siteUrl),
    cognito: c.cognito ? { domain: strip(c.cognito.domain), clientId: c.cognito.clientId } : undefined,
    devAuth: c.devAuth === true,
  };
}

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  let res: Response;
  try {
    res = await fetchImpl('/config.json', { cache: 'no-store' });
  } catch {
    throw new ConfigError('Could not load config.json. Check your connection and reload.');
  }
  if (!res.ok) throw new ConfigError(`Could not load config.json (HTTP ${res.status}).`);
  return parseConfig(await res.json());
}
