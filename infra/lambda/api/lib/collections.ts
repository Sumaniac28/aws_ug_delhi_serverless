// The editable collections. Each one is validated with the SAME Zod schema the Astro build uses
// (src/schema/index.ts), so an organizer cannot save anything the site build would reject.
import type { ZodType } from 'zod';
import { eventSchema, organizerSchema, postSchema, speakerSchema, sponsorSchema } from '../../../../src/schema/index.ts';

export type CollectionName = 'events' | 'speakers' | 'sponsors' | 'organizers' | 'posts';

type Doc = Record<string, unknown>;

export interface CollectionDef {
  schema: ZodType;
  /** The few fields the admin list view shows, so it does not need to load every document. */
  summary: (d: Doc) => Doc;
}

export const COLLECTIONS: Record<CollectionName, CollectionDef> = {
  events: { schema: eventSchema, summary: (d) => ({ title: d.title, start: d.start, end: d.end, series: d.series, draft: d.draft }) },
  speakers: { schema: speakerSchema, summary: (d) => ({ name: d.name, published: (d.consent as { publish?: boolean } | undefined)?.publish === true }) },
  sponsors: { schema: sponsorSchema, summary: (d) => ({ name: d.name, tier: d.defaultTier }) },
  organizers: { schema: organizerSchema, summary: (d) => ({ name: d.name, role: d.role, active: d.active }) },
  posts: { schema: postSchema, summary: (d) => ({ title: d.title, pubDate: d.pubDate, draft: d.draft }) },
};

export const isCollection = (name: string): name is CollectionName => Object.hasOwn(COLLECTIONS, name);

/** Same shape as the schema's slug: also used as the file name, so it must be path-safe. */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidId = (id: string) => id.length <= 80 && ID_PATTERN.test(id);

export const contentKey = (collection: CollectionName, id: string) => `content/${collection}/${id}.json`;
export const contentPrefix = (collection: CollectionName) => `content/${collection}/`;
