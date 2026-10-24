/**
 * Social-card and logo images, generated at build time (ADR-002 P1 "Generated OG images").
 *
 * Satori lays out a small element tree and turns text into vector paths, so no fonts are needed at render time;
 * resvg then rasterizes the SVG to PNG. Flat paper, ink type, the chapter badge and the marigold metro line: the same
 * system as the site (DESIGN.md), with no AWS marks. Fonts are the static Fontsource WOFF files (Satori cannot read WOFF2).
 */
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const INK = '#0d1b2f';
const PAPER = '#fbfaf7';
const MUTED = '#445671';
const MARIGOLD = '#fa8927';
const ACCENT = '#b24710';

type El = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown): El => ({ type, props: { style: { display: 'flex', ...style }, children } });

const fontFile = (pkg: string, file: string) => readFileSync(join(process.cwd(), 'node_modules/@fontsource', pkg, 'files', file));
let fonts: { name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' }[] | undefined;
const loadFonts = () =>
  (fonts ??= [
    { name: 'Anek', data: fontFile('anek-latin', 'anek-latin-latin-800-normal.woff'), weight: 800, style: 'normal' },
    { name: 'Anek', data: fontFile('anek-latin', 'anek-latin-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Atkinson', data: fontFile('atkinson-hyperlegible-next', 'atkinson-hyperlegible-next-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Atkinson', data: fontFile('atkinson-hyperlegible-next', 'atkinson-hyperlegible-next-latin-700-normal.woff'), weight: 700, style: 'normal' },
  ]);

// The chapter's Delhi skyline hexagon (src/assets/brand/ug-badge.png, made by `npm run brand:badge`), embedded once.
const BADGE = { width: 510, height: 586 };
let badgeUri: string | undefined;
const badgeSrc = () => (badgeUri ??= `data:image/png;base64,${readFileSync(join(process.cwd(), 'src/assets/brand/ug-badge.png')).toString('base64')}`);

/** The badge, `height` px tall. */
function logoNode(height: number): El {
  const width = Math.round((height * BADGE.width) / BADGE.height);
  return { type: 'img', props: { src: badgeSrc(), width, height, style: { width, height } } };
}

async function toPng(tree: El, width: number, height: number): Promise<Buffer> {
  const svg = await satori(tree as never, { width, height, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

/** A station ring on the line. */
const station = (diameter: number, ring: number): El =>
  el('div', { width: Math.round(diameter), height: Math.round(diameter), borderRadius: Math.round(diameter), boxSizing: 'border-box', border: `${Math.round(ring)}px solid ${INK}`, backgroundColor: PAPER, flexShrink: 0 });

export interface CardInput {
  title: string;
  /** Small line above the title, e.g. "Meetup, in person". */
  eyebrow?: string;
  /** Lines under the title, e.g. date and place. */
  meta?: string[];
  width: number;
  height: number;
}

/** Longer titles get smaller type so they always fit. */
function titleSize(title: string, scale: number, tall: boolean): number {
  const n = title.length;
  const base = n <= 28 ? 92 : n <= 50 ? 76 : n <= 80 ? 62 : 52;
  return Math.round(base * scale * (tall ? 1.15 : 1));
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export async function renderCard({ title, eyebrow, meta = [], width, height }: CardInput): Promise<Buffer> {
  const scale = width / 1200;
  const pad = Math.round(72 * scale);
  const tall = height / width > 0.8;
  const text = clip(title, 120);
  const lineH = Math.round(46 * scale);
  const contentW = width - 2 * pad; // text needs a definite width to wrap inside

  // border-box: Satori defaults to content-box, which would add the padding on top of `height` and push the footer off the card.
  const tree = el('div', { width, height, boxSizing: 'border-box', backgroundColor: PAPER, flexDirection: 'column', padding: pad, color: INK, fontFamily: 'Atkinson' }, [
    el('div', { alignItems: 'center' }, [
      logoNode(Math.round(76 * scale)),
      el('div', { marginLeft: Math.round(20 * scale), fontFamily: 'Anek', fontWeight: 700, fontSize: Math.round(32 * scale) }, 'AWS UG Delhi NCR'),
    ]),
    el('div', { flexDirection: 'column', justifyContent: 'center', flexGrow: 1, width: contentW }, [
      eyebrow ? el('div', { fontWeight: 700, fontSize: Math.round(30 * scale), color: ACCENT, marginBottom: Math.round(18 * scale) }, eyebrow) : el('div', {}, ''),
      el('div', { fontFamily: 'Anek', fontWeight: 800, fontSize: titleSize(text, scale, tall), lineHeight: 1.05, letterSpacing: -1, width: contentW }, text),
      ...meta.map((line, i) => el('div', { fontSize: Math.round(32 * scale), color: MUTED, marginTop: i === 0 ? Math.round(26 * scale) : Math.round(6 * scale), lineHeight: lineH / (32 * scale) }, line)),
    ]),
    // The metro line: three stations, the middle one the interchange. A plain row, so it lays out the same everywhere.
    el('div', { width: contentW, alignItems: 'center', height: Math.round(64 * scale) }, [
      station(44 * scale, 8 * scale),
      el('div', { flexGrow: 1, height: Math.round(12 * scale), backgroundColor: MARIGOLD }),
      station(60 * scale, 10 * scale),
      el('div', { flexGrow: 1, height: Math.round(12 * scale), backgroundColor: MARIGOLD }),
      station(44 * scale, 8 * scale),
    ]),
  ]);
  return toPng(tree, width, height);
}

/** Square logo for search engines (Google wants at least 112x112) and the home-screen icon. */
export async function renderLogo(size: number): Promise<Buffer> {
  const tree = el('div', { width: size, height: size, backgroundColor: PAPER, alignItems: 'center', justifyContent: 'center' }, logoNode(Math.round(size * 0.86)));
  return toPng(tree, size, size);
}

export const CARD_SIZES = {
  og: { width: 1200, height: 630 }, // Open Graph / link previews
  '16x9': { width: 1200, height: 675 }, // Google Event images
  '4x3': { width: 1200, height: 900 },
  '1x1': { width: 1200, height: 1200 },
} as const;
export type CardSize = keyof typeof CARD_SIZES;
