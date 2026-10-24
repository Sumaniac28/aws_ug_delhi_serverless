// Minimal HTTP API (payload v2) plumbing. No framework: six small handlers do not need one.

export interface ApiEvent {
  routeKey?: string;
  /** HTTP API lowercases header names. */
  headers: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };
}

export interface ApiResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

/** An error the client should see, with a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): ApiResult {
  return { statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) };
}

export const header = (event: ApiEvent, name: string) => event.headers?.[name.toLowerCase()];

export function pathParam(event: ApiEvent, name: string): string {
  const v = event.pathParameters?.[name];
  if (!v) throw new HttpError(400, 'bad_request', `Missing path parameter "${name}".`);
  return v;
}

/** Parses a JSON request body, refusing anything larger than maxBytes. */
export function jsonBody(event: ApiEvent, maxBytes: number): unknown {
  if (event.body === undefined || event.body === '') throw new HttpError(400, 'bad_request', 'A JSON request body is required.');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new HttpError(413, 'too_large', `The request body is larger than ${Math.round(maxBytes / 1024)} KB.`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
  }
}
