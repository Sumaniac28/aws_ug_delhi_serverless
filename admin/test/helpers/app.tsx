import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { App, routes } from '../../src/App.tsx';
import { ApiClient } from '../../src/lib/api.ts';
import { DevAuth, type Auth } from '../../src/lib/auth.ts';
import { startMockServer } from '../../dev/mock-server.ts';

export interface Harness {
  server: Awaited<ReturnType<typeof startMockServer>>;
  api: ApiClient;
  /** A second, independent client: stands in for another organizer working at the same time. */
  other: ApiClient;
  router: ReturnType<typeof createMemoryRouter>;
  user: ReturnType<typeof userEvent.setup>;
  uploads: FormData[];
  close: () => Promise<void>;
}

/**
 * Renders the real admin app against the mock API (the real Phase 4 handlers over an in-memory S3).
 * Photo uploads are intercepted here because jsdom's FormData cannot be sent by Node's fetch; the signed
 * fields and file are recorded in `uploads` instead.
 */
export async function renderApp(path: string, opts: { seed?: boolean; auth?: Auth; before?: (ctx: { api: ApiClient; server: Harness['server'] }) => Promise<void>; failScheduling?: boolean } = {}): Promise<Harness> {
  const server = await startMockServer({ port: 0, seed: opts.seed ?? true, quiet: true, buildMs: 300, processMs: 0, failScheduling: opts.failScheduling });
  const uploads: FormData[] = [];
  const fetchWithUploads: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/__upload')) {
      uploads.push(init!.body as FormData);
      return new Response(null, { status: 204 });
    }
    return fetch(input, init);
  };
  const api = new ApiClient({ baseUrl: server.url, token: async () => 'dev-token', fetch: fetchWithUploads });
  const other = new ApiClient({ baseUrl: server.url, token: async () => 'dev-token' });
  await opts.before?.({ api: other, server });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const config = { apiUrl: server.url, siteUrl: server.url, devAuth: true };

  render(<App config={config} auth={opts.auth ?? new DevAuth()} api={api} router={router} publishPollMs={{ running: 100, idle: 60_000 }} />);
  return { server, api, other, router, user: userEvent.setup({ applyAccept: false }), uploads, close: () => server.close() };
}

/** A minimal valid online event, for tests that need one to exist already. */
export const onlineEvent = (over: Record<string, unknown> = {}) => ({
  title: 'Test session',
  summary: 'A test session.',
  series: 'online-session',
  size: 'small',
  mode: 'online',
  start: '2037-03-01T19:00:00+05:30',
  end: '2037-03-01T20:00:00+05:30',
  overview: 'Overview text.',
  ...over,
});
