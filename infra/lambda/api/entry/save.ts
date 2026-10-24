import { save } from '../handlers/content.ts';
import { route } from '../lib/route.ts';

export const handler = route(save);
