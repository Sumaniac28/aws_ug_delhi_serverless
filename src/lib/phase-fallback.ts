/**
 * Safety net for "Upcoming to Past" (ADR-002 decision 8, layer 3).
 *
 * The site is static: an event moves to Past when a build runs after it ends. A build is started just after each
 * event ends and again every night, but if one is late, a visitor could still see an event that finished hours ago
 * offering a "Register" button. This runs in the browser and corrects exactly that, using each event's own end
 * time (an absolute instant, so it is right in every time zone). The server-rendered HTML is unchanged, so
 * search engines and no-JavaScript visitors see the real build, which fixes itself at the next build.
 */

// Same appearance the build gives these elements, so the page does not change style, only state.
const PAST_BADGE = 'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap border border-border text-foreground px-2.5 py-0.5 text-xs';
const ENDED_NOTE = 'inline-flex h-11 items-center rounded-md border border-border bg-muted px-5 font-bold text-muted-foreground';

/** Marks every ended-but-still-"upcoming" event on the page as past. Returns how many it changed. */
export function applyPhaseFallback(root: ParentNode = document, now: number = Date.now()): number {
  let changed = 0;
  root.querySelectorAll<HTMLElement>('[data-end]').forEach((el) => {
    const end = Date.parse(el.dataset.end ?? '');
    if (Number.isNaN(end) || end >= now || el.dataset.ended !== undefined) return;
    el.dataset.ended = '';
    changed++;

    // Metro list items: draw the stop as travelled.
    if (el.dataset.state === 'upcoming' || el.dataset.state === 'next') el.dataset.state = 'past';

    // "Upcoming" / "Today" badges become "Past". Cancelled and postponed events keep their own badge.
    el.querySelectorAll<HTMLElement>('[data-status]').forEach((badge) => {
      if (badge.dataset.status === 'upcoming' || badge.dataset.status === 'today') {
        badge.textContent = 'Past';
        badge.dataset.status = 'past';
        badge.className = PAST_BADGE;
      }
    });

    // The register button no longer makes sense.
    el.querySelectorAll<HTMLElement>('[data-cta="register"]').forEach((cta) => {
      const note = el.ownerDocument.createElement('span');
      note.className = ENDED_NOTE;
      note.textContent = 'This event has ended. Recap coming soon';
      cta.replaceWith(note);
    });
  });

  // Anything that only makes sense before the event (the ticket cards) is hidden once it has ended.
  root.querySelectorAll<HTMLElement>('[data-hide-after]').forEach((el) => {
    const end = Date.parse(el.dataset.hideAfter ?? '');
    if (Number.isNaN(end) || end >= now || el.hidden) return;
    el.hidden = true;
    changed++;
  });
  return changed;
}
