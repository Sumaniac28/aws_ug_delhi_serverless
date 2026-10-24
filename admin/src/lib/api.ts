/** Typed client for the Phase 4 admin API (infra/lambda/api). */

export type CollectionName = 'events' | 'speakers' | 'sponsors' | 'organizers' | 'posts';
export type Doc = Record<string, any>;

export interface ListItem {
  id: string;
  etag: string;
  lastModified?: string;
  editor?: string;
  /** The document no longer matches the schema (flagged, not hidden, so someone can fix it). */
  invalid?: boolean;
  [summaryField: string]: unknown;
}

export interface StoredItem {
  id: string;
  etag: string;
  lastModified?: string;
  editor?: string;
  data: Doc;
}

export interface SignedUpload {
  url: string;
  fields: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
  /** Store this in the document; it is what the public site resolves. */
  mediaKey: string;
  variants: string[];
}

/** Something that did not stop a save from working but the organizer should know. */
export interface Warning {
  code: string;
  message: string;
}

export interface BuildSummary {
  buildId?: string;
  buildStatus?: string;
  phase?: string;
  startedAt?: string;
  endedAt?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 412;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token: () => Promise<string>;
  /** Called when the API rejects the token (401). The app uses it to send the user to sign in. */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

export class ApiClient {
  private readonly fetch: typeof fetch;
  constructor(private readonly opts: ApiClientOptions) {
    this.fetch = opts.fetch ?? ((...a) => fetch(...a));
  }

  private async request<T>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
    let res: Response;
    try {
      res = await this.fetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await this.opts.token()}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (e) {
      if ((e as { name?: string })?.name === 'AuthError') throw e;
      throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      if (res.status === 401) this.opts.onUnauthorized?.();
      const err = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
      throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `The server answered ${res.status}.`, err?.details);
    }
    return { data: parsed as T, headers: res.headers };
  }

  async list(collection: CollectionName): Promise<ListItem[]> {
    return (await this.request<{ items: ListItem[] }>('GET', `/content/${collection}`)).data.items;
  }

  async get(collection: CollectionName, id: string): Promise<StoredItem> {
    return (await this.request<StoredItem>('GET', `/content/${collection}/${id}`)).data;
  }

  /** Creates a new item. Fails with 412 if the id is already taken. */
  async create(collection: CollectionName, id: string, data: Doc): Promise<{ etag: string; warnings: Warning[] }> {
    const { data: r } = await this.request<{ etag: string; warnings?: Warning[] }>('PUT', `/content/${collection}/${id}`, { body: data, headers: { 'if-none-match': '*' } });
    return { etag: r.etag, warnings: r.warnings ?? [] };
  }

  /** Updates an item, based on the ETag the editor last saw. Fails with 412 if someone else saved since. */
  async update(collection: CollectionName, id: string, data: Doc, etag: string): Promise<{ etag: string; warnings: Warning[] }> {
    const { data: r } = await this.request<{ etag: string; warnings?: Warning[] }>('PUT', `/content/${collection}/${id}`, { body: data, headers: { 'if-match': etag } });
    return { etag: r.etag, warnings: r.warnings ?? [] };
  }

  async remove(collection: CollectionName, id: string, etag?: string): Promise<{ warnings: Warning[] }> {
    const { data: r } = await this.request<{ warnings?: Warning[] }>('DELETE', `/content/${collection}/${id}`, { headers: etag ? { 'if-match': etag } : {} });
    return { warnings: r?.warnings ?? [] };
  }

  async signUpload(req: { folder: string; filename: string; contentType: string }): Promise<SignedUpload> {
    return (await this.request<SignedUpload>('POST', '/uploads', { body: req })).data;
  }

  /** Sends the file straight to S3 with the presigned POST. The file must be the last form field. */
  async uploadFile(signed: SignedUpload, file: Blob): Promise<void> {
    if (file.size > signed.maxBytes) throw new ApiError(413, 'too_large', `Photos can be at most ${Math.round(signed.maxBytes / 1024 / 1024)} MB.`);
    const form = new FormData();
    for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
    form.append('file', file);
    let res: Response;
    try {
      res = await this.fetch(signed.url, { method: 'POST', body: form });
    } catch {
      throw new ApiError(0, 'network', 'The upload could not reach the server. Check your connection and try again.');
    }
    if (!res.ok) throw new ApiError(res.status, 'upload_failed', 'The upload was rejected. The link may have expired; try again.');
  }

  async publish(): Promise<{ status: 'started' | 'already-running' } & BuildSummary> {
    return (await this.request<{ status: 'started' | 'already-running' } & BuildSummary>('POST', '/publish')).data;
  }

  async publishStatus(): Promise<BuildSummary | null> {
    return (await this.request<{ latest: BuildSummary | null }>('GET', '/publish')).data.latest;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
