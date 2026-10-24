// The four content routes: list, get, save (create or update) and delete.
import { COLLECTIONS, isCollection, isValidId, type CollectionName } from '../lib/collections.ts';
import { HttpError, header, json, jsonBody, pathParam, type ApiEvent, type ApiResult } from '../lib/http.ts';
import { dependents, missingReferences } from '../lib/integrity.ts';
import type { Ctx, Deps } from '../lib/route.ts';
import { mapLimit } from '../lib/store.ts';

const MAX_DOCUMENT_BYTES = 256 * 1024;

export interface Warning {
  code: string;
  message: string;
}

/**
 * The content is already saved by the time this runs, so a scheduling problem must not fail the request.
 * It is reported as a warning instead; the nightly rebuild still moves the event to Past.
 */
async function scheduling(run: ((s: NonNullable<Deps['scheduler']>) => Promise<unknown>) | null, deps: Deps, what: string): Promise<Warning[]> {
  if (!run || !deps.scheduler) return [];
  try {
    await run(deps.scheduler);
    return [];
  } catch (e) {
    console.error(JSON.stringify({ msg: 'schedule sync failed', what, error: e instanceof Error ? { name: e.name, message: e.message } : String(e) }));
    return [{ code: 'schedule_failed', message: 'Saved, but the automatic switch to Past could not be scheduled. The site will still update at the nightly rebuild.' }];
  }
}

function target(event: ApiEvent): { collection: CollectionName; id: string } {
  const collection = pathParam(event, 'collection');
  if (!isCollection(collection)) throw new HttpError(404, 'unknown_collection', `There is no collection called "${collection}".`);
  const id = pathParam(event, 'id');
  if (!isValidId(id)) throw new HttpError(400, 'bad_id', 'IDs use lowercase letters, digits and hyphens only (for example "meetup-13-gurugram").');
  return { collection, id };
}

function collectionOf(event: ApiEvent): CollectionName {
  const collection = pathParam(event, 'collection');
  if (!isCollection(collection)) throw new HttpError(404, 'unknown_collection', `There is no collection called "${collection}".`);
  return collection;
}

/** ETags arrive from browsers quoted or not; S3 wants them exactly as it issued them (quoted). */
const normalizeEtag = (raw: string) => (/^".*"$/.test(raw) ? raw : `"${raw}"`);

export async function list(event: ApiEvent, { deps }: Ctx): Promise<ApiResult> {
  const collection = collectionOf(event);
  const listed = await deps.store.list(collection);
  const items = await mapLimit(listed, 8, async (item) => {
    const stored = await deps.store.get(collection, item.id);
    if (!stored) return { id: item.id, etag: item.etag, lastModified: item.lastModified, invalid: true };
    const parsed = COLLECTIONS[collection].schema.safeParse(stored.data);
    return {
      id: item.id,
      etag: stored.etag,
      lastModified: stored.lastModified,
      editor: stored.editor,
      // A document that no longer matches the schema is flagged rather than hidden, so someone can fix it.
      ...(parsed.success ? COLLECTIONS[collection].summary(parsed.data as Record<string, unknown>) : { invalid: true }),
    };
  });
  return json(200, { collection, items });
}

export async function get(event: ApiEvent, { deps }: Ctx): Promise<ApiResult> {
  const { collection, id } = target(event);
  const stored = await deps.store.get(collection, id);
  if (!stored) throw new HttpError(404, 'not_found', `No ${collection} item called "${id}".`);
  return json(200, { id, etag: stored.etag, lastModified: stored.lastModified, editor: stored.editor, data: stored.data }, { etag: stored.etag });
}

export async function save(event: ApiEvent, { organizer, deps }: Ctx): Promise<ApiResult> {
  const { collection, id } = target(event);

  // Validate first: the schema is the same one the site build uses, including the join-link guard.
  const parsed = COLLECTIONS[collection].schema.safeParse(jsonBody(event, MAX_DOCUMENT_BYTES));
  if (!parsed.success) {
    throw new HttpError(422, 'invalid_document', 'Some fields need fixing before this can be saved.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }

  // Every save must say which version it is based on (update) or that it expects a new item (create).
  const ifMatch = header(event, 'if-match');
  const ifNoneMatch = header(event, 'if-none-match');
  if ((ifMatch === undefined) === (ifNoneMatch === undefined)) {
    throw new HttpError(428, 'precondition_required', 'Send exactly one of If-Match (with the item\'s ETag, to update) or If-None-Match: * (to create).');
  }
  if (ifNoneMatch !== undefined && ifNoneMatch !== '*') throw new HttpError(400, 'bad_request', 'If-None-Match must be "*".');

  // The next site build fails on a dangling reference, so refuse it here with a readable message.
  const missing = await missingReferences(deps.store, collection, parsed.data as Record<string, unknown>);
  if (missing.length) {
    throw new HttpError(422, 'missing_references', `This refers to items that do not exist: ${missing.map((m) => `${m.collection}/${m.id}`).join(', ')}.`, missing);
  }

  const etag = await deps.store.put(collection, id, parsed.data, {
    ifMatch: ifMatch === undefined ? undefined : normalizeEtag(ifMatch),
    ifNoneMatch: ifNoneMatch === undefined ? undefined : '*',
    editor: organizer.username,
  });
  console.log(JSON.stringify({ msg: 'content saved', collection, id, editor: organizer.username, created: ifNoneMatch !== undefined, etag }));

  const warnings = await scheduling(collection === 'events' ? (s) => s.sync(collection, id, parsed.data as Record<string, any>) : null, deps, `save ${collection}/${id}`);
  return json(ifNoneMatch !== undefined ? 201 : 200, { id, etag, data: parsed.data, ...(warnings.length ? { warnings } : {}) }, { etag });
}

export async function remove(event: ApiEvent, { organizer, deps }: Ctx): Promise<ApiResult> {
  const { collection, id } = target(event);
  const stored = await deps.store.get(collection, id);
  if (!stored) throw new HttpError(404, 'not_found', `No ${collection} item called "${id}".`);

  const ifMatch = header(event, 'if-match');
  if (ifMatch !== undefined && normalizeEtag(ifMatch) !== stored.etag) {
    throw new HttpError(412, 'conflict', 'Someone else changed this item since you opened it. Reload it before deleting.');
  }

  const used = await dependents(deps.store, collection, id);
  if (used.length) {
    throw new HttpError(409, 'in_use', `Still used by: ${used.map((u) => `${u.collection}/${u.id}`).join(', ')}. Remove those references first.`, used);
  }

  await deps.store.remove(collection, id);
  console.log(JSON.stringify({ msg: 'content deleted', collection, id, editor: organizer.username }));

  const warnings = await scheduling(collection === 'events' ? (s) => s.remove(id) : null, deps, `delete ${collection}/${id}`);
  return json(200, { deleted: true, id, ...(warnings.length ? { warnings } : {}) });
}
