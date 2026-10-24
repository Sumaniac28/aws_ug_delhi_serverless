import { sign } from '../handlers/uploads.ts';
import { route } from '../lib/route.ts';

export const handler = route(sign);
