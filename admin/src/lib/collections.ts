import type { CollectionName, Doc, ListItem } from './api.ts';
import { formatIst, phaseOf } from './ist.ts';

export interface Column {
  header: string;
  render: (item: ListItem) => string;
}

/** Anything with an id and some fields: a list row, or a document being edited. */
export type Titled = { id: string; [field: string]: unknown };

export interface CollectionMeta {
  name: CollectionName;
  /** Plural, for navigation and headings. */
  label: string;
  /** Singular, for buttons ("New event"). */
  singular: string;
  /** What to call an item in a list. */
  titleOf: (item: Titled) => string;
  columns: Column[];
  /** A starting document for "New". Only what the form needs to show sensible controls. */
  emptyDoc: () => Doc;
  /** Which field the new item's id is suggested from. */
  idSource: 'title' | 'name';
  /** Items can be marked draft (kept off the public site). */
  hasDraft: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function eventStatus(item: ListItem): string {
  if (item.draft === true) return 'Draft';
  const p = phaseOf(str(item.start), str(item.end));
  return p === 'past' ? 'Past' : p === 'today' ? 'Today' : p === 'upcoming' ? 'Upcoming' : '';
}

export const COLLECTIONS: Record<CollectionName, CollectionMeta> = {
  events: {
    name: 'events',
    label: 'Events',
    singular: 'event',
    titleOf: (i) => str(i.title) || i.id,
    columns: [
      { header: 'When', render: (i) => formatIst(str(i.start)) },
      { header: 'Status', render: eventStatus },
    ],
    emptyDoc: () => ({ series: 'meetup', size: 'mid', mode: 'offline', status: 'scheduled', registration: 'not-open', draft: true }),
    idSource: 'title',
    hasDraft: true,
  },
  speakers: {
    name: 'speakers',
    label: 'Speakers',
    singular: 'speaker',
    titleOf: (i) => str(i.name) || i.id,
    columns: [{ header: 'On the site', render: (i) => (i.published === true ? 'Photo and page shown' : 'Name only') }],
    emptyDoc: () => ({ consent: { publish: false } }),
    idSource: 'name',
    hasDraft: false,
  },
  sponsors: {
    name: 'sponsors',
    label: 'Sponsors',
    singular: 'sponsor',
    titleOf: (i) => str(i.name) || i.id,
    columns: [{ header: 'Tier', render: (i) => str(i.tier) }],
    emptyDoc: () => ({ defaultTier: 'community' }),
    idSource: 'name',
    hasDraft: false,
  },
  organizers: {
    name: 'organizers',
    label: 'Organizers',
    singular: 'organizer',
    titleOf: (i) => str(i.name) || i.id,
    columns: [
      { header: 'Role', render: (i) => str(i.role) },
      { header: 'Status', render: (i) => (i.active === false ? 'Inactive' : 'Active') },
    ],
    emptyDoc: () => ({ active: true }),
    idSource: 'name',
    hasDraft: false,
  },
  posts: {
    name: 'posts',
    label: 'Blog posts',
    singular: 'post',
    titleOf: (i) => str(i.title) || i.id,
    columns: [
      { header: 'Published', render: (i) => formatIst(str(i.pubDate)) },
      { header: 'Status', render: (i) => (i.draft === true ? 'Draft' : 'Live') },
    ],
    emptyDoc: () => ({ draft: true }),
    idSource: 'title',
    hasDraft: true,
  },
};

export const COLLECTION_ORDER: CollectionName[] = ['events', 'speakers', 'sponsors', 'organizers', 'posts'];

export const isCollectionName = (s: string | undefined): s is CollectionName => !!s && Object.hasOwn(COLLECTIONS, s);
