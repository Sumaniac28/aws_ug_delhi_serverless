import type { APIRoute } from 'astro';
import { renderLogo } from '../lib/og';

// Organization logo for search results (Google asks for at least 112x112 and a raster image).
export const GET: APIRoute = async () => new Response(new Uint8Array(await renderLogo(512)), { headers: { 'Content-Type': 'image/png' } });
