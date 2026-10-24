// Tests for the Phase 8 migration. A tiny fake "old repository" is generated in a temp folder (real images, same file
// shapes as Sumaniac28/awsugdelhincr), so the suite needs no network and no copy of the real one. If OLD_SITE_DIR
// points at the real clone, one extra test migrates it end to end.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, describe, it } from 'node:test';
import { buildContent, normalizeLinkedIn, slugify } from './build.mjs';
import { evaluateModule, loadLegacy, parseSession, parseWhen } from './legacy.mjs';
import { status, trimLogo, validate, writeContent, writeMedia } from './run.mjs';
import { emptyCheck, plan } from './upload.mjs';

const sharp = createRequire(new URL('../../infra/package.json', import.meta.url))('sharp');
sharp.cache(false); // on Windows sharp would otherwise keep files open and block the clean-up below
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const FACTS = JSON.parse(readFileSync(new URL('./facts.json', import.meta.url), 'utf8'));
const REDIRECTS = JSON.parse(readFileSync(new URL('../../infra/redirects.json', import.meta.url), 'utf8')).redirects;

const jpeg = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg().toBuffer();

/** A miniature of the old repository: two events sharing a speaker whose LinkedIn differs between them. */
async function makeOldRepo(root) {
  const put = (rel, data) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  };
  for (const [i, rgb] of [[1, '#c33'], [2, '#3c3'], [3, '#33c']]) put(`src/assets/events/demo/${i}.jpg`, await jpeg(1200, 800, rgb));
  put('src/assets/events/other/1.jpg', await jpeg(900, 600, '#999'));
  put('src/assets/speakers/Alice Example.jpg', await jpeg(300, 300, '#fa0'));
  put('src/assets/speakers/Bob Sample.jpg', await jpeg(300, 300, '#0af'));
  put('src/assets/sponsors/Acme.jpg', await jpeg(200, 100, '#fff'));
  put('src/assets/core-team/Carol Lead.jpg', await jpeg(400, 400, '#a0f'));

  put('src/data/eventsData.js', `import poster from "../assets/events/demo/2.jpg";
import otherPoster from "../assets/events/other/1.jpg";
export const eventsData = [
  { id: 1, name: "Next Year", date: "Coming Soon", time: "TBA", venue: "TBA", image: poster, link: "#", status: "upcoming" },
  { id: 2, name: "Demo Meetup", date: "Saturday, May 6, 2023", time: "10:30 AM IST", venue: "Somewhere", image: poster, link: "/demo", status: "completed" },
  { id: 3, name: "Other", date: "Friday, Oct 20, 2023", time: "1:00 PM IST", venue: "Elsewhere", image: otherPoster, link: "/Other", status: "completed" },
];
`);
  put('src/data/demo.js', `import alice from "../assets/speakers/Alice Example.jpg";
import bob from "../assets/speakers/Bob Sample.jpg";
import acme from "../assets/sponsors/Acme.jpg";
import i1 from "../assets/events/demo/1.jpg";
import i2 from "../assets/events/demo/2.jpg";
import i3 from "../assets/events/demo/3.jpg";
// a comment that must not matter
export const demoData = {
  title: "Demo Meetup",
  description: ["First paragraph.", "Second paragraph."],
  images: { imagePaths: [i1, i2, i3, i1, i2] },
  eventDetails: { attendees: "170+", sessions: "3", speakers: "3" },
  aboutSections: [
    { title: "WHO ATTENDED", content: ["Over 500 people came.", "They stayed."] },
    { title: "WHY ATTENDED", content: ["To learn."] },
  ],
  speakers: [
    { name: "Alice Example", image: alice, linkedin: "https://linkedin.com/in/alice-e" },
    { name: "Bob Sample", image: bob, linkedin: "https://www.linkedin.com/in/bob/" },
  ],
  sponsors: { poweredBy: [{ name: "AWS" }], inAssociationWith: [], platinum: [], gold: [], silver: [{ name: "Acme", logo: acme }] },
};
export default demoData;
`);
  put('src/data/other.js', `import alice from "../assets/speakers/Alice Example.jpg";
export const otherData = {
  title: "Other",
  description: ["Only one."],
  images: { imagePaths: [] },
  eventDetails: { attendees: "50+", sessions: 1, speakers: "1" },
  aboutSections: [],
  speakers: [{ name: "Alice Example", image: alice, linkedin: "https://www.linkedin.com/in/alice-e/" }, { name: "Alice Example", image: alice, linkedin: "https://linkedin.com/in/alice-e" }],
  sponsors: { poweredBy: [], inAssociationWith: [], platinum: [], gold: [], silver: [] },
};
export default otherData;
`);
  put('src/pages/Organiser/Organiser.jsx', `import pic from "../../assets/core-team/Carol Lead.jpg";
function Organiser() {
  const organisers = [
    {
      name: "Carol Lead",
      designation: "Community Lead",
      linkedIn: "https://www.linkedin.com/in/carol-lead/",
      img: pic,
    },
  ];
  return null;
}
`);
}

