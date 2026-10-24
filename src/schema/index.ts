/**
 * Content schema (ADR-002, "Content model").
 *
 * Deliberately free of any Astro import so the same file can later be lifted into a
 * shared package and reused by the admin form and the save Lambda (Phase 4/5).
 * Cross-references (speaker slugs, sponsor slugs) are checked in src/lib/content.ts.
 */
import { z } from 'zod';

/** ISO 8601 with an explicit offset, e.g. 2026-11-14T10:00:00+05:30. Offset-less strings are rejected. */
export const istDateTime = z.iso.datetime({ offset: true });

/** Key of an image in the media bucket, e.g. "events/acd-2025/poster.jpg". */
export const mediaKey = z.string().min(1);

/** Required free text: present and not empty. */
const text = z.string().min(1);

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and hyphens only');

/**
 * Online join links must never be published. The model has no joinUrl field at all
 * (events are strict objects), and this guard catches them pasted into free text.
 */
const JOIN_LINK = /(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|chime\.aws)/i;

function noJoinLinks(value: unknown, ctx: z.RefinementCtx) {
  const hit = JSON.stringify(value).match(JOIN_LINK);
  if (hit) {
    ctx.addIssue({
      code: 'custom',
      message: `Online join links (${hit[1]}) must not be published; they go out in Konfhub emails only.`,
    });
  }
}

export const SERIES = ['meetup', 'workshop', 'online-session', 'community-day'] as const;
export const SIZES = ['small', 'mid', 'large'] as const;
export const MODES = ['offline', 'online', 'hybrid'] as const;
export const EVENT_STATUSES = ['scheduled', 'cancelled', 'postponed', 'rescheduled'] as const;
export const REGISTRATION_STATES = ['not-open', 'open', 'closed'] as const;
export const SPONSOR_TIERS = ['title', 'gold', 'silver', 'community', 'venue', 'partner'] as const;

const registrationLink = z
  .object({
    platform: z.enum(['konfhub', 'meetup', 'luma', 'other']),
    url: z.url(),
    label: z.string().optional(),
    primary: z.boolean().default(false),
  })
  .refine((l) => l.platform !== 'other' || !!l.label, { message: 'label is required when platform is "other"', path: ['label'] });

/**
 * A kind of ticket as shown on the event page. Tickets are still sold on Konfhub, Meetup or Luma; this only
 * describes them (price, perks) and whether they are sold out. Price is in rupees, 0 meaning free.
 */
const ticket = z.strictObject({
  name: text,
  price: z.number().min(0),
  perks: z.array(text).default([]),
  soldOut: z.boolean().default(false),
  /** "Most popular": at most one per event. */
  featured: z.boolean().default(false),
  /** Where to get this ticket; the event's main registration link is used when empty. */
  url: z.url().optional(),
  note: z.string().optional(),
});

const venue = z.object({
  name: text,
  streetAddress: text,
  locality: text,
  region: text,
  postalCode: text,
  mapUrl: z.url().optional(),
});

const agendaItem = z.object({
  start: istDateTime,
  end: istDateTime,
  title: text,
  track: z.string().optional(),
  speakers: z.array(slug).default([]),
});

