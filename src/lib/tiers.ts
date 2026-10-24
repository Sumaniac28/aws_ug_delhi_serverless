import { SPONSOR_TIERS } from '../schema';

/** The label for each sponsor tier, shared by the event page and the partners page. */
export const TIER_LABELS: Record<(typeof SPONSOR_TIERS)[number], string> = {
  title: 'Title sponsor',
  gold: 'Gold',
  silver: 'Silver',
  community: 'Community partners',
  venue: 'Venue partner',
  partner: 'Partners',
};
