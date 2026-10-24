import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { HttpError } from './http.ts';
import { contentKey, contentPrefix, type CollectionName } from './collections.ts';

/** Only `send` is used, so tests can substitute an in-memory fake. */
export type S3Like = Pick<S3Client, 'send'>;

export interface StoredDoc {
  data: unknown;
  /** S3 ETag including its quotes, exactly as S3 returned it. Used as the version for If-Match. */
  etag: string;
  lastModified?: Date;
  editor?: string;
}

export interface ListedDoc {
  id: string;
  etag: string;
  lastModified?: Date;
  size?: number;
}

const errName = (e: unknown) => (e as { name?: string })?.name;
const errStatus = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const isMissing = (e: unknown) => errName(e) === 'NoSuchKey' || errName(e) === 'NotFound' || errStatus(e) === 404;

/**
 * Versioned JSON documents in the content bucket (ADR-002 decision 3). Writes are conditional on the
 * ETag the editor last saw, so two organizers cannot silently overwrite each other. The bucket is
 * versioned, so every save and delete stays recoverable.
 */
export class ContentStore {
  constructor(
    private readonly s3: S3Like,
    private readonly bucket: string,
  ) {}

  async get(collection: CollectionName, id: string): Promise<StoredDoc | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: contentKey(collection, id) }));
      const text = await res.Body!.transformToString('utf-8');
      return { data: JSON.parse(text), etag: res.ETag!, lastModified: res.LastModified, editor: res.Metadata?.['edited-by'] };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async exists(collection: CollectionName, id: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: contentKey(collection, id) }));
      return true;
    } catch (e) {
      if (isMissing(e)) return false;
      throw e;
    }
  }

  /**
   * Writes a document. Pass exactly one of ifMatch (update: the ETag you last read) or ifNoneMatch
   * (create: fails if the document already exists). Returns the new ETag.
   */
  async put(collection: CollectionName, id: string, data: unknown, opts: { ifMatch?: string; ifNoneMatch?: '*'; editor: string }): Promise<string> {
    try {
      const res = await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: contentKey(collection, id),
          Body: JSON.stringify(data, null, 2) + '\n',
          ContentType: 'application/json',
          CacheControl: 'no-store',
          Metadata: { 'edited-by': opts.editor },
          IfMatch: opts.ifMatch,
          IfNoneMatch: opts.ifNoneMatch,
        }),
      );
      return res.ETag!;
    } catch (e) {
      if (errName(e) === 'PreconditionFailed' || errStatus(e) === 412) {
        throw new HttpError(412, 'conflict', opts.ifNoneMatch ? 'That item already exists.' : 'Someone else changed this item since you opened it. Reload it and re-apply your edit.');
      }
      if (errName(e) === 'ConditionalRequestConflict' || errStatus(e) === 409) {
        throw new HttpError(409, 'conflict_in_progress', 'Another save of this item is in progress. Try again in a moment.');
      }
      if (opts.ifMatch && isMissing(e)) throw new HttpError(404, 'not_found', 'This item no longer exists.');
      throw e;
    }
  }

  /** The bucket is versioned, so this adds a delete marker; earlier versions stay recoverable. */
  async remove(collection: CollectionName, id: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: contentKey(collection, id) }));
  }

  async list(collection: CollectionName): Promise<ListedDoc[]> {
    const prefix = contentPrefix(collection);
    const out: ListedDoc[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) {
        if (!o.Key?.endsWith('.json')) continue;
        out.push({ id: o.Key.slice(prefix.length, -'.json'.length), etag: o.ETag!, lastModified: o.LastModified, size: o.Size });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/** Runs fn over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
