import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError, type CollectionName, type ListItem } from '../lib/api.ts';
import { COLLECTION_ORDER, COLLECTIONS } from '../lib/collections.ts';
import { formatIstDay } from '../lib/ist.ts';
import { pageOnSite } from '../lib/site.ts';
import { timeAgo } from '../lib/time.ts';
import { useApp, useApi } from '../state/app.tsx';
import { useAsync } from '../state/hooks.ts';
import { usePublish } from '../state/publish.tsx';
import { Thumb } from '../form/photos.tsx';
import { Icon, type IconName } from '../ui/icons.tsx';
import { Alert, Button, ButtonLink, PageHeading, Spinner, buttonClass } from '../ui/primitives.tsx';
import { useToast } from '../ui/toast.tsx';

const ICONS: Record<CollectionName, IconName> = { events: 'calendar-event', speakers: 'microphone', sponsors: 'building-store', organizers: 'users', posts: 'news' };
type Lists = Record<CollectionName, ListItem[]>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const time = (v: unknown) => Date.parse(str(v)) || 0;

function daysTo(iso: string): string {
  const days = Math.ceil((time(iso) - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function Panel({ title, id, children, action }: { title: string; id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid grid-cols-1 content-start gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One switch per ticket type: "we just sold out of Early bird" is one click here instead of opening the editor.
 * It loads the event fresh, changes only that ticket, and saves with the version it just read, so nobody else's
 * edit can be overwritten.
 */
function TicketToggles({ id, tickets, onSaved }: { id: string; tickets: { name: string; soldOut: boolean }[]; onSaved: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { refresh } = usePublish();
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState('');

  const flip = async (index: number, soldOut: boolean) => {
    setBusy(index);
    setProblem('');
    try {
      const fresh = await api.get('events', id);
      const list = [...((fresh.data.tickets as { name: string; soldOut?: boolean }[] | undefined) ?? [])];
      // Find the ticket by name (names are unique), so a reordered list still flips the right one.
      const at = list.findIndex((t) => t.name === tickets[index]!.name);
      if (at < 0) throw new ApiError(412, 'conflict', 'That ticket was changed or removed while this page was open.');
      list[at] = { ...list[at]!, soldOut };
      await api.update('events', id, { ...fresh.data, tickets: list }, fresh.etag);
      toast(soldOut ? `${tickets[index]!.name} is marked sold out. Publish to show it on the website.` : `${tickets[index]!.name} is on sale again. Publish to show it on the website.`);
      void refresh();
      onSaved();
    } catch (e: any) {
      if (e instanceof ApiError && e.isConflict) {
        setProblem('Someone changed this event just now. The list has been refreshed. Try again.');
        onSaved();
      } else setProblem(e?.message ?? 'Could not save that. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <fieldset className="mt-3 grid grid-cols-1 gap-1 border-t border-border pt-3">
      <legend className="sr-only">Ticket types</legend>
      <p className="text-sm font-semibold">Tickets</p>
      {tickets.map((t, i) => (
        <label key={t.name} className="flex min-h-8 items-center justify-between gap-3 text-sm">
          <span className={t.soldOut ? 'text-muted-foreground line-through' : ''}>{t.name}</span>
          <span className="inline-flex items-center gap-2 font-medium">
            <input type="checkbox" role="switch" aria-label={`Sold out: ${t.name}`} checked={t.soldOut} disabled={busy !== null} onChange={(e) => void flip(i, e.target.checked)} className="size-4 accent-[var(--primary-accent)]" />
            Sold out
          </span>
        </label>
      ))}
      {problem && <p role="alert" className="text-sm font-medium text-error">{problem}</p>}
    </fieldset>
  );
}

/** The next event, or an invitation to plan one. */
function NextEvent({ events, onSaved }: { events: ListItem[]; onSaved: () => void }) {
  const { config } = useApp();
  const next = events
    .filter((e) => !e.invalid && time(e.end) > Date.now())
    .sort((a, b) => time(a.start) - time(b.start))[0];

  if (!next) {
    return (
      <Panel title="What's next" id="next-title">
        <div className="grid justify-items-start gap-3">
          <Icon name="calendar-plus" size={36} />
          <p className="max-w-md text-muted-foreground">No upcoming event yet. When you plan one, it shows here with a shortcut to everything you need.</p>
          <ButtonLink to="/c/events/new" variant="primary">
            <Icon name="plus" size={18} />
            Plan the next event
          </ButtonLink>
        </div>
      </Panel>
    );
  }
  const onSite = next.draft === true ? undefined : pageOnSite(config.siteUrl, 'events', next.id, next);
  return (
    <Panel title="What's next" id="next-title">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <div className="aspect-[3/2] overflow-hidden rounded-md border border-border bg-muted">
          {next.poster ? (
            <Thumb mediaKey={String(next.poster)} alt="" className="size-full" />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground">
              <Icon name="photo-star" size={32} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 content-start gap-2">
          <p className="font-mono text-sm tracking-wide text-primary-accent">
            {formatIstDay(str(next.start))} · {daysTo(str(next.start))}
            {next.draft === true && ' · DRAFT'}
          </p>
          <h3 className="text-xl">
            <Link to={`/c/events/${next.id}`} className="no-underline hover:underline">
              {COLLECTIONS.events.titleOf(next)}
            </Link>
          </h3>
          {str(next.venue) || next.mode === 'online' ? (
            <p className="flex items-center gap-1 text-muted-foreground">
              <Icon name="map-pin" size={16} />
              {next.mode === 'online' ? 'Online' : str(next.venue)}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <ButtonLink to={`/c/events/${next.id}`} variant="primary">
              Edit event
            </ButtonLink>
            {onSite && (
              <a href={onSite} target="_blank" rel="noreferrer" className={buttonClass('outline')}>
                View on the website
                <Icon name="external-link" size={16} />
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            )}
          </div>
          {Array.isArray(next.tickets) && next.tickets.length > 0 && <TicketToggles id={next.id} tickets={next.tickets as { name: string; soldOut: boolean }[]} onSaved={onSaved} />}
        </div>
      </div>
    </Panel>
  );
}

function QuickActions({ events }: { events: ListItem[] }) {
  const lastPast = events
    .filter((e) => !e.invalid && time(e.end) < Date.now())
    .sort((a, b) => time(b.start) - time(a.start))[0];
  return (
    <Panel title="Quick actions" id="quick-title">
      <div className="grid grid-cols-1 gap-2">
        <ButtonLink to="/c/events/new" variant="primary" className="justify-start">
          <Icon name="calendar-plus" size={18} />
          New event
        </ButtonLink>
        {lastPast && (
          <ButtonLink to={`/c/events/${lastPast.id}#photos`} className="justify-start">
            <Icon name="photo-plus" size={18} />
            Add photos to {COLLECTIONS.events.titleOf(lastPast)}
          </ButtonLink>
        )}
        <ButtonLink to="/c/speakers/new" className="justify-start">
          <Icon name="user-plus" size={18} />
          Add a speaker
        </ButtonLink>
        <ButtonLink to="/c/posts/new" className="justify-start">
          <Icon name="writing" size={18} />
          Write a blog post
        </ButtonLink>
      </div>
    </Panel>
  );
}

function Waiting() {
  const { status, notConfigured } = usePublish();
  const items = status?.pending.items ?? [];
  const count = status?.pending.count ?? 0;
  return (
    <Panel title="Waiting to go live" id="waiting-title">
      {notConfigured ? (
        <p className="text-muted-foreground">Publishing is not set up yet. Your saved work is safe.</p>
      ) : !status ? (
        <Spinner label="Checking" />
      ) : count === 0 ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Icon name="circle-check" />
          Everything you saved is on the website.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1">
            {items.slice(0, 6).map((c) => (
              <li key={`${c.collection}/${c.id}`} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border py-2">
                {c.kind === 'saved' ? (
                  <Link to={`/c/${c.collection}/${c.id}`} className="link font-bold">
                    {c.label ?? c.id}
                  </Link>
                ) : (
                  <span className="font-bold">{c.label ?? c.id}</span>
                )}
                <span className="text-[0.8125rem] text-muted-foreground">
                  {COLLECTIONS[c.collection].singular} {c.kind}
                  {c.editor ? ` by ${c.editor}` : ''}, {timeAgo(c.at)}
                </span>
              </li>
            ))}
          </ul>
          {count > 6 && <p className="text-muted-foreground">…and {count - 6} more.</p>}
          <p className="text-muted-foreground">When you are ready, press Publish in the menu.</p>
        </>
      )}
    </Panel>
  );
}

function Recent({ data }: { data: Lists }) {
  const rows = COLLECTION_ORDER.flatMap((c) => data[c].filter((i) => !i.invalid && i.lastModified).map((i) => ({ c, i })))
    .sort((a, b) => time(b.i.lastModified) - time(a.i.lastModified))
    .slice(0, 6);
  return (
    <Panel title="Recently edited" id="recent-title">
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nothing edited yet.</p>
      ) : (
        <ul className="grid grid-cols-1">
          {rows.map(({ c, i }) => (
            <li key={`${c}/${i.id}`} className="flex items-center gap-3 border-t border-border py-2">
              <Icon name={ICONS[c]} className="text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Link to={`/c/${c}/${i.id}`} className="link block truncate font-bold">
                  {COLLECTIONS[c].titleOf(i)}
                </Link>
                <span className="text-[0.8125rem] text-muted-foreground">
                  {i.editor ? `${i.editor}, ` : ''}
                  {timeAgo(i.lastModified)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Overview() {
  const api = useApi();
  const all = useAsync(async () => {
    const entries = await Promise.all(COLLECTION_ORDER.map(async (c) => [c, await api.list(c)] as const));
    return Object.fromEntries(entries) as Lists;
  }, 'overview');

  if (all.loading && !all.data) return <Spinner label="Loading" />;
  if (all.error) return <Alert tone="error" title="Could not load your content." actions={<Button onClick={all.reload}>Try again</Button>}>{all.error.message}</Alert>;

  const data = all.data!;
  const attention = COLLECTION_ORDER.flatMap((c) => (data[c] ?? []).filter((i) => i.invalid).map((i) => ({ c, i })));
  const drafts = COLLECTION_ORDER.flatMap((c) => (data[c] ?? []).filter((i) => i.draft === true).map((i) => ({ c, i })));

  return (
    <>
      {attention.length > 0 && (
        <Alert tone="error" title={`${attention.length} ${attention.length === 1 ? 'item needs' : 'items need'} fixing`}>
          <p>These no longer match the rules the website needs, and would stop it from publishing:</p>
          <ul className="mt-2 list-disc pl-5">
            {attention.map(({ c, i }) => (
              <li key={`${c}/${i.id}`}>
                <Link className="link font-bold" to={`/c/${c}/${i.id}`}>
                  {COLLECTIONS[c].titleOf(i)}
                </Link>{' '}
                ({COLLECTIONS[c].singular})
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <NextEvent events={data.events} onSaved={all.reload} />
        <QuickActions events={data.events} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Waiting />
        <Recent data={data} />
      </div>

      <section aria-labelledby="content-title">
        <h2 id="content-title" className="text-base">
          Your content
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {COLLECTION_ORDER.map((c) => (
            <li key={c}>
              <Link to={`/c/${c}`} className="grid grid-cols-1 gap-1 rounded-lg border border-border bg-card p-4 no-underline transition-colors hover:border-primary-accent">
                <Icon name={ICONS[c]} className="text-primary-accent" />
                <span className="font-display text-xl font-bold [font-stretch:82%]">{COLLECTIONS[c].label}</span>
                <span className="text-muted-foreground">
                  {data[c]?.length ?? 0} {data[c]?.length === 1 ? COLLECTIONS[c].singular : COLLECTIONS[c].label.toLowerCase()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {drafts.length > 0 && (
        <section aria-labelledby="drafts-title">
          <h2 id="drafts-title" className="text-base">
            Drafts
          </h2>
          <p className="mt-1 text-muted-foreground">Saved, but kept off the website.</p>
          <ul className="mt-3">
            {drafts.map(({ c, i }) => (
              <li key={`${c}/${i.id}`} className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border py-3">
                <Link className="link font-bold" to={`/c/${c}/${i.id}`}>
                  {COLLECTIONS[c].titleOf(i)}
                </Link>
                <span className="text-muted-foreground">{COLLECTIONS[c].singular}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function Dashboard() {
  return (
    <div className="grid grid-cols-1 gap-8">
      <PageHeading title="Dashboard" lead="Everything you can change on the website, in one place." />
      <Overview />
    </div>
  );
}
