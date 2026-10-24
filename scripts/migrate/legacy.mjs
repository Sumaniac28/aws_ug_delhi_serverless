// Reads the previous site's data modules (src/data/*.js in Sumaniac28/awsugdelhincr) without running its app.
// Those files are plain JavaScript whose only imports are image files, so each import becomes a path string
// and the module body is evaluated in isolation. Nothing is retyped by hand.
//
// Use the repository's `dev` branch: `main` stops at September 2025, before Community Day 2025.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Evaluates one data module; image imports resolve to absolute file paths. Returns its named exports. */
export function evaluateModule(file) {
  const dir = dirname(file);
  const exported = [];
  const source = readFileSync(file, 'utf8')
    .replace(/^import\s+(\w+)\s+from\s+["'](.+?)["'];?\s*$/gm, (_m, name, spec) => `const ${name} = ${JSON.stringify(resolve(dir, spec))};`)
    .replace(/^export\s+const\s+(\w+)\s*=/gm, (_m, name) => {
      exported.push(name);
      return `const ${name} =`;
    })
    .replace(/^export\s+default\s+\w+;?\s*$/gm, '');
  if (/^\s*import\s/m.test(source)) throw new Error(`${file}: has an import that is not an image, so it cannot be read safely`);
  return new Function(`${source}\nreturn { ${exported.join(', ')} };`)();
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const pad = (n) => String(n).padStart(2, '0');
const hour24 = (h, ap) => (Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0);
const CLOCK = '(\\d{1,2}):(\\d{2})\\s*(AM|PM)';
const WHEN = new RegExp('^' + CLOCK + '(?:\\s*IST)?(?:\\s*-\\s*' + CLOCK + '(?:\\s*IST)?)?$', 'i');
const SESSION = new RegExp('^' + CLOCK + '\\s*-\\s*' + CLOCK, 'i');

/**
 * "Saturday, Oct 14, 2023" + "10:00 AM IST"       ->  { iso: "2023-10-14T10:00:00+05:30", weekdayOk }
 * "Sunday, November 16, 2025" + "9:00 AM - 5:30 PM" ->  the same plus endIso
 * weekdayOk is false when the stated weekday does not match the date, which points at a typo in the old data.
 */
export function parseWhen(date, time) {
  const d = date.match(/^(?:(\w+),\s*)?(\w+)\s+(\d{1,2}),\s*(\d{4})$/);
  const t = time.match(WHEN);
  if (!d || !t) return null;
  const month = MONTHS[d[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const [day, year] = [Number(d[3]), Number(d[4])];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month, day)).getUTCDay()];
  const stamp = (h, m, ap) => `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour24(h, ap))}:${m}:00+05:30`;
  const result = { iso: stamp(t[1], t[2], t[3]), weekdayOk: !d[1] || d[1].toLowerCase() === weekday };
  if (t[4]) result.endIso = stamp(t[4], t[5], t[6]);
  return result;
}

/** "9:45 AM - 9:55 AM (GMT+05:30)" on 2025-11-16  ->  { start, end } with +05:30 offsets. */
export function parseSession(text, day) {
  const m = text.match(SESSION);
  if (!m) return null;
  const at = (h, mi, ap) => `${day}T${pad(hour24(h, ap))}:${mi}:00+05:30`;
  return { start: at(m[1], m[2], m[3]), end: at(m[4], m[5], m[6]) };
}

/** Loads every event data module (and its other exports, such as an agenda), the events index and the core team. */
export function loadLegacy(oldDir) {
  const data = join(oldDir, 'src/data');
  if (!existsSync(data)) throw new Error(`${oldDir} does not look like the old site (no src/data)`);
  const { eventsData } = evaluateModule(join(data, 'eventsData.js'));
  const modules = {};
  const extras = {};
  for (const name of readdirSync(data)) {
    if (name === 'eventsData.js' || !name.endsWith('.js')) continue;
    const exports = evaluateModule(join(data, name));
    const [first] = Object.values(exports);
    if (first) {
      modules[name] = first;
      extras[name] = exports;
    }
  }
  return { eventsData, modules, extras, assetsDir: join(oldDir, 'src/assets'), team: loadTeam(join(oldDir, 'src/pages/Organiser/Organiser.jsx')) };
}

/** The Organiser page keeps its people in a JSX array; the objects inside are plain literals. */
export function loadTeam(file) {
  if (!existsSync(file)) return [];
  const dir = dirname(file);
  const src = readFileSync(file, 'utf8');
  const images = Object.fromEntries([...src.matchAll(/^import\s+(\w+)\s+from\s+"(.+?)";/gm)].map((m) => [m[1], resolve(dir, m[2])]));
  const block = src.match(/const organisers = \[([\s\S]*?)\n  \];/)?.[1];
  if (!block) return [];
  return [...block.matchAll(/\{\s*name:\s*"(.+?)",\s*designation:\s*"(.+?)",\s*linkedIn:\s*"(.+?)",\s*img:\s*(\w+),?\s*\}/g)].map((m) => ({
    name: m[1],
    designation: m[2],
    linkedin: m[3],
    image: images[m[4]],
  }));
}
