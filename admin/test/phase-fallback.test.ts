// Tests the PUBLIC SITE's client-side safety net (src/lib/phase-fallback.ts). It lives here because this
// project already has a DOM test environment; the site itself has no test runner.
import { describe, expect, it } from 'vitest';
import { applyPhaseFallback } from '../../src/lib/phase-fallback.ts';

const NOW = Date.parse('2026-11-14T20:00:00+05:30'); // 30 minutes after the first event ends

const page = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

const metroItem = (end: string, state: string, status: string, label: string) => `
  <li class="metro-item" data-state="${state}" data-end="${end}">
    <h3><a href="/e/">Event</a></h3>
    <div data-status="${status}" class="badge-success">${label}</div>
  </li>`;

describe('applyPhaseFallback', () => {
  it('turns an event that ended but is still shown as upcoming into a past one', () => {
    const root = page(`<ol>${metroItem('2026-11-14T19:30:00+05:30', 'upcoming', 'upcoming', 'Upcoming')}</ol>`);
    expect(applyPhaseFallback(root, NOW)).toBe(1);
    const li = root.querySelector('li')!;
    expect(li.dataset.state).toBe('past');
    const badge = root.querySelector('[data-status]') as HTMLElement;
    expect(badge.textContent).toBe('Past');
    expect(badge.dataset.status).toBe('past');
    expect(badge.className).not.toContain('badge-success');
  });

  it('also redraws the "next stop" interchange as travelled', () => {
    const root = page(`<ol>${metroItem('2026-11-14T19:30:00+05:30', 'next', 'upcoming', 'Upcoming')}</ol>`);
    applyPhaseFallback(root, NOW);
    expect(root.querySelector('li')!.dataset.state).toBe('past');
  });

  it('leaves events that have not ended alone, including one in progress', () => {
    const root = page(`<ol>${metroItem('2026-11-14T21:00:00+05:30', 'upcoming', 'today', 'Today')}${metroItem('2026-12-05T20:30:00+05:30', 'upcoming', 'upcoming', 'Upcoming')}</ol>`);
    expect(applyPhaseFallback(root, NOW)).toBe(0);
    expect([...root.querySelectorAll('[data-status]')].map((b) => (b as HTMLElement).dataset.status)).toEqual(['today', 'upcoming']);
  });

  it('replaces the register button with a plain note once the event is over', () => {
    const root = page(`<section data-end="2026-11-14T19:30:00+05:30"><a data-cta="register" href="https://konfhub.com/">Register on Konfhub</a></section>`);
    applyPhaseFallback(root, NOW);
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('span')!.textContent).toBe('This event has ended. Recap coming soon');
  });

  it('keeps a cancelled or postponed event\'s own badge', () => {
    const root = page(`<ol>${metroItem('2026-11-14T19:30:00+05:30', 'upcoming', 'cancelled', 'Cancelled')}${metroItem('2026-11-14T19:30:00+05:30', 'upcoming', 'postponed', 'Postponed')}</ol>`);
    applyPhaseFallback(root, NOW);
    expect([...root.querySelectorAll('[data-status]')].map((b) => b.textContent)).toEqual(['Cancelled', 'Postponed']);
  });

  it('is safe to run more than once, and on pages with no events', () => {
    const root = page(`<ol>${metroItem('2026-11-14T19:30:00+05:30', 'upcoming', 'upcoming', 'Upcoming')}</ol>`);
    expect(applyPhaseFallback(root, NOW)).toBe(1);
    expect(applyPhaseFallback(root, NOW)).toBe(0);
    expect(applyPhaseFallback(page('<p>No events</p>'), NOW)).toBe(0);
  });

  it('ignores a missing or malformed end time instead of guessing', () => {
    const root = page(`<ol>${metroItem('not-a-date', 'upcoming', 'upcoming', 'Upcoming')}<li data-state="upcoming"></li></ol>`);
    expect(applyPhaseFallback(root, NOW)).toBe(0);
  });

  it('judges by the instant, not the reader\'s time zone: 19:30 IST is 14:00 UTC', () => {
    const end = '2026-11-14T19:30:00+05:30';
    const root = () => page(`<ol>${metroItem(end, 'upcoming', 'upcoming', 'Upcoming')}</ol>`);
    expect(applyPhaseFallback(root(), Date.parse('2026-11-14T13:59:00Z'))).toBe(0); // 19:29 IST: not over
    expect(applyPhaseFallback(root(), Date.parse('2026-11-14T14:01:00Z'))).toBe(1); // 19:31 IST: over
  });
});
