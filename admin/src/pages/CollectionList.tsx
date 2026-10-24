import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../form/pickers.tsx';
import { Thumb } from '../form/photos.tsx';
import type { CollectionName, ListItem } from '../lib/api.ts';
import { COLLECTIONS } from '../lib/collections.ts';
import { formatIst, formatIstDay, phaseOf } from '../lib/ist.ts';
import { timeAgo } from '../lib/time.ts';
import { useApi } from '../state/app.tsx';
import { useAsync } from '../state/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { Alert, Badge, Button, ButtonLink, PageHeading, Spinner } from '../ui/primitives.tsx';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Events and posts newest first; everything else alphabetically. */
function sorted(collection: CollectionName, items: ListItem[]): ListItem[] {
  const copy = [...items];
  const date = (i: ListItem) => Date.parse(String(collection === 'events' ? i.start : i.pubDate)) || 0;
  if (collection === 'events' || collection === 'posts') return copy.sort((a, b) => date(b) - date(a));
  return copy.sort((a, b) => COLLECTIONS[collection].titleOf(a).localeCompare(COLLECTIONS[collection].titleOf(b)));
}

type Filter = 'all' | 'upcoming' | 'past' | 'drafts';

const eventPhase = (i: ListItem) => (i.draft === true ? 'draft' : phaseOf(str(i.start), str(i.end)));

function matches(collection: CollectionName, i: ListItem, query: string, filter: Filter): boolean {
  if (query && !COLLECTIONS[collection].titleOf(i).toLowerCase().includes(query)) return false;
  if (filter === 'all') return true;
  if (filter === 'drafts') return i.draft === true;
  if (collection !== 'events') return true;
  const p = phaseOf(str(i.start), str(i.end));
  return i.draft !== true && (filter === 'past' ? p === 'past' : p !== 'past');
}

const PHASE_BADGE = { draft: ['warning', 'Draft'], upcoming: ['info', 'Upcoming'], today: ['success', 'Today'], past: ['neutral', 'Past'] } as const;

