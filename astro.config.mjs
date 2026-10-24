import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// The production domain is still undecided (trademark query pending, see ADR-002).
// Set SITE_URL at build time; the fallback only keeps canonical URLs well-formed.
const site = process.env.SITE_URL ?? 'https://awsug-delhi-ncr.example';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  // 'never' keeps all CSS in external files, so a strict CSP can use style-src 'self'.
  build: { format: 'directory', inlineStylesheets: 'never' },
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Keep JS external (never inlined into HTML) so a strict CSP can use script-src 'self'.
      assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
    },
  },
});
