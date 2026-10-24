// Phase 8: migrates the previous site (Sumaniac28/awsugdelhincr) into this one.
//
//   git clone https://github.com/Sumaniac28/awsugdelhincr.git ../old-site
//   npm run migrate -- --old ../old-site                    speaker photos stay private (no consent recorded)
//   npm run migrate -- --old ../old-site --legacy-consent   organizers confirm the old site's publication
//   npm run migrate:status                                  what still needs an organizer's confirmation
//
// Writes content JSON to src/content, the media to migration/ (originals, public and private variants) and a copy of
// the public variants to public/media for local preview. Nothing is uploaded; see scripts/migrate/upload.mjs.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makeVariants, WIDTHS } from '../../infra/lambda/resize/variants.mjs';
import { eventSchema, organizerSchema, siteSchema, speakerSchema, sponsorSchema } from '../../src/schema/index.ts';
import { buildContent } from './build.mjs';
import { loadLegacy } from './legacy.mjs';

const sharp = createRequire(new URL('../../infra/package.json', import.meta.url))('sharp');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FACTS = fileURLToPath(new URL('./facts.json', import.meta.url));
const COLLECTIONS = { events: eventSchema, speakers: speakerSchema, sponsors: sponsorSchema, organizers: organizerSchema };
const PLACEHOLDER = /\bTBC\b|to be confirmed/i;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const stem = (key) => key.replace(/\.[^.]+$/, '');

/** Zod validation plus the cross-references the site build also enforces. Returns a list of problems. */
export function validate({ events, speakers, sponsors, organizers, site }) {
  const problems = [];
  const check = (collection, id, doc) => {
    const r = COLLECTIONS[collection].safeParse(doc);
    if (!r.success) for (const i of r.error.issues) problems.push(`${collection}/${id}: ${i.path.join('.') || '(document)'}: ${i.message}`);
  };
  for (const [id, d] of Object.entries(events)) check('events', id, d);
  for (const [id, d] of Object.entries(speakers)) check('speakers', id, d);
  for (const [id, d] of Object.entries(sponsors)) check('sponsors', id, d);
  for (const [id, d] of Object.entries(organizers)) check('organizers', id, d);
  const s = siteSchema.safeParse(site);
  if (!s.success) for (const i of s.error.issues) problems.push(`site: ${i.path.join('.')}: ${i.message}`);
  for (const [id, e] of Object.entries(events)) {
    for (const sp of e.speakers) if (!speakers[sp]) problems.push(`events/${id}: speaker "${sp}" does not exist`);
    for (const a of e.agenda ?? []) for (const sp of a.speakers ?? []) if (!speakers[sp]) problems.push(`events/${id}: agenda speaker "${sp}" does not exist`);
    for (const h of e.hosts ?? []) if (!organizers[h]) problems.push(`events/${id}: host "${h}" does not exist`);
    for (const { sponsor } of e.sponsors) if (!sponsors[sponsor]) problems.push(`events/${id}: sponsor "${sponsor}" does not exist`);
  }
  return problems;
}

/** Logos come with generous margins; trimming them lets every partner fill its chip evenly (and the AWS logo sit at the same size as the rest). */
export async function trimLogo(buffer) {
  const trimmed = await sharp(buffer).trim({ threshold: 14 }).toBuffer();
  return sharp(trimmed).extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
}

