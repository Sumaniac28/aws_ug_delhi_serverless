import { Link } from 'react-router';
import type { ListItem } from '../lib/api.ts';
import { COLLECTION_ORDER, COLLECTIONS } from '../lib/collections.ts';
import { formatIst } from '../lib/ist.ts';
import { useApi } from '../state/app.tsx';
import { useAsync, usePublish } from '../state/hooks.ts';
import { Alert, Button, ButtonLink, PageHeading, Spinner } from '../ui/primitives.tsx';
import { useToast } from '../ui/toast.tsx';
import { useEffect } from 'react';

function PublishPanel() {
  const { latest, running, busy, error, note, publish, notConfigured } = usePublish();
  const toast = useToast();
  useEffect(() => {
    if (note) toast(note);
  }, [note, toast]);

  const status = latest?.buildStatus;
  return (
    <section aria-labelledby="publish-title" className="grid gap-4 rounded-md border border-border bg-card p-6">
      <h2 id="publish-title" className="text-3xl">
        Publish to the website
      </h2>
      <p className="max-w-2xl text-muted-foreground">Saving an item does not change the public website. When you have finished your edits, publish. It takes a few minutes. Events move from Upcoming to Past on their own, shortly after they end.</p>

      {notConfigured && <Alert tone="info">Publishing is not set up yet. Your saved changes are safe; this button starts working once the build is connected.</Alert>}
      {error && !notConfigured && <Alert tone="error">{error.message}</Alert>}
      {status === 'FAILED' && <Alert tone="error" title="The last publish failed.">The site was not changed. Try again, and tell the tech volunteer if it keeps failing.</Alert>}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={() => void publish()} disabled={busy || running || notConfigured}>
          {running ? 'Publishing…' : busy ? 'Starting…' : 'Publish changes'}
        </Button>
        <p role="status" className="text-muted-foreground">
          {running && `In progress${latest?.phase ? ` (${latest.phase.toLowerCase().replace(/_/g, ' ')})` : ''}.`}
          {!running && status === 'SUCCEEDED' && `Last published ${formatIst(latest?.endedAt)} IST.`}
          {!running && !status && !notConfigured && !error && latest === null && 'Nothing has been published from here yet.'}
        </p>
      </div>
    </section>
  );
}

function Overview() {
  const api = useApi();
  const all = useAsync(async () => {
    const entries = await Promise.all(COLLECTION_ORDER.map(async (c) => [c, await api.list(c)] as const));
    return Object.fromEntries(entries) as Record<string, ListItem[]>;
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

      <section aria-labelledby="content-title">
        <h2 id="content-title" className="text-3xl">
          Your content
        </h2>
        <ul className="mt-4">
          {COLLECTION_ORDER.map((c) => (
            <li key={c} className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border py-4">
              <Link to={`/c/${c}`} className="font-display text-2xl font-bold [font-stretch:82%] no-underline hover:underline">
                {COLLECTIONS[c].label}
              </Link>
              <span className="text-muted-foreground">
                {data[c]?.length ?? 0} {data[c]?.length === 1 ? COLLECTIONS[c].singular : COLLECTIONS[c].label.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {drafts.length > 0 && (
        <section aria-labelledby="drafts-title">
          <h2 id="drafts-title" className="text-3xl">
            Drafts
          </h2>
          <p className="mt-1 text-muted-foreground">Saved, but kept off the website.</p>
          <ul className="mt-4">
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
    <div className="grid gap-10">
      <PageHeading title="Dashboard" lead="Everything you can change on the website, in one place." />
      <PublishPanel />
      <Overview />
      <p>
        <ButtonLink to="/c/events/new" variant="outline">
          New event
        </ButtonLink>
      </p>
    </div>
  );
}
