/**
 * Media keys point at objects in the media bucket (ADR-002 #6). The resize Lambda writes
 * WebP variants next to each original: "events/x/poster.jpg" becomes
 * "<base>/events/x/poster-480.webp", "-960.webp" and "-1600.webp".
 * SVGs (used for the sample artwork) are served as-is.
 */
export const MEDIA_BASE = (import.meta.env.PUBLIC_MEDIA_BASE ?? '/media').replace(/\/$/, '');

export const MEDIA_WIDTHS = [480, 960, 1600] as const;

const isVector = (key: string) => /\.svg$/i.test(key);
const stem = (key: string) => key.replace(/\.[^.]+$/, '');

export interface MediaSource {
  src: string;
  srcset?: string;
}

export function mediaSource(key: string, fallbackWidth: (typeof MEDIA_WIDTHS)[number] = 960): MediaSource {
  if (isVector(key)) return { src: `${MEDIA_BASE}/${key}` };
  return {
    src: `${MEDIA_BASE}/${stem(key)}-${fallbackWidth}.webp`,
    srcset: MEDIA_WIDTHS.map((w) => `${MEDIA_BASE}/${stem(key)}-${w}.webp ${w}w`).join(', '),
  };
}

/** Absolute URL for JSON-LD / Open Graph; undefined for vectors, which social platforms ignore. */
export function absoluteMediaUrl(key: string | undefined, site: URL | string | undefined, width: (typeof MEDIA_WIDTHS)[number] = 1600) {
  if (!key || isVector(key)) return undefined;
  return new URL(mediaSource(key, width).src, site).href;
}