function EventCard({ item }: { item: ListItem }) {
  const phase = eventPhase(item);
  const [tone, label] = PHASE_BADGE[(phase ?? 'past') as keyof typeof PHASE_BADGE];
  const photos = Number(item.photos ?? 0);
  return (
    <li className="group relative overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-primary-accent hover:border-primary-accent">
      <div className="aspect-[3/2] bg-muted">
        {item.poster ? (
          <Thumb mediaKey={String(item.poster)} alt="" className="size-full" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Icon name="photo-star" size={32} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          {item.invalid && <Badge tone="error">Needs fixing</Badge>}
          {photos > 0 && (
            <span className="inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground">
              <Icon name="photo" size={16} />
              {photos} {photos === 1 ? 'photo' : 'photos'}
            </span>
          )}
        </div>
        <p className="font-mono text-sm tracking-wide text-primary-accent">{formatIstDay(str(item.start)) || 'DATE TO COME'}</p>
        <h2 className="text-lg leading-tight">
          <Link to={`/c/events/${item.id}`} className="no-underline after:absolute after:inset-0 after:content-[''] hover:underline">
            {COLLECTIONS.events.titleOf(item)}
          </Link>
        </h2>
        {(item.mode === 'online' || str(item.venue)) && (
          <p className="flex items-center gap-1 text-muted-foreground">
            <Icon name="map-pin" size={16} />
            {item.mode === 'online' ? 'Online' : str(item.venue)}
          </p>
        )}
        {item.lastModified && <p className="text-[0.8125rem] text-muted-foreground">Saved {timeAgo(item.lastModified)}{item.editor ? ` by ${item.editor}` : ''}</p>}
      </div>
    </li>
  );
}

function PeopleTable({ collection, items }: { collection: CollectionName; items: ListItem[] }) {
  const meta = COLLECTIONS[collection];
  const pic = (i: ListItem) => i.photo ?? i.logo;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <caption className="visually-hidden">{meta.label}</caption>
        <thead>
          <tr className="border-b-2 border-foreground">
            <th scope="col" className="py-2 pr-4 font-bold">
              Name
            </th>
            {meta.columns.map((c) => (
              <th key={c.header} scope="col" className="py-2 pr-4 font-bold">
                {c.header}
              </th>
            ))}
            <th scope="col" className="py-2 font-bold">
              Last saved
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border align-middle">
              <th scope="row" className="py-3 pr-4 font-normal">
                <span className="flex items-center gap-3">
                  {collection !== 'posts' && <Avatar name={meta.titleOf(item)} photo={pic(item)} />}
                  <Link to={`/c/${collection}/${item.id}`} className="link font-bold">
                    {meta.titleOf(item)}
                  </Link>
                  {item.invalid && <Badge tone="error">Needs fixing</Badge>}
                </span>
              </th>
              {meta.columns.map((c) => (
                <td key={c.header} className="py-3 pr-4 text-muted-foreground">
                  {c.render(item)}
                </td>
              ))}
              <td className="py-3 text-muted-foreground">
                {formatIst(item.lastModified)}
                {item.editor ? ` by ${item.editor}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CollectionList({ collection }: { collection: CollectionName }) {
  const meta = COLLECTIONS[collection];
  const api = useApi();
  const list = useAsync(() => api.list(collection), `list:${collection}`);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => sorted(collection, (list.data ?? []).filter((i) => matches(collection, i, q, filter))), [collection, list.data, q, filter]);
  const total = list.data?.length ?? 0;
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...(collection === 'events' ? [{ id: 'upcoming' as const, label: 'Upcoming' }, { id: 'past' as const, label: 'Past' }] : []),
    ...(meta.hasDraft ? [{ id: 'drafts' as const, label: 'Drafts' }] : []),
  ];

  let body: ReactNode = null;
  if (list.data && total > 0) {
    body =
      shown.length === 0 ? (
        <p className="rounded-md border border-border p-6 text-muted-foreground">Nothing matches. Clear the search or choose another filter.</p>
      ) : collection === 'events' ? (
        <ul aria-label="Events" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((i) => (
            <EventCard key={i.id} item={i} />
          ))}
        </ul>
      ) : (
        <PeopleTable collection={collection} items={shown} />
      );
  }

  return (
    <>
      <PageHeading title={meta.label}>
        <ButtonLink to={`/c/${collection}/new`} variant="primary">
          <Icon name="plus" size={18} />
          New {meta.singular}
        </ButtonLink>
      </PageHeading>

      {list.loading && !list.data && <Spinner label={`Loading ${meta.label.toLowerCase()}`} />}
      {list.error && (
        <Alert tone="error" title={`Could not load ${meta.label.toLowerCase()}.`} actions={<Button onClick={list.reload}>Try again</Button>}>
          {list.error.message}
        </Alert>
      )}
      {list.data && total === 0 && (
        <p className="rounded-md border border-border p-6 text-muted-foreground">
          No {meta.label.toLowerCase()} yet. Use “New {meta.singular}” to add the first.
        </p>
      )}
      {list.data && total > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <label htmlFor="list-search" className="visually-hidden">
              Search {meta.label.toLowerCase()}
            </label>
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
              <Icon name="search" size={18} />
            </span>
            <input id="list-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${meta.label.toLowerCase()}`} className="block min-h-ctl w-full rounded-md border border-input bg-background py-2 pr-3 pl-10 focus-visible:ring-3 focus-visible:ring-outline/50" />
          </div>
          {filters.length > 1 && (
            <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`min-h-ctl rounded-full border px-4 font-bold ${filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground" aria-live="polite">
            {shown.length === total ? `${total} ${total === 1 ? meta.singular : meta.label.toLowerCase()}` : `${shown.length} of ${total}`}
          </p>
        </div>
      )}
      {body}
    </>
  );
}