export const eventSchema = z
  .strictObject({
    title: z.string().min(1),
    summary: z.string().max(160, 'summary becomes the meta description; keep it to 160 characters'),
    series: z.enum(SERIES),
    size: z.enum(SIZES),
    mode: z.enum(MODES),
    start: istDateTime,
    end: istDateTime,
    status: z.enum(EVENT_STATUSES).default('scheduled'),
    previousStart: istDateTime.optional(),
    venue: venue.optional(),
    poster: mediaKey.optional(),
    ogImage: mediaKey.optional(),
    registrationLinks: z.array(registrationLink).default([]),
    linkedinUrl: z.url().optional(),
    registration: z.enum(REGISTRATION_STATES).default('not-open'),
    tickets: z.array(ticket).default([]),
    registrationValidFrom: istDateTime.optional(),
    overview: z.string().min(1),
    speakers: z.array(slug).default([]),
    tracks: z.array(z.object({ name: text })).default([]),
    agenda: z.array(agendaItem).default([]),
    sponsors: z.array(z.object({ sponsor: slug, tier: z.enum(SPONSOR_TIERS) })).default([]),
    whatToBring: z.array(text).default([]),
    faqs: z.array(z.object({ q: text, a: text })).default([]),
    hosts: z.array(slug).default([]),
    largeExtras: z
      .object({
        cfpUrl: z.url().optional(),
        cfpCloses: istDateTime.optional(),
        sponsorshipPdf: z.url().optional(),
        directions: z.string().optional(),
      })
      .optional(),
    recap: z.string().optional(),
    gallery: z.array(z.object({ media: mediaKey, alt: z.string().min(1) })).default([]),
    albumUrl: z.url().optional(),
    feedbackHighlights: z
      .array(z.object({ quote: text, attribution: z.string().optional(), rating: z.number().min(1).max(5).optional(), featured: z.boolean().optional() }))
      .default([]),
    /** Numbers from the feedback form, shown above the quotes. All optional. */
    feedbackSummary: z
      .object({ responses: z.number().int().min(0).optional(), averageRating: z.number().min(1).max(5).optional(), recommendPercent: z.number().min(0).max(100).optional() })
      .optional(),
    resources: z
      .array(z.object({ talk: text, slidesUrl: z.url().optional(), repoUrl: z.url().optional() }))
      .default([]),
    posts: z
      .array(z.object({ kind: z.enum(['blog', 'linkedin', 'instagram', 'writeup']), url: z.url(), title: text }))
      .default([]),
    stats: z.object({ attendees: z.number().optional(), sessions: z.number().optional(), speakers: z.number().optional() }).optional(),
    draft: z.boolean().default(false),
  })
  .superRefine((e, ctx) => {
    noJoinLinks(e, ctx);
    if (Date.parse(e.end) <= Date.parse(e.start)) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must be after start' });
    }
    if (e.mode !== 'online' && !e.venue) {
      ctx.addIssue({ code: 'custom', path: ['venue'], message: 'venue is required unless the event is online-only' });
    }
    if (e.status === 'rescheduled' && !e.previousStart) {
      ctx.addIssue({ code: 'custom', path: ['previousStart'], message: 'previousStart is required when status is "rescheduled"' });
    }
    const primaries = e.registrationLinks.filter((l) => l.primary).length;
    if (e.registration === 'open' && primaries !== 1) {
      ctx.addIssue({ code: 'custom', path: ['registrationLinks'], message: 'exactly one link must be primary while registration is open' });
    }
    const names = e.tickets.map((t) => t.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', path: ['tickets'], message: 'two ticket types have the same name' });
    }
    if (e.tickets.filter((t) => t.featured).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['tickets'], message: 'only one ticket can be marked most popular' });
    }
    if (e.size !== 'large' && e.largeExtras) {
      ctx.addIssue({ code: 'custom', path: ['largeExtras'], message: 'largeExtras only applies to size "large"' });
    }
  });

export const speakerSchema = z
  .strictObject({
    name: z.string().min(1),
    photo: mediaKey.optional(),
    bio: z.string().optional(),
    linkedin: z.url().optional(),
    github: z.url().optional(),
    website: z.url().optional(),
    /** Photo and bio are omitted from the build unless consent.publish is true. */
    consent: z.object({
      publish: z.boolean(),
      date: z.iso.date().optional(),
      source: z.string().optional(),
    }),
  })
  .superRefine(noJoinLinks);

export const sponsorSchema = z.strictObject({
  name: z.string().min(1),
  logo: mediaKey.optional(),
  url: z.url(),
  blurb: z.string().optional(),
  defaultTier: z.enum(SPONSOR_TIERS),
});

export const organizerSchema = z.strictObject({
  name: z.string().min(1),
  role: z.string(),
  photo: mediaKey.optional(),
  linkedin: z.url().optional(),
  active: z.boolean().default(true),
});

export const postSchema = z
  .strictObject({
    title: z.string().min(1),
    description: z.string().max(160, 'description becomes the meta description; keep it to 160 characters'),
    pubDate: istDateTime,
    updatedDate: istDateTime.optional(),
    author: slug,
    heroImage: mediaKey.optional(),
    tags: z.array(z.string()).default([]),
    relatedEvent: slug.optional(),
    body: z.string().min(1),
    draft: z.boolean().default(false),
  })
  .superRefine(noJoinLinks);

/** Single-document pages (About, Code of Conduct, Privacy). Body is the Markdown file itself. */
export const pageSchema = z.object({
  title: z.string(),
  description: z.string().max(160, 'description becomes the meta description; keep it to 160 characters'),
  showTeam: z.boolean().default(false),
  /** Shown as "Last updated" on legal pages. */
  updated: z.iso.date().optional(),
});

export const siteSchema = z.strictObject({
  name: z.string(),
  shortName: z.string(),
  tagline: z.string(),
  description: z.string().max(160, 'description is the default meta description; keep it to 160 characters'),
  contactEmail: z.email(),
  region: z.string(),
  /** Codes from Google Search Console and Bing Webmaster Tools (HTML-tag method). Optional. */
  verification: z.strictObject({ google: z.string().optional(), bing: z.string().optional() }).optional(),
  sameAs: z.object({
    meetup: z.url().optional(),
    linkedin: z.url().optional(),
    instagram: z.url().optional(),
    youtube: z.url().optional(),
    konfhub: z.url().optional(),
  }),
});

export type EventData = z.infer<typeof eventSchema>;
export type SpeakerData = z.infer<typeof speakerSchema>;
export type SponsorData = z.infer<typeof sponsorSchema>;
export type OrganizerData = z.infer<typeof organizerSchema>;
export type PostData = z.infer<typeof postSchema>;
export type SiteData = z.infer<typeof siteSchema>;
