// Referential integrity. The Astro build fails if an event names a speaker that does not exist, so
// the API refuses to save or delete anything that would break the next publish.
import type { CollectionName } from './collections.ts';
import { mapLimit, type ContentStore } from './store.ts';

export interface Ref {
  collection: CollectionName;
  id: string;
}

type Doc = Record<string, any>;

/** Everything a document points at. */
export function referencesOf(collection: CollectionName, doc: Doc): Ref[] {
  const refs: Ref[] = [];
  const add = (c: CollectionName, ids: unknown) => {
    for (const id of [ids].flat()) if (typeof id === 'string') refs.push({ collection: c, id });
  };
  if (collection === 'events') {
    add('speakers', doc.speakers);
    add('speakers', (doc.agenda ?? []).flatMap((a: Doc) => a.speakers ?? []));
    add('sponsors', (doc.sponsors ?? []).map((s: Doc) => s.sponsor));
    add('organizers', doc.hosts);
  }
  if (collection === 'posts') {
    add('organizers', doc.author);
    if (doc.relatedEvent) add('events', doc.relatedEvent);
  }
  // De-duplicate.
  return [...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values()];
}

/** Which collections can contain a reference to a document of the given collection. */
const REFERRERS: Record<CollectionName, CollectionName[]> = {
  speakers: ['events'],
  sponsors: ['events'],
  organizers: ['events', 'posts'],
  events: ['posts'],
  posts: [],
};

/** References in a document that point at nothing. */
export async function missingReferences(store: ContentStore, collection: CollectionName, doc: Doc): Promise<Ref[]> {
  const refs = referencesOf(collection, doc);
  const found = await mapLimit(refs, 8, (r) => store.exists(r.collection, r.id));
  return refs.filter((_, i) => !found[i]);
}

/** Documents that still point at the given one. */
export async function dependents(store: ContentStore, collection: CollectionName, id: string): Promise<Ref[]> {
  const out: Ref[] = [];
  for (const referrer of REFERRERS[collection]) {
    const listed = await store.list(referrer);
    await mapLimit(listed, 8, async (item) => {
      const stored = await store.get(referrer, item.id);
      if (!stored) return;
      if (referencesOf(referrer, stored.data as Doc).some((r) => r.collection === collection && r.id === id)) out.push({ collection: referrer, id: item.id });
    });
  }
  return out;
}
