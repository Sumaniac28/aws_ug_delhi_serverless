// Cuts the chapter's Delhi skyline hexagon out of the previous site's logo (src/assets/logi&icons/UGLogo.JPG in
// Sumaniac28/awsugdelhincr) and writes the sizes the site uses. Only the hexagon is taken: the "aws" smile wordmark
// next to it stays out until AWS confirms the name in writing (DESIGN.md, Brand and trademark).
//
//   npm run brand:badge -- --old ../old-site
//
// Writes src/assets/brand/ug-badge.png (the master, transparent) and public/brand/* (header, favicons, touch icon).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(new URL('../../infra/package.json', import.meta.url))('sharp');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAPER = '#fbfaf7';

/** Bounding box of the gold outline: warm, saturated pixels (the hexagon's stroke is the only gold left of the text). */
export async function goldBox(file, maxX) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < Math.min(info.width, maxX); x++) {
      const i = (y * info.width + x) * 3;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 170 && g > 120 && b < 110 && r - b > 90) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) throw new Error('No gold outline found; is this the right file?');
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** A pointy-top hexagon filling the box: everything outside it (the black background) becomes transparent. */
const hexMask = (w, h) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><polygon fill="#fff" points="${w / 2},0 ${w},${h / 4} ${w},${(3 * h) / 4} ${w / 2},${h} 0,${(3 * h) / 4} 0,${h / 4}"/></svg>`,
  );

export async function extractBadge(source) {
  const box = await goldBox(source, 560); // the hexagon ends near x=540; the gold "USER GROUP" text starts near x=578
  const cut = await sharp(source).extract(box).toBuffer();
  return sharp(cut).ensureAlpha().composite([{ input: hexMask(box.width, box.height), blend: 'dest-in' }]).png().toBuffer();
}

/** The badge centred on a square canvas, transparent or on paper. */
const square = async (badge, size, { pad = 0.06, background } = {}) => {
  const inner = Math.round(size * (1 - 2 * pad));
  const fitted = await sharp(badge).resize({ height: inner, width: inner, fit: 'inside' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png()
    .toBuffer();
};

async function main() {
  const i = process.argv.indexOf('--old');
  const old = i > 0 ? process.argv[i + 1] : process.env.OLD_SITE_DIR;
  if (!old) throw new Error('Say where the old site is: --old <path>');
  const badge = await extractBadge(join(resolve(old), 'src/assets/logi&icons/UGLogo.JPG'));

  const master = join(ROOT, 'src/assets/brand');
  const pub = join(ROOT, 'public/brand');
  mkdirSync(master, { recursive: true });
  mkdirSync(pub, { recursive: true });
  writeFileSync(join(master, 'ug-badge.png'), badge);
  for (const h of [48, 96]) {
    const img = sharp(badge).resize({ height: h });
    writeFileSync(join(pub, `ug-badge-${h}.png`), await img.clone().png().toBuffer());
    writeFileSync(join(pub, `ug-badge-${h}.webp`), await img.clone().webp({ quality: 90 }).toBuffer());
  }
  for (const s of [32, 48]) writeFileSync(join(pub, `favicon-${s}.png`), await square(badge, s, { pad: 0.02 }));
  const meta = await sharp(badge).metadata();
  console.log(`Badge ${meta.width}x${meta.height} written to src/assets/brand/ug-badge.png; header and favicon sizes in public/brand/.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
