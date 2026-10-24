// POST /uploads: hands the browser a presigned POST so photos go straight to S3, never through Lambda.
// The resize function then turns uploads/<key> into media/<stem>-480|960|1600.webp.
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { HttpError, json, jsonBody, type ApiEvent, type ApiResult } from '../lib/http.ts';
import type { Ctx } from '../lib/route.ts';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

// HEIC (iPhone default) is deliberately absent: the resize function's image library cannot decode it.
const TYPES: Record<string, string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  avif: ['image/avif'],
  gif: ['image/gif'],
  tif: ['image/tiff'],
  tiff: ['image/tiff'],
};

/** Where an image may live: under the item that uses it, e.g. events/meetup-13-gurugram. */
const FOLDER = /^(events|speakers|sponsors|organizers|posts)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';

export async function sign(event: ApiEvent, { organizer, deps }: Ctx): Promise<ApiResult> {
  const body = jsonBody(event, 4 * 1024) as { folder?: unknown; filename?: unknown; contentType?: unknown };
  const { folder, filename, contentType } = body;
  if (typeof folder !== 'string' || !FOLDER.test(folder)) throw new HttpError(400, 'bad_folder', 'folder must look like "events/<id>", "speakers/<id>", "sponsors/<id>", "organizers/<id>" or "posts/<id>".');
  if (typeof filename !== 'string' || typeof contentType !== 'string') throw new HttpError(400, 'bad_request', 'filename and contentType are required.');

  const ext = filename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? '';
  const allowed = TYPES[ext];
  if (!allowed) {
    const hint = /^hei[cf]$/.test(ext) ? ' iPhone HEIC photos must be converted to JPEG first.' : '';
    throw new HttpError(415, 'unsupported_type', `Upload a JPEG, PNG, WebP, AVIF, GIF or TIFF image.${hint}`);
  }
  if (!allowed.includes(contentType)) throw new HttpError(415, 'type_mismatch', `A .${ext} file must be sent as ${allowed.join(' or ')}.`);

  // A fresh random suffix on every upload: processed variants are cached as immutable, so replacing a
  // photo means a new key, and the old one simply stops being referenced.
  const stem = slugify(filename.replace(/\.[^.]+$/, ''));
  const mediaKey = `${folder}/${stem}-${deps.randomId()}.${ext}`;
  const uploadKey = `uploads/${mediaKey}`;

  const post = await createPresignedPost(deps.s3, {
    Bucket: deps.mediaBucket,
    Key: uploadKey,
    Expires: URL_TTL_SECONDS,
    Fields: { 'Content-Type': contentType, 'x-amz-meta-uploaded-by': organizer.username },
    Conditions: [
      ['eq', '$key', uploadKey],
      ['eq', '$Content-Type', contentType],
      ['eq', '$x-amz-meta-uploaded-by', organizer.username],
      ['content-length-range', 1, MAX_UPLOAD_BYTES],
    ],
  });

  const stemKey = mediaKey.replace(/\.[^.]+$/, '');
  return json(200, {
    url: post.url,
    fields: post.fields,
    expiresInSeconds: URL_TTL_SECONDS,
    maxBytes: MAX_UPLOAD_BYTES,
    /** Store this in the document (poster, gallery.media, photo, logo). It is what the site resolves. */
    mediaKey,
    /** Where the processed files appear, a few seconds after the upload completes. */
    variants: [480, 960, 1600].map((w) => `media/${stemKey}-${w}.webp`),
  });
}
