import type { APIRoute } from 'astro';
import { getEvents } from '../../../../lib/content';
import { buildIcs } from '../../../../lib/ics';

export async function getStaticPaths() {
  const events = await getEvents();
  return events.map((event) => ({ params: { year: event.year, slug: event.id }, props: { event } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const event = props.event;
  const body = buildIcs(event, new URL(event.url, site).href);
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