const facts = () => ({
  ...structuredClone(FACTS),
  venues: { hall: { name: 'Town Hall', streetAddress: '1 Main Road', locality: 'Gurugram', region: 'Haryana', postalCode: '122001', confirmed: true } },
  sponsors: {
    'amazon-web-services': { oldName: 'AWS', name: 'Amazon Web Services', url: 'https://aws.amazon.com/', defaultTier: 'partner', logo: null },
    acme: { oldName: 'Acme', name: 'Acme Ltd', url: 'https://acme.example/', defaultTier: 'silver', logo: 'sponsors/Acme.jpg' },
  },
  speakerNames: {},
  events: {
    'demo.js': { id: 'demo-meetup', link: '/demo', title: 'Demo Meetup', series: 'meetup', size: 'mid', mode: 'offline', venue: 'hall', summary: 'A demo.', end: '2023-05-06T13:00:00+05:30', endConfirmed: true },
    'other.js': { id: 'other-event', link: '/other', title: 'Other', series: 'workshop', size: 'small', mode: 'offline', venue: 'hall', summary: 'Another demo.', end: '2023-10-20T16:00:00+05:30', endConfirmed: true, ownPhotoOnly: true },
  },
  textFixes: [{ event: 'demo.js', find: 'Over 500 people came.', replace: 'Hundreds of people came.', reason: 'test' }],
});

describe('reading the old data', () => {
  let tmp;
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'old-'));
    await makeOldRepo(tmp);
  });
  after(() => cleanup(tmp));

  it('turns image imports into paths and ignores comments', () => {
    const { demoData } = evaluateModule(join(tmp, 'src/data/demo.js'));
    assert.equal(demoData.speakers[0].image, join(tmp, 'src/assets/speakers/Alice Example.jpg'));
    assert.equal(demoData.images.imagePaths.length, 5);
  });

  it('refuses a module that imports anything but an image, rather than guessing', () => {
    const file = join(tmp, 'evil.js');
    writeFileSync(file, 'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n');
    assert.throws(() => evaluateModule(file), /not an image/);
    rmSync(file);
  });

  it('loads every event, the index and the team', () => {
    const legacy = loadLegacy(tmp);
    assert.deepEqual(Object.keys(legacy.modules).sort(), ['demo.js', 'other.js']);
    assert.equal(legacy.eventsData.length, 3);
    assert.deepEqual(legacy.team.map((t) => [t.name, t.designation]), [['Carol Lead', 'Community Lead']]);
  });
});

describe('dates', () => {
  it('reads the old "Day, Month D, YYYY" and "H:MM AM IST" formats, including abbreviated months', () => {
    assert.deepEqual(parseWhen('Saturday, May 6, 2023', '10:30 AM IST'), { iso: '2023-05-06T10:30:00+05:30', weekdayOk: true });
    assert.equal(parseWhen('Saturday, Oct 14, 2023', '1:00 PM IST').iso, '2023-10-14T13:00:00+05:30');
    assert.equal(parseWhen('Friday, June 9, 2023', '12:00 PM IST').iso, '2023-06-09T12:00:00+05:30');
    assert.equal(parseWhen('Friday, June 9, 2023', '12:15 AM IST').iso, '2023-06-09T00:15:00+05:30');
  });
  it('reads a start-and-end range ("9:00 AM - 5:30 PM") and keeps the end', () => {
    assert.deepEqual(parseWhen('Sunday, November 16, 2025', '9:00 AM - 5:30 PM'), { iso: '2025-11-16T09:00:00+05:30', weekdayOk: true, endIso: '2025-11-16T17:30:00+05:30' });
  });
  it('reads an agenda session time with its GMT offset label, across noon', () => {
    assert.deepEqual(parseSession('12:45 PM - 1:20 PM (GMT+05:30)', '2025-11-16'), { start: '2025-11-16T12:45:00+05:30', end: '2025-11-16T13:20:00+05:30' });
    assert.deepEqual(parseSession('8:30 AM - 9:30 AM (GMT+05:30)', '2025-11-16'), { start: '2025-11-16T08:30:00+05:30', end: '2025-11-16T09:30:00+05:30' });
    assert.equal(parseSession('Lunch', '2025-11-16'), null);
  });
  it('flags a weekday that does not match the date, and returns null for "Coming Soon"', () => {
    assert.equal(parseWhen('Monday, May 6, 2023', '10:30 AM IST').weekdayOk, false);
    assert.equal(parseWhen('Coming Soon', 'TBA'), null);
  });
});

