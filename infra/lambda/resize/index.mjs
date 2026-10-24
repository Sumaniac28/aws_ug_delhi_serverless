// S3 ObjectCreated handler for uploads/ in the media bucket (ADR-002 decision 6).
// Writes resized WebP variants under media/ with EXIF (including GPS) stripped.
// The AWS SDK v3 is provided by the Node.js 22 Lambda runtime, so only sharp is bundled.
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MAX_INPUT_BYTES, decodeKey, isSupported, makeVariants, variantKey } from './variants.mjs';

const s3 = new S3Client({});
const CACHE_CONTROL = 'public, max-age=31536000, immutable'; // variants are immutable: upload under a new key to replace

export async function handler(event) {
  const results = [];
  for (const record of event.Records ?? []) {
    const bucket = record.s3.bucket.name;
    const key = decodeKey(record.s3.object.key);

    if (!isSupported(key)) {
      console.log(JSON.stringify({ msg: 'skipped: not a supported image under uploads/', key }));
      continue;
    }
    if ((record.s3.object.size ?? 0) > MAX_INPUT_BYTES) {
      console.error(JSON.stringify({ msg: 'skipped: file too large', key, size: record.s3.object.size }));
      continue;
    }

    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const input = Buffer.from(await object.Body.transformToByteArray());
    const variants = await makeVariants(input);

    await Promise.all(
      variants.map(({ width, body }) =>
        s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: variantKey(key, width),
            Body: body,
            ContentType: 'image/webp',
            CacheControl: CACHE_CONTROL,
          }),
        ),
      ),
    );
    console.log(JSON.stringify({ msg: 'resized', key, variants: variants.map((v) => ({ width: v.width, bytes: v.body.length })) }));
    results.push(key);
  }
  return { processed: results };
}
