import type { APIRoute, GetStaticPaths } from 'astro';
import { getEvents, getPosts, getSpeakerAppearances, getSpeakers, site, speakerLine } from '../../lib/content';
import { MODE_LABEL, SERIES_LABEL, placeOf } from '../../lib/cta';
import { CARD_SIZES, renderCard, type CardInput, type CardSize } from '../../lib/og';
import { formatDateLong, formatTimeRange } from '../../lib/time';

// A type alias (not an interface) so it is assignable to Astro's loosely-typed route props.
type Props = Omit<CardInput, 'width' | 'height'> & { size: CardSize };

/**
 * Every social-card image, written to /og/<kind>/<id>/<size>.png at build time:
 *   og/default/og.png            the site
 *   og/events/<id>/{og,16x9,4x3,1x1}.png   one set per published event (the three ratios Google's Event guidance asks for)
 *   og/posts/<id>/og.png         blog posts
 *   og/speakers/<id>/og.png      speakers who agreed to be published
 */
export const getStaticPaths = (async () => {
  const out: { params: { path: string }; props: Props }[] = [];
  const add = (path: string, size: CardSize, card: Omit<Props, 'size'>) => out.push({ params: { path }, props: { ...card, size } });

  add('default/og', 'og', { title: site.name, eyebrow: site.region, meta: ['Meetups, workshops and Community Day'] });

  for (const e of await getEvents()) {
    const card = {
      title: e.data.title,
      eyebrow: `${SERIES_LABEL[e.data.series]}, ${MODE_LABEL[e.data.mode].toLowerCase()}`,
      meta: [`${formatDateLong(e.data.start)}`, `${formatTimeRange(e.data.start, e.data.end)}  |  ${placeOf(e)}`],
    };
    for (const size of Object.keys(CARD_SIZES) as CardSize[]) add(`events/${e.id}/${size}`, size, card);
  }

  for (const p of await getPosts()) add(`posts/${p.id}/og`, 'og', { title: p.data.title, eyebrow: 'Blog', meta: [p.data.description] });

  const appearances = await getSpeakerAppearances();
  for (const s of (await getSpeakers()).values()) {
    if (!s.published) continue;
    add(`speakers/${s.id}/og`, 'og', { title: s.data.name, eyebrow: 'Speaker', meta: [speakerLine(appearances.get(s.id))] });
  }
  return out;
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = async ({ props }) => {
  const { size, ...card } = props;
  const png = await renderCard({ ...card, ...CARD_SIZES[size] });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
