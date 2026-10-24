import { publish, publishStatus } from '../handlers/publish.ts';
import type { ApiEvent } from '../lib/http.ts';
import { route } from '../lib/route.ts';

// One function serves both routes ("GET /publish" reports status, "POST /publish" starts a build).
const start = route(publish);
const status = route(publishStatus);

export const handler = (event: ApiEvent) => (event.routeKey?.startsWith('GET ') ? status(event) : start(event));
