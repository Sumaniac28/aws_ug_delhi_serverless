import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { eventSchema, organizerSchema, pageSchema, postSchema, speakerSchema, sponsorSchema } from './schema';

const json = (name: string) => glob({ pattern: '**/*.json', base: `./src/content/${name}` });

export const collections = {
  events: defineCollection({ loader: json('events'), schema: eventSchema }),
  speakers: defineCollection({ loader: json('speakers'), schema: speakerSchema }),
  sponsors: defineCollection({ loader: json('sponsors'), schema: sponsorSchema }),
  organizers: defineCollection({ loader: json('organizers'), schema: organizerSchema }),
  posts: defineCollection({ loader: json('posts'), schema: postSchema }),
  pages: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/pages' }), schema: pageSchema }),
};
