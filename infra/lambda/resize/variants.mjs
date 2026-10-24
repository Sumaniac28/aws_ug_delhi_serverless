// Pure image logic for the resize Lambda, kept separate from the AWS plumbing so it can be tested locally.
// Convention shared with the site (src/lib/media.ts):
//   uploads/events/x/poster.jpg  ->  media/events/x/poster-480.webp, -960.webp, -1600.webp
import sharp from 'sharp';

export const WIDTHS = [480, 960, 1600];
export const UPLOAD_PREFIX = 'uploads/';
export const MEDIA_PREFIX = 'media/';
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

// sharp's prebuilt binaries cannot decode HEIC/HEIF (iPhone default). Unsupported files are skipped, not crashed on.
const SUPPORTED = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff']);

export const extensionOf = (key) => (key.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();

export function isSupported(key) {
  return key.startsWith(UPLOAD_PREFIX) && !key.endsWith('/') && SUPPORTED.has(extensionOf(key));
}

/** S3 event keys are URL-encoded and use "+" for spaces. */
export const decodeKey = (raw) => decodeURIComponent(raw.replace(/\+/g, ' '));

export function variantKey(uploadKey, width) {
  if (!uploadKey.startsWith(UPLOAD_PREFIX)) throw new Error(`Not an upload key: ${uploadKey}`);
  const stem = uploadKey.slice(UPLOAD_PREFIX.length).replace(/\.[^./]+$/, '');
  return `${MEDIA_PREFIX}${stem}-${width}.webp`;
}

/**
 * Produces one WebP per width. Orientation is applied first (phones store rotation in EXIF), then all
 * metadata is dropped: sharp keeps none unless asked, which removes GPS position, device and timestamps.
 * Images are never enlarged, so a small original yields identical smaller-than-advertised variants.
 */
export async function makeVariants(input) {
  const base = sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate();
  return Promise.all(
    WIDTHS.map(async (width) => ({
      width,
      body: await base.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toBuffer(),
    })),
  );
}
