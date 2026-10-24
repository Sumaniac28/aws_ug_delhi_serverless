import type { APIRoute } from 'astro';
import { renderLogo } from '../lib/og';

export const GET: APIRoute = async () => new Response(new Uint8Array(await renderLogo(180)), { headers: { 'Content-Type': 'image/png' } });
