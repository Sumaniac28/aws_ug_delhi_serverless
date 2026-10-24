/**
 * Every date and time on the site is Indian Standard Time and stored with an explicit +05:30 offset
 * (the schema rejects anything else). Browsers' datetime-local inputs have no zone, so this converts
 * between the two without ever consulting the organizer's computer clock zone.
 */
export const IST_OFFSET = '+05:30';
const IST_MS = 5.5 * 60 * 60 * 1000;

/** "2026-11-14T16:00:00+05:30" (or any ISO with an offset) -> "2026-11-14T16:00", as shown in IST. */
export function toInput(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + IST_MS).toISOString().slice(0, 16);
}

/** "2026-11-14T16:00" typed as IST -> "2026-11-14T16:00:00+05:30". Empty in, empty out. */
export function fromInput(local: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00${IST_OFFSET}` : '';
}

const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

/** "14 Nov 2026, 4:00 PM" in IST regardless of where the browser is. */
export function formatIst(iso: string | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return fmt.format(new Date(iso)).replace(/\s?(am|pm)/i, (_, m: string) => ` ${m.toUpperCase()}`);
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** "21 SEP 2026" in IST, the way event cards print it. */
export function formatIstDay(iso: string | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return dayFmt.format(new Date(iso)).toUpperCase();
}

export type Phase = 'upcoming' | 'today' | 'past';

export function phaseOf(start: string | undefined, end: string | undefined, now = Date.now()): Phase | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  if (e < now) return 'past';
  return s <= now ? 'today' : 'upcoming';
}
