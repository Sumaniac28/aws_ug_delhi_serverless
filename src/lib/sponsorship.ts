import { z } from 'zod';
import raw from '../data/sponsorship.json';

// Community Day sponsorship packages. Validated at build time so a typo in src/data/sponsorship.json fails the
// build instead of publishing a broken page.
const schema = z.strictObject({
  _about: z.string().optional(),
  edition: z.string(),
  deck: z.string().startsWith('/'),
  packages: z.array(
    z.strictObject({
      name: z.string().min(1),
      price: z.string().min(1),
      popular: z.boolean(),
      perks: z.array(z.strictObject({ label: z.string().min(1), value: z.string().min(1) })).min(1),
    }),
  ),
  notes: z.string().optional(),
});

export const sponsorship = schema.parse(raw);
