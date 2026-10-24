// Checks every foreground/background pair declared below against WCAG 2.2 AA, per theme.
// Reads the hex values straight from src/styles/tokens.css so the numbers cannot drift from the CSS.
// Usage: node scripts/check-contrast.mjs   (exit code 1 on any failure)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function scope(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
  return vars;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum ratio, what it is]
const TEXT = 4.5;
const UI = 3;
const pairs = [
  ['foreground', 'background', TEXT, 'body text'],
  ['foreground', 'card', TEXT, 'text on card'],
  ['foreground', 'muted', TEXT, 'text on muted surface'],
  ['muted-foreground', 'background', TEXT, 'secondary text'],
  ['muted-foreground', 'muted', TEXT, 'secondary text on muted'],
  ['muted-foreground', 'card', TEXT, 'secondary text on card'],
  ['primary-foreground', 'primary', TEXT, 'text on orange button'],
  ['primary-accent', 'background', TEXT, 'orange text/links'],
  ['primary-accent', 'card', TEXT, 'orange text on card'],
  ['primary-accent', 'muted', TEXT, 'orange text on muted'],
  ['secondary-foreground', 'secondary', TEXT, 'text on secondary'],
  ['info-foreground', 'info', TEXT, 'info badge'],
  ['success-foreground', 'success', TEXT, 'success badge'],
  ['warning-foreground', 'warning', TEXT, 'warning badge'],
  ['error-foreground', 'error', TEXT, 'error badge'],
  ['ink-foreground', 'ink', TEXT, 'footer text'],
  ['ink-muted', 'ink', TEXT, 'footer secondary text'],
  ['input', 'background', UI, 'input/outline-button border'],
  ['outline', 'background', UI, 'focus ring'],
  ['outline', 'card', UI, 'focus ring on card'],
  ['track-1', 'background', UI, 'track line 1'],
  ['track-2', 'background', UI, 'track line 2'],
  ['track-3', 'background', UI, 'track line 3'],
  ['track-4', 'background', UI, 'track line 4'],
  ['track-1', 'card', UI, 'track line 1 on card'],
  ['line', 'ink', UI, 'orange line on footer'],
  ['ink-foreground', 'ink-border', TEXT, 'icon button hover on ink bands'],
  ['primary', 'ink', UI, 'orange button on ink bands'],
  ['primary', 'ink', TEXT, 'orange text on ink bands'],
  ['foreground', 'surface-raised', TEXT, 'text in dialogs and menus'],
  ['muted-foreground', 'surface-raised', TEXT, 'secondary text in dialogs and menus'],
  ['primary-accent', 'surface-raised', TEXT, 'orange text in dialogs and menus'],
  ['foreground', 'sidebar', TEXT, 'text in the admin menu'],
  ['muted-foreground', 'sidebar', TEXT, 'secondary text in the admin menu'],
  ['primary-accent', 'sidebar', TEXT, 'orange text in the admin menu'],
  ['primary-foreground', 'logo-chip', TEXT, 'text on a logo chip'],
];

let failures = 0;
for (const [name, selector] of [['light', ':root'], ['dark', '.dark']]) {
  const v = scope(selector);
  console.log(`\n${name} theme`);
  for (const [fg, bg, min, what] of pairs) {
    // Tokens a theme does not override inherit from :root.
    const f = v[fg] ?? scope(':root')[fg];
    const b = v[bg] ?? scope(':root')[bg];
    const r = ratio(f, b);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1 (min ${min})  ${fg} on ${bg}  ${f}/${b}  ${what}`);
  }
}
console.log(failures ? `\n${failures} pair(s) below WCAG AA.` : '\nAll pairs meet WCAG 2.2 AA.');
process.exit(failures ? 1 : 0);
