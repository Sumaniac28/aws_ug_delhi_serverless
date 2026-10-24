import type { EventView, SpeakerView } from './content';
import { site } from './content';

type Json = Record<string, unknown>;

const compact = <T extends Json>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as T;

export const orgId = (origin: URL) => new URL('/#organization', origin).href;

export function organizationGraph(origin: URL, logoUrl: string): Json {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      compact({
        '@type': 'Organization',
        '@id': orgId(origin),
        name: site.name,
        alternateName: site.shortName,
        url: origin.href,
        logo: logoUrl,
        email: site.contactEmail,
        sameAs: Object.values(site.sameAs),
      }),
      { '@type': 'WebSite', '@id': new URL('/#website', origin).href, url: origin.href, name: site.name, publisher: { '@id': orgId(origin) } },
    ],
  };
}

const ATTENDANCE = {
  offline: 'https://schema.org/OfflineEventAttendanceMode',
  online: 'https://schema.org/OnlineEventAttendanceMode',
  hybrid: 'https://schema.org/MixedEventAttendanceMode',
} as const;

const STATUS = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
  rescheduled: 'https://schema.org/EventRescheduled',
} as const;

const AVAILABILITY = {
  'not-open': 'https://schema.org/PreOrder',
  open: 'https://schema.org/InStock',
  closed: 'https://schema.org/SoldOut',
} as const;

/** Event markup per ADR-002. Join links are never included: online location points at the event page. */
export function eventJsonLd(ev: EventView, speakers: Map<string, SpeakerView>, origin: URL, images: string[] = []): Json {
  const { data } = ev;
  const pageUrl = new URL(ev.url, origin).href;
  const place = data.venue
    ? {
        '@type': 'Place',
        name: data.venue.name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: data.venue.streetAddress,
          addressLocality: data.venue.locality,
          addressRegion: data.venue.region,
          postalCode: data.venue.postalCode,
          addressCountry: 'IN',
        },
      }
    : undefined;
  const virtual = { '@type': 'VirtualLocation', url: pageUrl };
  const location = data.mode === 'online' ? virtual : data.mode === 'hybrid' ? [place, virtual] : place;

  const primary = data.registrationLinks.find((l) => l.primary) ?? data.registrationLinks[0];

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: data.title,
    description: data.summary,
    url: pageUrl,
    startDate: data.start,
    endDate: data.end,
    eventStatus: STATUS[data.status],
    eventAttendanceMode: ATTENDANCE[data.mode],
    location,
    image: images,
    organizer: { '@id': orgId(origin) },
    performer: data.speakers
      .map((id) => speakers.get(id))
      .filter((s): s is SpeakerView => !!s && s.published)
      .map((s) => compact({ '@type': 'Person', name: s.data.name })),
    offers: data.tickets.length
      ? data.tickets.map((t) =>
          compact({
            '@type': 'Offer',
            name: t.name,
            url: t.url ?? primary?.url,
            price: String(t.price),
            priceCurrency: 'INR',
            availability: t.soldOut ? 'https://schema.org/SoldOut' : AVAILABILITY[data.registration],
            validFrom: data.registrationValidFrom,
          }),
        )
      : primary
      ? compact({
          '@type': 'Offer',
          url: primary.url,
          price: '0',
          priceCurrency: 'INR',
          availability: AVAILABILITY[data.registration],
          validFrom: data.registrationValidFrom,
        })
      : undefined,
  });
}

export function blogPostingJsonLd(post: { title: string; description: string; pubDate: string; updatedDate?: string }, author: string, url: string, origin: URL, image?: string): Json {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.pubDate,
    dateModified: post.updatedDate ?? post.pubDate,
    image,
    author: { '@type': 'Person', name: author },
    publisher: { '@id': orgId(origin) },
    mainEntityOfPage: url,
  });
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}