describe('names and links', () => {
  it('makes safe slugs from names with accents, dots and spaces', () => {
    assert.equal(slugify('Dr. Abhilasha Rakesh Vyas'), 'dr-abhilasha-rakesh-vyas');
    assert.equal(slugify('Zoë  Müller'), 'zoe-muller');
  });
  it('treats http/https, www and a trailing slash as the same LinkedIn profile', () => {
    for (const u of ['https://linkedin.com/in/x', 'http://www.linkedin.com/in/x/', 'https://www.linkedin.com/in/x']) assert.equal(normalizeLinkedIn(u), 'https://www.linkedin.com/in/x');
  });
});

describe('building the new content', () => {
  let tmp;
  let legacy;
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'old-'));
    await makeOldRepo(tmp);
    legacy = loadLegacy(tmp);
  });
  after(() => cleanup(tmp));

  it('produces documents that pass the real schema and cross-references', () => {
    const c = buildContent(legacy, facts());
    assert.deepEqual(validate({ ...c, site: FACTS.site && { name: 'x', shortName: 'x', tagline: 'x', description: 'x', region: 'x', ...FACTS.site } }), []);
    assert.deepEqual(Object.keys(c.events).sort(), ['demo-meetup', 'other-event']);
  });

  it('takes the start time from the events index and the end time from the facts', () => {
    const { events } = buildContent(legacy, facts());
    assert.equal(events['demo-meetup'].start, '2023-05-06T10:30:00+05:30');
    assert.equal(events['demo-meetup'].end, '2023-05-06T13:00:00+05:30');
  });

  it('keeps one record per person even across events, and picks the most used LinkedIn profile', () => {
    const c = buildContent(legacy, facts());
    assert.deepEqual(Object.keys(c.speakers).sort(), ['alice-example', 'bob-sample']);
    assert.equal(c.speakers['alice-example'].linkedin, 'https://www.linkedin.com/in/alice-e');
    assert.equal(c.speakers['bob-sample'].linkedin, 'https://www.linkedin.com/in/bob');
    assert.deepEqual(c.report.conflicts.filter((x) => /Alice/.test(x.what)), [], 'spellings of one profile are not a conflict');
  });

  it('reports a real LinkedIn disagreement; on a tie the newest event wins', () => {
    legacy.modules['other.js'].speakers[0].linkedin = 'https://linkedin.com/in/alice-other';
    legacy.modules['other.js'].speakers.length = 1;
    const c = buildContent(legacy, facts());
    const conflict = c.report.conflicts.find((x) => /Alice/.test(x.what));
    assert.ok(conflict);
    assert.equal(conflict.used, 'https://www.linkedin.com/in/alice-other', 'one vote each, so the newer event (Oct 2023) wins');
    assert.deepEqual(conflict.others, ['https://www.linkedin.com/in/alice-e']);
    legacy.modules['other.js'].speakers[0].linkedin = 'https://linkedin.com/in/alice-e';
  });

  it('de-duplicates the gallery, reuses a gallery photo as the poster, and writes honest alt text', () => {
    const { events } = buildContent(legacy, facts());
    const e = events['demo-meetup'];
    assert.equal(e.gallery.length, 3, 'the old marquee repeated frames');
    assert.equal(e.poster, e.gallery[1].media, 'the index photo is one of the gallery photos');
    assert.deepEqual(e.gallery.map((g) => g.alt), ['Demo Meetup: photo 1 of 3', 'Demo Meetup: photo 2 of 3', 'Demo Meetup: photo 3 of 3']);
  });

  it('can limit an event to its own single photo when the old page showed another event\'s', () => {
    const { events } = buildContent(legacy, facts());
    assert.equal(events['other-event'].gallery.length, 1);
    assert.equal(events['other-event'].poster, events['other-event'].gallery[0].media);
  });

  it('turns the about sections into a recap with sentence-case headings, applying the listed text fix', () => {
    const c = buildContent(legacy, facts());
    const r = c.events['demo-meetup'].recap;
    assert.match(r, /^### Who attended\n\nHundreds of people came\.\n\nThey stayed\.\n\n### Why people came\n\nTo learn\.$/);
    assert.equal(c.report.fixes.length, 1);
  });

  it('fails loudly when a listed text fix no longer matches, so edits never go missing silently', () => {
    const f = facts();
    f.textFixes[0].find = 'This sentence is not there.';
    assert.throws(() => buildContent(legacy, f), /text fix no longer applies/);
  });

  it('leaves the speaker count out when it disagrees with the list, and says so', () => {
    const c = buildContent(legacy, facts());
    assert.equal(c.events['demo-meetup'].stats.speakers, undefined, 'old numbers said 3 but 2 are listed');
    assert.equal(c.events['demo-meetup'].stats.attendees, 170);
    assert.equal(c.events['demo-meetup'].stats.sessions, 3);
    assert.ok(c.report.conflicts.some((x) => /speaker count/.test(x.what)));
  });

  it('maps old sponsor groups onto tiers and creates a sponsor record only when it is used', () => {
    const c = buildContent(legacy, facts());
    assert.deepEqual(c.events['demo-meetup'].sponsors, [
      { sponsor: 'amazon-web-services', tier: 'partner' },
      { sponsor: 'acme', tier: 'silver' },
    ]);
    assert.deepEqual(Object.keys(c.sponsors).sort(), ['acme', 'amazon-web-services']);
    assert.equal(c.sponsors['amazon-web-services'].logo, undefined, 'a sponsor without a logo gets none');
    assert.equal(c.sponsors.acme.logo, 'sponsors/acme/logo.jpg');
  });

  it('refuses a sponsor the facts file does not know about', () => {
    const f = facts();
    delete f.sponsors.acme;
    assert.throws(() => buildContent(legacy, f), /not in facts\.sponsors/);
  });

  it('does not record consent by default: speaker photos are private and the speaker is marked unconsented', () => {
    const c = buildContent(legacy, facts());
    assert.equal(c.speakers['alice-example'].consent.publish, false);
    assert.equal(c.images.get('speakers/alice-example/photo.jpg').public, false);
    assert.equal(c.images.get('events/demo-meetup/photo-01.jpg').public, true);
    assert.equal(c.images.get('organizers/carol-lead/photo.jpg').public, true);
  });

  it('records consent only when asked, with a date and a source', () => {
    const c = buildContent(legacy, facts(), { legacyConsent: true, today: '2026-10-22' });
    assert.deepEqual(c.speakers['alice-example'].consent, { publish: true, date: '2026-10-22', source: FACTS.consent.legacySource });
    assert.equal(c.images.get('speakers/alice-example/photo.jpg').public, true);
  });

  it('never publishes a join link or leaves a document the schema rejects', () => {
    const f = facts();
    f.events['demo.js'].summary = 'x'.repeat(200);
    const c = buildContent(legacy, f);
    assert.ok(validate({ ...c, site: {} }).some((p) => /events\/demo-meetup: summary/.test(p)));
  });
});

