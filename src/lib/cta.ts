import type { EventView } from './content';

export type Cta =
  | { kind: 'register'; label: string; href: string }
  | { kind: 'recap'; label: string; href: string }
  | { kind: 'none'; label: string };

const PLATFORM: Record<string, string> = { konfhub: 'Konfhub', meetup: 'Meetup', luma: 'Luma' };

/** The single primary action for an event: register, see the recap, or an explanation of why neither. */
export function eventCta(event: EventView): Cta {
  const { data, phase } = event;
  const primary = data.registrationLinks.find((l) => l.primary);

  if (data.status === 'cancelled') return { kind: 'none', label: 'This event has been cancelled' };

  if (phase === 'past') {
    if (data.recap) return { kind: 'recap', label: 'See the recap and photos', href: `${event.url}#recap` };
    if (data.gallery.length) return { kind: 'recap', label: 'See the photos', href: `${event.url}#gallery` };
    return { kind: 'none', label: 'This event has ended. Recap coming soon' };
  }

  if (data.registration === 'open' && primary) {
    const where = primary.platform === 'other' ? (primary.label ?? 'link') : PLATFORM[primary.platform];
    return { kind: 'register', label: `Register on ${where}`, href: primary.url };
  }
  if (data.registration === 'closed') return { kind: 'none', label: 'Registration closed' };
  return { kind: 'none', label: 'Registration opens soon' };
}

export const SERIES_LABEL: Record<string, string> = {
  meetup: 'Meetup',
  workshop: 'Workshop',
  'online-session': 'Online session',
  'community-day': 'Community Day',
};
export const SIZE_LABEL: Record<string, string> = { small: 'Small', mid: 'Mid-size', large: 'Large' };
export const MODE_LABEL: Record<string, string> = { offline: 'In person', online: 'Online', hybrid: 'Hybrid' };

export function placeOf(event: EventView) {
  const { data } = event;
  if (data.mode === 'online') return 'Online';
  return `${data.venue?.locality}${data.mode === 'hybrid' ? ' and online' : ''}`;
}
