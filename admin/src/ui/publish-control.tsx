import { useState } from 'react';
import { COLLECTIONS } from '../lib/collections.ts';
import { formatIst } from '../lib/ist.ts';
import { timeAgo } from '../lib/time.ts';
import { useApp } from '../state/app.tsx';
import { usePublish } from '../state/publish.tsx';
import { Icon, type IconName } from './icons.tsx';
import { Button, ConfirmDialog } from './primitives.tsx';

/** What the organizer should read first: where the website stands compared with what they saved. */
function headline(p: ReturnType<typeof usePublish>): { icon: IconName; text: string; tone: 'ok' | 'wait' | 'busy' | 'bad' } {
  if (p.notConfigured) return { icon: 'info-circle', text: 'Publishing is not set up yet.', tone: 'wait' };
  if (!p.status) return { icon: 'clock', text: 'Checking the website…', tone: 'wait' };
  if (p.running) {
    const phase = p.status.latest?.phase?.toLowerCase().replace(/_/g, ' ');
    return { icon: 'rocket', text: `Going live${phase ? ` (${phase})` : ''}…`, tone: 'busy' };
  }
  if (p.lastFailed) return { icon: 'alert-triangle', text: 'The last publish did not finish.', tone: 'bad' };
  if (p.pendingCount > 0) return { icon: 'clock', text: `${p.pendingCount} ${p.pendingCount === 1 ? 'change is' : 'changes are'} waiting to go live`, tone: 'wait' };
  return { icon: 'circle-check', text: 'Everything is live', tone: 'ok' };
}

function buttonLabel(p: ReturnType<typeof usePublish>): string {
  if (!p.status && !p.notConfigured) return 'Checking…';
  if (p.starting) return 'Starting…';
  if (p.running) return 'Publishing…';
  if (p.pendingCount > 0) return `Publish ${p.pendingCount === 1 ? '1 change' : `${p.pendingCount} changes`}`;
  if (p.lastFailed) return 'Try publishing again';
  return 'Nothing to publish';
}

const verb = (kind: 'saved' | 'deleted') => (kind === 'saved' ? 'saved' : 'deleted');

/**
 * The one Publish button, on every page. It only works when something is waiting (or the last try failed), so a
 * click always does something, and it asks first by listing exactly what is about to go on the website.
 */
export function PublishControl() {
  const p = usePublish();
  const { config } = useApp();
  const [confirming, setConfirming] = useState(false);
  const h = headline(p);
  const items = p.status?.pending.items ?? [];
  const more = (p.status?.pending.count ?? 0) - items.length;
  const lastLive = p.status?.lastSuccess?.endedAt;

  return (
    <section aria-labelledby="publish-heading" className="grid grid-cols-1 gap-2.5 rounded-lg border border-border bg-card p-3">
      <h2 id="publish-heading" className="visually-hidden">
        Publish to the website
      </h2>
      <p role="status" className="flex items-start gap-2 text-[0.8125rem] leading-snug font-semibold">
        <Icon name={h.icon} size={16} className={`mt-px ${h.tone === 'ok' ? 'text-muted-foreground' : 'text-primary-accent'}`} />
        <span>{h.text}</span>
      </p>
      <Button variant="primary" className="w-full" disabled={!p.canPublish} onClick={() => setConfirming(true)}>
        <Icon name="rocket" size={16} />
        {buttonLabel(p)}
      </Button>
      <p className="text-xs leading-snug text-muted-foreground">
        {lastLive ? <>Last published {formatIst(lastLive)} IST. </> : p.status ? <>Nothing has been published from here yet. </> : null}
        <a href={config.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4">
          View the website
          <Icon name="external-link" size={14} />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
      {p.error && !p.notConfigured && <p className="text-xs font-semibold text-error">{p.error.message}</p>}

      <ConfirmDialog
        open={confirming}
        title="Publish to the website?"
        confirmLabel="Publish now"
        confirmVariant="primary"
        busy={p.starting}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void p.publish();
        }}
      >
        {items.length > 0 ? (
          <>
            <p>These changes will appear on the website in about two minutes:</p>
            <ul className="mt-3 grid max-h-64 gap-2 overflow-y-auto">
              {items.map((c) => (
                <li key={`${c.collection}/${c.id}`} className="rounded-md border border-border px-3 py-2">
                  <span className="text-[0.8125rem] text-muted-foreground">{COLLECTIONS[c.collection].singular[0]!.toUpperCase() + COLLECTIONS[c.collection].singular.slice(1)}</span>
                  <br />
                  <strong>{c.label ?? c.id}</strong>
                  <span className="text-muted-foreground">
                    {' '}
                    {verb(c.kind)}
                    {c.editor ? ` by ${c.editor}` : ''}, {timeAgo(c.at)}
                  </span>
                </li>
              ))}
            </ul>
            {more > 0 && <p className="mt-2 text-muted-foreground">…and {more} more.</p>}
          </>
        ) : (
          <p>The last publish did not finish, so the website may be behind. Publishing again tries once more. Nothing you saved is lost.</p>
        )}
      </ConfirmDialog>
    </section>
  );
}