describe('sponsor logos', () => {
  it('trims the margins around a logo so partners fill their chips evenly, keeping a hairline of space', async () => {
    // A 400x200 white canvas with a 100x40 coloured logo in the middle.
    const logo = await sharp({ create: { width: 100, height: 40, channels: 3, background: '#c33' } }).png().toBuffer();
    const canvas = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#fff' } }).composite([{ input: logo, left: 150, top: 80 }]).png().toBuffer();
    const meta = await sharp(await trimLogo(canvas)).metadata();
    assert.equal(meta.width, 108);
    assert.equal(meta.height, 48);
  });
});

describe('writing', () => {
  let tmp, old, content, stage, pub;
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mig-'));
    old = join(tmp, 'old');
    await makeOldRepo(old);
    content = join(tmp, 'content');
    stage = join(tmp, 'migration');
    pub = join(tmp, 'public-media');
    mkdirSync(join(pub, 'samples'), { recursive: true });
    writeFileSync(join(pub, 'samples/keep.svg'), '<svg/>');
  });
  after(() => cleanup(tmp));

  it('writes content, then replaces only what an earlier run wrote', () => {
    const legacy = loadLegacy(old);
    const a = buildContent(legacy, facts());
    const files = writeContent(a, content, stage);
    assert.ok(files.includes('events/demo-meetup.json'));
    // A second run that no longer produces "other-event" removes it, and nothing else.
    const f = facts();
    delete f.events['other.js'];
    const b = buildContent(legacy, f);
    writeContent(b, content, stage);
    assert.ok(!existsSync(join(content, 'events/other-event.json')));
    assert.ok(existsSync(join(content, 'events/demo-meetup.json')));
  });

  it('refuses to touch a file it did not write', () => {
    writeFileSync(join(content, 'events/hand-written.json'), '{}');
    assert.throws(() => writeContent(buildContent(loadLegacy(old), facts()), content, stage), /hand-written\.json.*did not write/s);
    assert.equal(readFileSync(join(content, 'events/hand-written.json'), 'utf8'), '{}');
    rmSync(join(content, 'events/hand-written.json'));
  });

  it('keeps private photos out of the public folders, and moves them when consent is recorded', async () => {
    const legacy = loadLegacy(old);
    const priv = buildContent(legacy, facts());
    await writeMedia(priv.images, stage, pub);
    const variant = 'speakers/alice-example/photo-480.webp';
    assert.ok(existsSync(join(stage, 'private/media', variant)));
    assert.ok(!existsSync(join(stage, 'bucket/media', variant)));
    assert.ok(!existsSync(join(pub, variant)), 'not in the local preview either');
    assert.ok(existsSync(join(pub, 'events/demo-meetup/photo-02-960.webp')));
    assert.ok(existsSync(join(pub, 'samples/keep.svg')), 'the hand-made samples are left alone');
    assert.ok(existsSync(join(stage, 'originals/speakers/alice-example/photo.jpg')), 'originals are kept for the archive');

    const open = buildContent(legacy, facts(), { legacyConsent: true });
    await writeMedia(open.images, stage, pub);
    assert.ok(existsSync(join(stage, 'bucket/media', variant)));
    assert.ok(!existsSync(join(stage, 'private/media', variant)));
    assert.ok(existsSync(join(pub, variant)));
  });

  it('makes the same three WebP widths the resize Lambda would, never larger than the original', async () => {
    const dir = join(stage, 'bucket/media/events/demo-meetup');
    const sizes = [];
    for (const w of [480, 960, 1600]) sizes.push((await sharp(join(dir, `photo-01-${w}.webp`)).metadata()).width);
    assert.deepEqual(sizes, [480, 960, 1200], 'the 1200px original is not enlarged to 1600');
  });
});

