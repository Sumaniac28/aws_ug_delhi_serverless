/**
 * The "Next stop in 3d 04:12:09" board. Event times are absolute instants with an explicit offset (+05:30),
 * so the arithmetic is right in every time zone; only the display is IST.
 */
export type CountdownState =
  | { kind: 'before'; days: number; hours: number; minutes: number; seconds: number }
  | { kind: 'live' }
  | { kind: 'ended' };

export function countdownState(startIso: string, endIso: string, now: number = Date.now()): CountdownState {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) return { kind: 'ended' };
  if (now >= end) return { kind: 'ended' };
  if (now >= start) return { kind: 'live' };
  const total = Math.floor((start - now) / 1000);
  return {
    kind: 'before',
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** "3d 04:12:09", or "04:12:09" on the day itself. */
export function formatCountdown(s: Extract<CountdownState, { kind: 'before' }>): string {
  const clock = `${pad2(s.hours)}:${pad2(s.minutes)}:${pad2(s.seconds)}`;
  return s.days > 0 ? `${s.days}d ${clock}` : clock;
}
