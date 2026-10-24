/**
 * Where an uploaded photo can be previewed. The site serves processed files at <site>/media/<stem>-<w>.webp
 * (written by the resize function); SVGs are served as they are. Mirrors src/lib/media.ts on the site.
 */
const isVector = (key: string) => /\.svg$/i.test(key);
const stem = (key: string) => key.replace(/\.[^.]+$/, '');

export function mediaUrl(siteUrl: string, key: string, width: 480 | 960 | 1600 = 480): string {
  return isVector(key) ? `${siteUrl}/media/${key}` : `${siteUrl}/media/${stem(key)}-${width}.webp`;
}
