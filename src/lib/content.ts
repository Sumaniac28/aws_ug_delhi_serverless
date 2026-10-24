import { getCollection } from 'astro:content';
import type { EventData, SpeakerData, SponsorData } from '../schema';
import { siteSchema } from '../schema';
import siteJson from '../data/site.json';
import { istDateKey, yearOf } from './time';

export const site = siteSchema.parse(siteJson);

export type Phase = 'upcoming' | 'today' | 'past';

export interface EventView {
  id: string;
  data: EventData;
  year: string;
  url: string;
  phase: Phase;
  startMs: number;
  endMs: number;
}

export interface SpeakerView {
  id: string;
  data: SpeakerData;
  /** False when consent.publish is not true: photo and bio must not be rendered. */
  published: boolean;
}

const orphan = (kind: string, from: string, id: string) => {
  throw new Error(`${from}: ${kind} "${id}" does not exist. Check the slug or add the file under src/content.`);
};

/** Build time is the reference instant; every datetime carries an explicit offset so this is unambiguous. */
export function phaseOf(start: string, end: string, now = Date.now()): Phase {
  const endMs = Date.parse(end);
  if (endMs < now) return 'past';
  if (istDateKey(start) === istDateKey(now) || Date.parse(start) <= now) return 'today';
  return 'upcoming';
}

export async function getSpeakers() {
  const all = await getCollection('speakers');
  return new Map<string, SpeakerView>(
    all.map((s) => [s.id, { id: s.id, data: s.data, published: s.data.consent.publish === true }]),
  );
}

export async function getSponsors() {
  const all = await getCollection('sponsors');
  return new Map<string, { id: string; data: SponsorData }>(all.map((s) => [s.id, { id: s.id, data: s.data }]));
}

/** The active organizing team: who the About page lists. */
export async function getOrganizers() {
  const all = await getCollection('organizers');
  return all.filter((o) => o.data.active);
}

/** Everyone who has helped, including volunteers who are not on the team: who an event can name as a host. */
export async function getAllOrganizers() {
  return getCollection('organizers');
}

/** Published (non-draft) events, validated against speakers/sponsors/organizers, sorted soonest first. */
export async function getEvents(): Promise<EventView[]> {
  const [events, speakers, sponsors, organizers] = await Promise.all([
    getCollection('events', (e) => !e.data.draft),
    getSpeakers(),
    getSponsors(),
    getCollection('organizers'),
  ]);
  const organizerIds = new Set(organizers.map((o) => o.id));
  const now = Date.now();

  const views = events.map((e) => {
    for (const s of e.data.speakers) if (!speakers.has(s)) orphan('speaker', `events/${e.id}`, s);
    for (const a of e.data.agenda) for (const s of a.speakers) if (!speakers.has(s)) orphan('speaker', `events/${e.id} agenda`, s);
    for (const s of e.data.sponsors) if (!sponsors.has(s.sponsor)) orphan('sponsor', `events/${e.id}`, s.sponsor);
    for (const h of e.data.hosts) if (!organizerIds.has(h)) orphan('organizer', `events/${e.id}`, h);
    const year = yearOf(e.data.start);
    return {
      id: e.id,
      data: e.data,
      year,
      url: `/events/${year}/${e.id}/`,
      phase: phaseOf(e.data.start, e.data.end, now),
      startMs: Date.parse(e.data.start),
      endMs: Date.parse(e.data.end),
    } satisfies EventView;
  });
  return views.sort((a, b) => a.startMs - b.startMs);
}

export async function getUpcomingEvents() {
  return (await getEvents()).filter((e) => e.phase !== 'past');
}

/** Most recent first. */
export async function getPastEvents() {
  return (await getEvents()).filter((e) => e.phase === 'past').sort((a, b) => b.startMs - a.startMs);
}

/** The picture that represents an event in cards: its poster, else its first photo. */
export const coverOf = (event: EventView): string | undefined => event.data.ogImage ?? event.data.poster ?? event.data.gallery[0]?.media;

/** The stops either side of an event on the line, by start time. */
export function neighbours(event: EventView, all: EventView[]) {
  const i = all.findIndex((e) => e.id === event.id);
  return { previous: i > 0 ? all[i - 1] : undefined, next: i >= 0 && i < all.length - 1 ? all[i + 1] : undefined };
}

export interface Appearances {
  /** Events this speaker spoke at, most recent first. */
  events: EventView[];
  /** Other speakers they shared an event with, most shared first. */
  coSpeakers: string[];
}

/** For every speaker: where they spoke and with whom. Speakers never carry a job title (it changes). */
export async function getSpeakerAppearances(): Promise<Map<string, Appearances>> {
  const events = (await getEvents()).slice().sort((a, b) => b.startMs - a.startMs);
  const map = new Map<string, Appearances>();
  const shared = new Map<string, Map<string, number>>();
  for (const e of events) {
    const ids = [...new Set([...e.data.speakers, ...e.data.agenda.flatMap((a) => a.speakers)])];
    for (const id of ids) {
      const a = map.get(id) ?? { events: [], coSpeakers: [] };
      a.events.push(e);
      map.set(id, a);
      const counts = shared.get(id) ?? new Map<string, number>();
      for (const other of ids) if (other !== id) counts.set(other, (counts.get(other) ?? 0) + 1);
      shared.set(id, counts);
    }
  }
  for (const [id, a] of map) a.coSpeakers = [...(shared.get(id) ?? new Map())].sort((x, y) => y[1] - x[1]).map(([o]) => o);
  return map;
}

/** "Spoke at 3 events", the same everywhere a speaker is introduced. No years: the group is older than its records. */
export function speakerLine(a: Appearances | undefined): string {
  if (!a || a.events.length === 0) return 'Speaker at AWS User Group Delhi NCR';
  const n = a.events.length;
  return `Spoke at ${n} ${n === 1 ? 'event' : 'events'}`;
}

/** About 220 words a minute, never less than one. */
export const readingTime = (text: string) => Math.max(1, Math.round(text.trim().split(/\s+/).length / 220));

export async function getPosts() {
  const [posts, organizers, events] = await Promise.all([
    getCollection('posts', (p) => !p.data.draft),
    getCollection('organizers'),
    getCollection('events'),
  ]);
  const authorIds = new Set(organizers.map((o) => o.id));
  const eventIds = new Set(events.map((e) => e.id));
  for (const p of posts) {
    if (!authorIds.has(p.data.author)) orphan('organizer', `posts/${p.id} author`, p.data.author);
    if (p.data.relatedEvent && !eventIds.has(p.data.relatedEvent)) orphan('event', `posts/${p.id}`, p.data.relatedEvent);
  }
  return posts.sort((a, b) => Date.parse(b.data.pubDate) - Date.parse(a.data.pubDate));
}