async function writeVariants(key, src, dir) {
  const logo = key.startsWith('sponsors/');
  const targets = WIDTHS.map((w) => join(dir, `${stem(key)}-${w}.webp`));
  const fresh = !logo && targets.every((t) => existsSync(t) && statSync(t).mtimeMs >= statSync(src).mtimeMs);
  if (fresh) return;
  const input = logo ? await trimLogo(readFileSync(src)) : readFileSync(src);
  for (const { width, body } of await makeVariants(input)) {
    const file = join(dir, `${stem(key)}-${width}.webp`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

export async function writeMedia(images, stage, publicDir) {
  const bucket = join(stage, 'bucket/media');
  const priv = join(stage, 'private/media');
  const originals = join(stage, 'originals');
  for (const [key, { src, public: isPublic }] of images) {
    if (!existsSync(src)) throw new Error(`Image missing in the old repository: ${src}`);
    mkdirSync(dirname(join(originals, key)), { recursive: true });
    cpSync(src, join(originals, key));
    await writeVariants(key, src, isPublic ? bucket : priv);
    // A file that changed visibility must not stay in the other place.
    for (const w of WIDTHS) rmSync(join(isPublic ? priv : bucket, `${stem(key)}-${w}.webp`), { force: true });
  }
  // Local preview: only what is public, and only generated folders (the samples stay).
  for (const dir of ['events', 'speakers', 'sponsors', 'organizers']) {
    rmSync(join(publicDir, dir), { recursive: true, force: true });
    if (existsSync(join(bucket, dir))) cpSync(join(bucket, dir), join(publicDir, dir), { recursive: true });
  }
}

/** Writes content JSON, replacing only files an earlier run wrote. Refuses to touch anything else. */
export function writeContent(content, contentDir, stage) {
  const manifestFile = join(stage, 'manifest.json');
  const previous = existsSync(manifestFile) ? readJson(manifestFile).files : [];
  const written = [];
  for (const collection of Object.keys(COLLECTIONS)) {
    const dir = join(contentDir, collection);
    mkdirSync(dir, { recursive: true });
    const foreign = readdirSync(dir).filter((n) => n.endsWith('.json') && !previous.includes(`${collection}/${n}`));
    if (foreign.length) {
      throw new Error(
        `src/content/${collection} already holds ${foreign.join(', ')}, which this migration did not write.\n` +
          'Move them out of the way first (the sample content lives in fixtures/sample-content), so nothing of yours is overwritten.',
      );
    }
  }
  for (const f of previous) rmSync(join(contentDir, f), { force: true });
  for (const collection of Object.keys(COLLECTIONS)) {
    for (const [id, doc] of Object.entries(content[collection])) {
      writeFileSync(join(contentDir, collection, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
      written.push(`${collection}/${id}.json`);
    }
  }
  mkdirSync(stage, { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify({ files: written }, null, 2)}\n`);
  return written;
}

export function reportMarkdown({ facts, content, legacyConsent, oldCommit }) {
  const L = [];
  const events = Object.entries(facts.events);
  L.push('# Migration report', '', `Source: Sumaniac28/awsugdelhincr${oldCommit ? ` at ${oldCommit}` : ''}.`, '');
  L.push(`Migrated ${Object.keys(content.events).length} events, ${Object.keys(content.speakers).length} speakers, ${Object.keys(content.sponsors).length} sponsors and ${Object.keys(content.organizers).length} team members; ${content.images.size} images.`, '');
  L.push('## Needs an organizer before launch', '');
  L.push('### Event end times (the old site recorded only start times)', '');
  for (const [, e] of events) if (!e.endConfirmed) L.push(`- ${e.title}: end set to ${e.end} (a guess)`);
  L.push('', '### Venues', '');
  for (const [id, v] of Object.entries(facts.venues)) if (!v.confirmed) L.push(`- **${v.name}** (${id}): ${v.note ?? 'unconfirmed'} Currently: ${v.streetAddress}, ${v.locality}, ${v.postalCode}.`);
  L.push('', '### Speaker consent', '');
  L.push(
    legacyConsent
      ? '- Recorded as published, source "already on the previous site; organizers confirmed". If that is not true for a speaker, set their consent to false in the admin.'
      : '- No speaker consent is recorded, so speaker photos and pages are **not published**. Re-run with --legacy-consent once organizers agree, or record consent per person in the admin.',
  );
  L.push('', '## Conflicts in the old data (a choice was made; please check)', '');
  for (const c of content.report.conflicts) L.push(`- **${c.what}**: used ${c.used}; other values: ${c.others.join(', ')}. ${c.action}`);
  L.push('', '## Text edited', '');
  for (const f of content.report.fixes) L.push(`- ${f.event}: "${f.before}" became "${f.after}". ${f.reason}`);
  L.push('', '## Notes', '');
  for (const n of content.report.notes) L.push(`- ${n}`);
  return `${L.join('\n')}\n`;
}

/** Everything that still blocks launch: a non-empty list means "not done". Reads facts and the written content. */
export function status(facts, contentDir) {
  const open = [];
  for (const e of Object.values(facts.events)) if (!e.endConfirmed) open.push(`end time of "${e.title}" is a guess (${e.end})`);
  for (const [id, v] of Object.entries(facts.venues)) if (!v.confirmed) open.push(`venue ${id} (${v.name}) is unconfirmed`);
  const scan = (collection) => {
    const dir = join(contentDir, collection);
    return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => [n, readFileSync(join(dir, n), 'utf8')]) : [];
  };
  for (const [n, text] of scan('events')) if (PLACEHOLDER.test(text)) open.push(`events/${n} still contains placeholder text (TBC / to be confirmed)`);
  const speakers = scan('speakers').map(([, t]) => JSON.parse(t));
  const unconsented = speakers.filter((s) => !s.consent?.publish).length;
  if (unconsented) open.push(`${unconsented} of ${speakers.length} speaker(s) have no publishing consent, so their photos and pages stay hidden`);
  return open;
}

function parseArgs(argv) {
  const a = { old: process.env.OLD_SITE_DIR, legacyConsent: false, status: false, media: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--old') a.old = argv[++i];
    else if (argv[i] === '--legacy-consent') a.legacyConsent = true;
    else if (argv[i] === '--status') a.status = true;
    else if (argv[i] === '--no-media') a.media = false;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const facts = readJson(FACTS);
  const contentDir = join(ROOT, 'src/content');
  if (args.status) {
    const open = status(facts, contentDir);
    if (!open.length) return console.log('Migration status: nothing left to confirm.');
    console.log(`Migration status: ${open.length} item(s) still need an organizer:\n${open.map((o) => `  - ${o}`).join('\n')}`);
    console.log('\nDetails and what to check: migration/REPORT.md');
    process.exitCode = 1;
    return;
  }
  if (!args.old) throw new Error('Say where the old site is: --old <path> (git clone https://github.com/Sumaniac28/awsugdelhincr.git first)');
  const oldDir = resolve(args.old);
  const legacy = loadLegacy(oldDir);
  const content = buildContent(legacy, facts, { legacyConsent: args.legacyConsent });
  const site = { ...readJson(join(ROOT, 'src/data/site.json')), ...content.site };
  const problems = validate({ ...content, site });
  if (problems.length) {
    console.error(`The migrated content does not pass the schema (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  const stage = join(ROOT, 'migration');
  const written = writeContent(content, contentDir, stage);
  writeFileSync(join(ROOT, 'src/data/site.json'), `${JSON.stringify(site, null, 2)}\n`);
  if (args.media) await writeMedia(content.images, stage, join(ROOT, 'public/media'));
  let oldCommit;
  const head = join(oldDir, '.git/HEAD');
  if (existsSync(head)) {
    const ref = readFileSync(head, 'utf8').trim();
    const refFile = ref.startsWith('ref: ') ? join(oldDir, '.git', ref.slice(5)) : null;
    oldCommit = (refFile && existsSync(refFile) ? readFileSync(refFile, 'utf8') : ref).trim().slice(0, 12);
  }
  writeFileSync(join(stage, 'REPORT.md'), reportMarkdown({ facts, content, legacyConsent: args.legacyConsent, oldCommit }));
  console.log(`Wrote ${written.length} content files, ${content.images.size} images${args.media ? '' : ' (media skipped)'}, and migration/REPORT.md.`);
  const open = status(facts, contentDir);
  console.log(`${open.length} item(s) still need an organizer before launch (npm run migrate:status).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