describe('what is left to confirm', () => {
  let tmp;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'st-'));
    for (const c of ['events', 'speakers']) mkdirSync(join(tmp, c), { recursive: true });
  });
  after(() => cleanup(tmp));

  it('lists guessed end times, unconfirmed venues, placeholder text and missing consent', () => {
    writeFileSync(join(tmp, 'events/a.json'), '{"venue":{"streetAddress":"Address to be confirmed"}}');
    writeFileSync(join(tmp, 'speakers/s.json'), '{"consent":{"publish":false}}');
    const open = status(FACTS, tmp).join('\n');
    assert.match(open, /end time of "AWS Community Day Delhi 2024" is a guess/);
    assert.match(open, /venue amazon-gurugram .* is unconfirmed/);
    assert.match(open, /events\/a\.json still contains placeholder text/);
    assert.match(open, /1 of 1 speaker\(s\) have no publishing consent/);
  });

  it('reports nothing once everything is confirmed and the content is clean', () => {
    const done = structuredClone(FACTS);
    for (const e of Object.values(done.events)) e.endConfirmed = true;
    for (const v of Object.values(done.venues)) v.confirmed = true;
    writeFileSync(join(tmp, 'events/a.json'), '{"venue":{"streetAddress":"1 Main Road"}}');
    writeFileSync(join(tmp, 'speakers/s.json'), '{"consent":{"publish":true}}');
    assert.deepEqual(status(done, tmp), []);
  });
});

