import { createHash } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import type { ApiEvent } from '../../lambda/api/lib/http.ts';
import { ContentStore } from '../../lambda/api/lib/store.ts';
import type { Deps } from '../../lambda/api/lib/route.ts';

const sdkError = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
const etagOf = (body: string) => `"${createHash('md5').update(body).digest('hex')}"`;

interface Version {
  body: string;
  etag: string;
  metadata: Record<string, string>;
  at: Date;
  deleteMarker?: boolean;
}

/**
 * In-memory stand-in for a versioned S3 bucket: conditional writes (If-Match / If-None-Match) behave like
 * the real thing, deletes add a marker and keep history, and listing paginates so that path is exercised.
 */
export class FakeS3 {
  readonly versions = new Map<string, Version[]>();
  readonly commands: string[] = [];
  /** Tests move this to put saves before or after a build started. */
  now: () => Date = () => new Date();
  constructor(private readonly pageSize = 1000) {}

  private current(key: string): Version | undefined {
    const v = this.versions.get(key)?.at(-1);
    return v && !v.deleteMarker ? v : undefined;
  }

  /** Test setup: write without any checks. */
  seed(key: string, body: unknown) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const list = this.versions.get(key) ?? [];
    list.push({ body: text, etag: etagOf(text), metadata: {}, at: this.now() });
    this.versions.set(key, list);
  }

  history(key: string) {
    return this.versions.get(key) ?? [];
  }

  async send(command: { constructor: { name: string }; input: any }): Promise<any> {
    const name = command.constructor.name;
    const i = command.input;
    this.commands.push(name);

    switch (name) {
      case 'GetObjectCommand': {
        const v = this.current(i.Key);
        if (!v) throw sdkError('NoSuchKey', 404);
        return { Body: { transformToString: async () => v.body }, ETag: v.etag, LastModified: v.at, Metadata: v.metadata };
      }
      case 'HeadObjectCommand': {
        const v = this.current(i.Key);
        if (!v) throw sdkError('NotFound', 404);
        return { ETag: v.etag, LastModified: v.at };
      }
      case 'PutObjectCommand': {
        const cur = this.current(i.Key);
        if (i.IfNoneMatch === '*' && cur) throw sdkError('PreconditionFailed', 412);
        if (i.IfMatch !== undefined) {
          if (!cur) throw sdkError('NoSuchKey', 404);
          if (cur.etag !== i.IfMatch) throw sdkError('PreconditionFailed', 412);
        }
        const v: Version = { body: String(i.Body), etag: etagOf(String(i.Body)), metadata: i.Metadata ?? {}, at: this.now() };
        this.versions.set(i.Key, [...(this.versions.get(i.Key) ?? []), v]);
        return { ETag: v.etag };
      }
      case 'DeleteObjectCommand': {
        this.versions.set(i.Key, [...(this.versions.get(i.Key) ?? []), { body: '', etag: '', metadata: {}, at: this.now(), deleteMarker: true }]);
        return {};
      }
      case 'ListObjectVersionsCommand': {
        // Every version and marker of every key, newest version of each key flagged IsLatest, in pages like S3.
        const flat = [...this.versions.keys()]
          .filter((k) => k.startsWith(i.Prefix ?? ''))
          .sort()
          .flatMap((Key) => {
            const list = this.versions.get(Key)!;
            return list.map((v, n) => ({ Key, v, IsLatest: n === list.length - 1, VersionId: `${Key}#${n}` }));
          });
        const start = i.KeyMarker ? Number(i.KeyMarker) : 0;
        const page = flat.slice(start, start + this.pageSize);
        const more = start + this.pageSize < flat.length;
        const entry = (e: (typeof flat)[number]) => ({ Key: e.Key, VersionId: e.VersionId, IsLatest: e.IsLatest, LastModified: e.v.at, ETag: e.v.etag });
        return {
          Versions: page.filter((e) => !e.v.deleteMarker).map(entry),
          DeleteMarkers: page.filter((e) => e.v.deleteMarker).map(entry),
          IsTruncated: more,
          NextKeyMarker: more ? String(start + this.pageSize) : undefined,
          NextVersionIdMarker: more ? 'x' : undefined,
        };
      }
      case 'ListObjectsV2Command': {
        const all = [...this.versions.keys()].filter((k) => k.startsWith(i.Prefix ?? '') && this.current(k)).sort();
        const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
        const page = all.slice(start, start + this.pageSize);
        const more = start + this.pageSize < all.length;
        return {
          Contents: page.map((Key) => ({ Key, ETag: this.current(Key)!.etag, LastModified: this.current(Key)!.at, Size: this.current(Key)!.body.length })),
          IsTruncated: more,
          NextContinuationToken: more ? String(start + this.pageSize) : undefined,
        };
      }
      default:
        throw new Error(`FakeS3: unsupported command ${name}`);
    }
  }
}

export const CONTENT_BUCKET = 'content-bucket';
export const MEDIA_BUCKET = 'media-bucket';

export function makeDeps(opts: { s3?: FakeS3; codebuild?: { send: (c: any) => Promise<any> }; buildProject?: string } = {}) {
  const s3 = opts.s3 ?? new FakeS3();
  let n = 0;
  const deps: Deps = {
    store: new ContentStore(s3 as any, CONTENT_BUCKET),
    // A real client, only used to presign: no network call is made, and the credentials are fake.
    s3: new S3Client({ region: 'ap-south-1', credentials: { accessKeyId: 'AKIAFAKEFAKEFAKEFAKE', secretAccessKey: 'fake-secret' } }),
    mediaBucket: MEDIA_BUCKET,
    codebuild: (opts.codebuild ?? { send: async () => ({}) }) as Deps['codebuild'],
    buildProject: opts.buildProject,
    randomId: () => `r${String(++n).padStart(7, '0')}`,
  };
  return { deps, s3 };
}

export function makeEvent(opts: {
  routeKey?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  /** Set to null for an unauthenticated request. */
  claims?: Record<string, unknown> | null;
}): ApiEvent {
  const claims = opts.claims === undefined ? { token_use: 'access', username: 'asha', sub: 'sub-1', 'cognito:groups': '[organizers]' } : opts.claims;
  return {
    routeKey: opts.routeKey,
    headers: opts.headers ?? {},
    pathParameters: opts.params,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    requestContext: { authorizer: claims ? { jwt: { claims } } : undefined },
  };
}

// ---- Minimal valid documents -----------------------------------------------------------------
export const organizerDoc = { name: 'Asha Verma', role: 'Lead organizer' };
export const speakerDoc = { name: 'Ravi Kumar', consent: { publish: true } };
export const sponsorDoc = { name: 'Example Corp', url: 'https://example.org/', defaultTier: 'gold' };
export const eventDoc = (over: Record<string, unknown> = {}) => ({
  title: 'Online session: IAM basics',
  summary: 'A short live session on IAM.',
  series: 'online-session',
  size: 'small',
  mode: 'online',
  start: '2027-03-01T19:00:00+05:30',
  end: '2027-03-01T20:30:00+05:30',
  overview: 'We cover IAM roles and policies.',
  ...over,
});
export const postDoc = (over: Record<string, unknown> = {}) => ({
  title: 'Hello',
  description: 'A post.',
  pubDate: '2027-01-10T10:00:00+05:30',
  author: 'asha-verma',
  body: 'Body text.',
  ...over,
});
