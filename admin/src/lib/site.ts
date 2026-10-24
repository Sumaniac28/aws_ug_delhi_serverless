import type { CollectionName } from './api.ts';
import { toInput } from './ist.ts';

/** The public page for a saved item, when it has one (sponsors only appear inside other pages). */
export function pageOnSite(siteUrl: string, collection: CollectionName, id: string, doc: Record<string, any>): string | undefined {
  if (collection === 'events') return typeof doc.start === 'string' && doc.start ? `${siteUrl}/events/${toInput(doc.start).slice(0, 4)}/${id}/` : undefined;
  // A speaker has a page only with their permission: the full document says so in consent, the list summary in published.
  if (collection === 'speakers') return doc.consent?.publish === true || doc.published === true ? `${siteUrl}/speakers/${id}/` : undefined;
  if (collection === 'posts') return `${siteUrl}/blog/${id}/`;
  return undefined;
}