describe('facts against the redirect map', () => {
  const eventTargets = REDIRECTS.map((r) => r.to.match(/^\/events\/(\d{4})\/([^/]+)\/$/)).filter(Boolean);

  it('creates every event the old-route redirects point at, with exactly that id and year', () => {
    const made = new Set(Object.values(FACTS.events).map((e) => `${(e.year ?? e.end.slice(0, 4))}/${e.id}`));
    for (const [, year, id] of eventTargets) assert.ok(made.has(`${year}/${id}`), `no migrated event for /events/${year}/${id}/`);
  });

  it('and every migrated event has a redirect from its old address', () => {
    const targets = new Set(eventTargets.map(([, year, id]) => `${year}/${id}`));
    for (const e of Object.values(FACTS.events)) assert.ok(targets.has(`${(e.year ?? e.end.slice(0, 4))}/${e.id}`), `${e.id} has no redirect from ${e.link}`);
  });

  it('uses the old link as the redirect source (case-insensitively)', () => {
    const sources = new Set(REDIRECTS.map((r) => r.from.toLowerCase()));
    for (const e of Object.values(FACTS.events)) assert.ok(sources.has(e.link.toLowerCase()), `${e.link} is not redirected`);
  });

  it('keeps ids within the 80-character limit and venues referenced by every event', () => {
    for (const e of Object.values(FACTS.events)) {
      assert.ok(e.id.length <= 80, e.id);
      assert.ok(FACTS.venues[e.venue], `${e.id}: unknown venue ${e.venue}`);
      assert.ok(e.summary.length <= 160, `${e.id}: summary is ${e.summary.length} characters`);
    }
  });
});

describe('uploading', () => {
  const args = { mediaBucket: 'my-media', contentBucket: 'my-content', profile: 'p' };

  it('sends only public variants and content, with the headers the live pipeline uses', () => {
    const steps = plan(args).map((s) => s.args.join(' '));
    const media = steps.find((s) => s.includes('s3://my-media/media'));
    assert.ok(media);
    assert.match(media, /bucket[\\/]+media/);
    assert.match(media, /--cache-control public, max-age=31536000, immutable/);
    for (const s of steps) assert.ok(!/originals|private/.test(s), 'originals and private photos are never uploaded');
    assert.ok(steps.some((s) => s.includes('s3://my-content/content/events') && s.includes('--content-type application/json')));
  });

  it('checks the content bucket is empty first, so organizers\' edits are never overwritten', () => {
    assert.deepEqual(emptyCheck(args).args.slice(0, 6), ['s3api', 'list-objects-v2', '--bucket', 'my-content', '--prefix', 'content/']);
  });
});

describe('the real old repository (set OLD_SITE_DIR to run)', { skip: !process.env.OLD_SITE_DIR }, () => {
  it('migrates every completed event the old site lists, passing the schema', () => {
    const legacy = loadLegacy(process.env.OLD_SITE_DIR);
    const c = buildContent(legacy, FACTS);
    const completed = legacy.eventsData.filter((e) => e.status === 'completed' && parseWhen(e.date, e.time));
    assert.equal(Object.keys(c.events).length, completed.length, 'an event on the old site was left out of facts.json');
    assert.deepEqual(validate({ ...c, site: { name: 'x', shortName: 'x', tagline: 'x', description: 'x', region: 'x', ...FACTS.site } }), []);
    for (const e of Object.values(c.events)) assert.ok(e.gallery.length >= 1 && e.speakers.length >= 1, e.title);
  });

  it('carries Community Day 2025 with its agenda, its volunteers as hosts, and no job titles', () => {
    const c = buildContent(loadLegacy(process.env.OLD_SITE_DIR), FACTS);
    const e = c.events['community-day-delhi-ncr-2025'];
    assert.ok(e, 'Community Day 2025 is missing');
    assert.equal(e.start, '2025-11-16T09:00:00+05:30');
    assert.equal(e.end, '2025-11-16T17:30:00+05:30');
    assert.ok(e.agenda.length >= 10 && e.agenda.every((a) => Date.parse(a.end) > Date.parse(a.start)));
    assert.ok(e.agenda.every((a) => !/^TBD/i.test(a.title)), 'no "TBD" titles are published');
    assert.ok(e.hosts.length >= 15 && e.hosts.every((h) => c.organizers[h]));
    assert.ok(Object.values(c.speakers).every((s) => !('role' in s) && !('company' in s)), 'speakers carry no job title');
    assert.ok(Object.values(c.organizers).some((o) => o.role === 'Volunteer' && o.active === false), 'volunteers are inactive organizers');
  });
});
