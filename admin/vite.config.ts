import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The admin shares the site's content schema (../src/schema) and design tokens (../src/styles), so Vite
// must be allowed to read one level up.
// In `vite` dev only: answers /config.json so the admin talks to the local mock API with no sign-in.
// A deployment gets its real config.json from the CDK Admin App stack instead (it is not in public/).
const devConfig = {
  name: 'dev-config',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: (path: string, fn: (req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => void) => void } }) {
    server.middlewares.use('/config.json', (_req, res) => {
      const api = process.env.ADMIN_DEV_API ?? 'http://localhost:8787';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ apiUrl: api, siteUrl: process.env.ADMIN_DEV_SITE ?? api, devAuth: true }));
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), devConfig],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 700 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
  },
});
