import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getOrganizers, getPosts, site } from '../lib/content';

/** Blog feed. Dates are absolute instants, so readers in any time zone see the right day. */
export async function GET(context: APIContext) {
  const [posts, organizers] = await Promise.all([getPosts(), getOrganizers()]);
  return rss({
    title: `${site.name}: blog`,
    description: 'Recaps, lessons learned and tips from the organizing team.',
    site: context.site!,
    trailingSlash: true,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: new Date(p.data.pubDate),
      link: `/blog/${p.id}/`,
      author: organizers.find((o) => o.id === p.data.author)?.data.name,
      categories: p.data.tags,
    })),
    customData: '<language>en-in</language>',
  });
}
