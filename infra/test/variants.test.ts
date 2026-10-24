import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
// @ts-expect-error plain ES module without type declarations
import { WIDTHS, decodeKey, isSupported, makeVariants, variantKey } from '../lambda/resize/variants.mjs';

/** A JPEG that carries what a phone writes: GPS position, orientation and a copyright tag. */
async function phonePhoto(width = 3000, height = 2000, orientation?: number) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg();
  img = img.withExif({
    IFD0: { Copyright: 'someone' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '28/1 36/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 12/1 0/1' },
  });
  if (orientation) img = img.withMetadata({ orientation });
  return img.toBuffer();
}

describe('variant keys', () => {
  it('maps uploads/ to media/ with the width and a .webp extension (matches src/lib/media.ts)', () => {
    assert.equal(variantKey('uploads/events/x/poster.jpg', 480), 'media/events/x/poster-480.webp');
    assert.equal(variantKey('uploads/a.b/c.PNG', 1600), 'media/a.b/c-1600.webp');
  });
  it('rejects keys outside uploads/', () => {
    assert.throws(() => variantKey('media/x.jpg', 480));
  });
  it('decodes S3 event keys', () => {
    assert.equal(decodeKey('uploads/my+photo%2B1.jpg'), 'uploads/my photo+1.jpg');
  });
  it('only accepts decodable images under uploads/ (HEIC is skipped, not crashed on)', () => {
    assert.ok(isSupported('uploads/a/b.JPG'));
    assert.ok(isSupported('uploads/a/b.webp'));
    assert.ok(!isSupported('uploads/a/b.heic'));
    assert.ok(!isSupported('uploads/a/b.pdf'));
    assert.ok(!isSupported('media/a/b.jpg'));
    assert.ok(!isSupported('uploads/folder/'));
  });
});

describe('makeVariants', () => {
  it('produces WebP at 480, 960 and 1600 wide for a large photo', async () => {
    const out = await makeVariants(await phonePhoto());
    assert.deepEqual(out.map((v: { width: number }) => v.width), WIDTHS);
    for (const v of out as { width: number; body: Buffer }[]) {
      const meta = await sharp(v.body).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, v.width);
    }
  });

  it('strips EXIF including GPS from every variant', async () => {
    const source = await phonePhoto();
    assert.ok((await sharp(source).metadata()).exif, 'precondition: the test photo really carries EXIF');
    for (const v of (await makeVariants(source)) as { body: Buffer }[]) {
      const meta = await sharp(v.body).metadata();
      assert.equal(meta.exif, undefined);
      assert.equal(meta.icc, undefined);
    }
  });

  it('applies EXIF orientation before stripping it, so portrait photos are not left sideways', async () => {
    const [first] = (await makeVariants(await phonePhoto(400, 200, 6))) as { body: Buffer }[];
    const meta = await sharp(first!.body).metadata();
    assert.equal(meta.width, 200);
    assert.equal(meta.height, 400);
  });

  it('never enlarges a small original', async () => {
    const out = (await makeVariants(await phonePhoto(300, 200))) as { body: Buffer }[];
    for (const v of out) assert.equal((await sharp(v.body).metadata()).width, 300);
  });

  it('rejects corrupt input instead of writing garbage', async () => {
    await assert.rejects(makeVariants(Buffer.from('not an image')));
  });
});
