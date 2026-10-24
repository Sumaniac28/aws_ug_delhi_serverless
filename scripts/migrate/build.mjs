// Maps the previous site's records onto the new content model. Pure: it reads nothing but its arguments and
// returns documents, the images they need, and a report of every judgement call so an organizer can review them.
import { extname, join } from 'node:path';
import { parseSession, parseWhen } from './legacy.mjs';

export const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const ext = (file) => {
  const e = extname(file).slice(1).toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
};

/** Canonical form so two spellings of one profile compare equal: https, www host, no trailing slash. */
export const normalizeLinkedIn = (url) => url.replace(/^https?:\/\/(www\.)?linkedin\.com/i, 'https://www.linkedin.com').replace(/\/+$/, '');
const profileKey = (url) => normalizeLinkedIn(url).toLowerCase();

const ordinal = (n) => String(n).padStart(2, '0');

export function buildContent(legacy, facts, { legacyConsent = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const report = { conflicts: [], fixes: [], notes: [], skipped: [] };
  const images = new Map(); // media key -> { src, public }
  const addImage = (key, src, isPublic = true) => {
    const existing = images.get(key);
    if (existing && existing.src !== src) throw new Error(`Two different images want the key ${key}`);
    images.set(key, { src, public: isPublic });
    return key;
  };

  const byLink = new Map(legacy.eventsData.map((e) => [e.link.toLowerCase(), e]));
  /** When the event behind a data module started, so the newest spelling of a link can win a tie. */
  const startOf = (file) => {
    const f = facts.events[file];
    const index = f && byLink.get(f.link.toLowerCase());
    return (index && parseWhen(index.date, index.time)?.iso) || '';
  };

  // ---- speakers: one record per person, however many events they appear in
  const linkedinVotes = new Map(); // slug -> Map(profileKey -> {url, count, latest})
  const speakerSeen = new Map(); // slug -> { name, image }
  const teamByName = new Map(legacy.team.map((t) => [t.name.toLowerCase(), t]));
  const speakerSlug = (name) => slugify(facts.speakerNames?.[name] ?? name);
  const speakerName = (name) => facts.speakerNames?.[name] ?? name;

  for (const [file, ev] of Object.entries(legacy.modules)) {
    for (const sp of ev.speakers ?? []) {
      const slug = speakerSlug(sp.name);
      if (!speakerSeen.has(slug)) speakerSeen.set(slug, { name: speakerName(sp.name), image: sp.image });
      if (!sp.linkedin) continue;
      const votes = linkedinVotes.get(slug) ?? new Map();
      const key = profileKey(sp.linkedin);
      const prior = votes.get(key);
      const when = startOf(file);
      votes.set(key, { url: normalizeLinkedIn(sp.linkedin), count: (prior?.count ?? 0) + 1, latest: prior && prior.latest > when ? prior.latest : when });
      linkedinVotes.set(slug, votes);
    }
  }

  const consent = legacyConsent
    ? { publish: true, date: today, source: facts.consent.legacySource }
    : { publish: false, source: 'Migrated from the previous site; consent not yet recorded' };

  const speakers = {};
  for (const [slug, s] of speakerSeen) {
    const votes = [...(linkedinVotes.get(slug)?.values() ?? [])];
    // The profile used most often wins; the core team's own page breaks ties, then the newest event.
    const teamUrl = teamByName.get(s.name.toLowerCase())?.linkedin;
    const isTeam = (v) => Number(profileKey(v.url) === (teamUrl && profileKey(teamUrl)));
    votes.sort((a, b) => b.count - a.count || isTeam(b) - isTeam(a) || b.latest.localeCompare(a.latest));
    if (votes.length > 1) report.conflicts.push({ what: `LinkedIn for ${s.name}`, used: votes[0].url, others: votes.slice(1).map((v) => v.url), action: 'Open each link and keep the right one.' });
    const doc = { name: s.name, ...(votes[0] ? { linkedin: votes[0].url } : {}), consent };
    if (s.image) doc.photo = addImage(`speakers/${slug}/photo.${ext(s.image)}`, s.image, legacyConsent);
    speakers[slug] = doc;
  }
  report.notes.push('Speaker roles, companies and bios were never recorded on the old site, so they are blank. Add them in the admin.');

  // ---- sponsors
  const sponsorByOldName = new Map(Object.entries(facts.sponsors).map(([slug, s]) => [s.oldName, slug]));
  const sponsors = {};
  const usedSponsors = new Set();

  // ---- events
  const events = {};
  const volunteerSeen = new Map(); // slug -> { name, image, linkedin }
  for (const [file, f] of Object.entries(facts.events)) {
    const ev = legacy.modules[file];
    if (!ev) {
      report.skipped.push(`${file}: not found in the old repository`);
      continue;
    }
    const index = byLink.get(f.link.toLowerCase());
    if (!index) throw new Error(`${file}: no entry in eventsData for ${f.link}`);
    const when = parseWhen(index.date, index.time);
    if (!when) throw new Error(`${file}: cannot read the date "${index.date}" "${index.time}"`);
    if (!when.weekdayOk) report.conflicts.push({ what: `${f.id}: weekday`, used: when.iso, others: [`${index.date}`], action: 'The weekday does not match the date; confirm the date.' });

    const venue = facts.venues[f.venue];
    if (!venue) throw new Error(`${f.id}: unknown venue ${f.venue}`);
    const { confirmed: _c, note: _n, ...venueDoc } = venue;

    // Photos: the old page's marquee list (de-duplicated, it repeated frames), or only the index photo when ownPhotoOnly.
    const sources = f.ownPhotoOnly ? [index.image] : [...new Set(ev.images?.imagePaths ?? [])];
    const gallery = [];
    const keyOf = new Map();
    sources.forEach((src, i) => {
      const key = addImage(`events/${f.id}/photo-${ordinal(i + 1)}.${ext(src)}`, src);
      keyOf.set(src, key);
      gallery.push({ media: key, alt: `${f.title}: photo ${i + 1} of ${sources.length}` });
    });
    const poster = keyOf.get(index.image) ?? addImage(`events/${f.id}/poster.${ext(index.image)}`, index.image);
    if (f.galleryNote) report.notes.push(`${f.id}: ${f.galleryNote}`);

    const speakerSlugs = (ev.speakers ?? []).map((s) => speakerSlug(s.name));

    // The end time: the facts file, else the event's own "9:00 AM - 5:30 PM".
    const end = f.end ?? when.endIso;
    if (!end) throw new Error(`${f.id}: the old site gave no end time and facts.json has none`);

    // Agenda: only events whose module exports a schedule (Community Day 2025). All sessions were on one "Main" track,
    // so no tracks are created. A session whose title was still "TBD" is named after who gave it. The old site's
    // longer session descriptions have no field in the new model and are not carried over.
    const agenda = [];
    const schedule = legacy.extras?.[file]?.schedule;
    if (schedule) {
      for (const item of schedule) {
        const t = parseSession(item.time, when.iso.slice(0, 10));
        if (!t) {
          report.skipped.push(`${f.id}: could not read the time "${item.time}" of "${item.title}"`);
          continue;
        }
        const names = (item.speakers ?? []).map((s) => speakerName(s.name));
        const ids = (item.speakers ?? []).map((s) => speakerSlug(s.name));
        for (const id of ids) if (!speakerSeen.has(id)) throw new Error(`${f.id}: agenda speaker "${id}" is not a listed speaker`);
        let title = item.title;
        if (/^TBD/i.test(title)) {
          title = names.length ? `Session with ${names.join(' and ')}` : 'Session';
          report.notes.push(`${f.id}: the agenda item at ${item.time} was still "TBD" on the old site; it is titled "${title}". Give it its real title in the admin.`);
        }
        agenda.push({ ...t, title, ...(ids.length ? { speakers: ids } : {}) });
      }
    }

    // Volunteers on the day become hosts. A volunteer who is already on the team is the same person.
    const hostSlugs = [];
    for (const v of ev.volunteers ?? []) {
      const slug = slugify(v.name);
      if (!volunteerSeen.has(slug)) volunteerSeen.set(slug, { name: v.name, image: v.image, linkedin: v.linkedin });
      hostSlugs.push(slug);
    }

    const tiered = [];
    for (const [group, tier] of Object.entries(facts.tierMap)) {
      for (const s of ev.sponsors?.[group] ?? []) {
        const slug = sponsorByOldName.get(s.name);
        if (!slug) throw new Error(`${f.id}: sponsor "${s.name}" is not in facts.sponsors`);
        usedSponsors.add(slug);
        tiered.push({ sponsor: slug, tier });
      }
    }

    let recap = (ev.aboutSections ?? [])
      .map((sec) => `### ${facts.recapHeadings[sec.title] ?? sec.title}\n\n${sec.content.join('\n\n')}`)
      .join('\n\n');
    for (const fix of facts.textFixes.filter((x) => x.event === file)) {
      if (!recap.includes(fix.find)) throw new Error(`${f.id}: text fix no longer applies: ${fix.find}`);
      recap = recap.replace(fix.find, fix.replace);
      report.fixes.push({ event: f.id, before: fix.find, after: fix.replace, reason: fix.reason });
    }

    const d = ev.eventDetails ?? {};
    const num = (v) => (v == null ? undefined : Number.parseInt(String(v), 10));
    const stats = { attendees: num(d.attendees), sessions: num(d.sessions), speakers: num(d.speakers) };
    if (stats.speakers !== undefined && stats.speakers !== speakerSlugs.length) {
      report.conflicts.push({ what: `${f.id}: speaker count`, used: `${speakerSlugs.length} listed (the count is left out)`, others: [`${stats.speakers} in the old numbers`], action: 'Add the missing speaker(s) in the admin, then set the speaker count.' });
      delete stats.speakers;
    }

    events[f.id] = {
      title: f.title,
      summary: f.summary,
      series: f.series,
      size: f.size,
      mode: f.mode,
      start: when.iso,
      end,
      venue: venueDoc,
      poster,
      registration: 'closed',
      overview: (ev.description ?? []).join('\n\n'),
      speakers: speakerSlugs,
      ...(agenda.length ? { agenda } : {}),
      sponsors: tiered,
      ...(hostSlugs.length ? { hosts: hostSlugs } : {}),
      recap,
      gallery,
      stats: Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== undefined)),
    };
  }

  for (const [slug, s] of Object.entries(facts.sponsors)) {
    if (!usedSponsors.has(slug)) continue;
    const doc = { name: s.name, url: s.url, defaultTier: s.defaultTier };
    if (s.blurb) doc.blurb = s.blurb;
    if (s.logo) {
      const src = join(legacy.assetsDir, s.logo);
      doc.logo = addImage(`sponsors/${slug}/logo.${ext(src)}`, src);
    }
    sponsors[slug] = doc;
  }

  // ---- organizers (the old "Meet our team" page)
  const organizers = {};
  for (const t of legacy.team) {
    const slug = slugify(t.name);
    organizers[slug] = {
      name: t.name,
      role: t.designation,
      ...(t.image ? { photo: addImage(`organizers/${slug}/photo.${ext(t.image)}`, t.image) } : {}),
      ...(t.linkedin ? { linkedin: normalizeLinkedIn(t.linkedin) } : {}),
      active: true,
    };
  }

  // Volunteers who are not on the team become inactive organizers (so the About page lists only the team), shown as
  // hosts on the events they helped at. Their photos follow the same rule as speakers: public only once consent is recorded.
  for (const [slug, v] of volunteerSeen) {
    if (organizers[slug]) continue;
    organizers[slug] = {
      name: v.name,
      role: 'Volunteer',
      ...(v.image ? { photo: addImage(`organizers/${slug}/photo.${ext(v.image)}`, v.image, legacyConsent) } : {}),
      ...(v.linkedin ? { linkedin: normalizeLinkedIn(v.linkedin) } : {}),
      active: false,
    };
  }

  const site = { ...facts.site };
  report.notes.push('Image alt text is generic ("<event>: photo 3 of 10") because the old site had none. Describe each photo in the admin.');
  report.notes.push('Speaker job titles and employers in the old Community Day 2025 data were not imported: speakers are shown by name and photo only, because titles change.');
  report.notes.push('The old site\'s separate "Volunteers" component held placeholder people (John Doe, Jane Smith, ...) and was not migrated. The real Community Day 2025 volunteers were.');
  report.notes.push('The sponsorship deck ("ACD Delhi 2025") and the Platinum, Gold and Silver packages from the old Call for Sponsors page live in public/sponsorship and src/data/sponsorship.json, shown on the Sponsors page. Prices are the 2025 ones in USD; update both for the next edition. The old CFS_Poster.png was not copied.');
  report.notes.push('The WhatsApp group link on the old Contact section was not published; add it back if you want it public.');
  report.notes.push('The chapter logo (src/assets/logi&icons/UGLogo.JPG) is used for the Delhi skyline hexagon only, without the "aws" wordmark, until AWS confirms the name in writing (npm run brand:badge).');
  return { events, speakers, sponsors, organizers, images, site, report };
}
