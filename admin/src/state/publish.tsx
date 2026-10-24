import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, type BuildSummary, type PublishStatus } from '../lib/api.ts';
import { useToast } from '../ui/toast.tsx';
import { useApp } from './app.tsx';

const RUNNING = new Set(['IN_PROGRESS']);
const BROKEN = new Set(['FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT']);

/** How long a build we just started is trusted before the server's own list has to show it. */
const JUST_STARTED_MS = 20_000;

export interface PublishValue {
  /** Undefined until the first answer arrives. */
  status: PublishStatus | undefined;
  /** A build is running right now, started by anyone or anything. */
  running: boolean;
  /** Our own Publish request is on its way. */
  starting: boolean;
  error: ApiError | undefined;
  /** The build project does not exist yet (the Build stack is not deployed). */
  notConfigured: boolean;
  /** Saved or deleted changes that are not on the website yet. */
  pendingCount: number;
  /** The most recent build failed or was stopped, so the website may be behind what was saved. */
  lastFailed: boolean;
  /** Pressing Publish would change the website (or retry a failed build). The server enforces the same rule. */
  canPublish: boolean;
  publish: () => Promise<void>;
  /** Ask again now, for example right after a save or a delete. */
  refresh: () => Promise<void>;
}

const PublishContext = createContext<PublishValue | null>(null);

/**
 * One shared view of "what is waiting to go live and is a build running", for the whole signed-in app, so the
 * Publish control in the sidebar is right on every page. It re-checks every minute, every five seconds while a
 * build runs, whenever the tab is shown again, and after every save or delete (see ItemEditor).
 */
export function PublishProvider({ children, pollMs = { running: 5_000, idle: 60_000 } }: { children: ReactNode; pollMs?: { running: number; idle: number } }) {
  const { api, endSession } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<PublishStatus | undefined>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  // A build we started is shown as running at once, even if the server's list has not caught up yet.
  const justStarted = useRef<{ build: BuildSummary; until: number } | null>(null);
  const wasRunning = useRef(false);

  const fail = useCallback(
    (e: any) => {
      if (e?.name === 'AuthError') return endSession();
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e?.message ?? e)));
    },
    [endSession],
  );

  const refresh = useCallback(async () => {
    try {
      let next = await api.publishStatus();
      const mine = justStarted.current;
      if (mine && Date.now() < mine.until && next.latest?.buildId !== mine.build.buildId && !RUNNING.has(next.latest?.buildStatus ?? '')) {
        next = { ...next, latest: mine.build };
      } else if (mine && next.latest?.buildId === mine.build.buildId) {
        justStarted.current = null;
      }
      setStatus(next);
      setError(undefined);
    } catch (e) {
      fail(e);
    }
  }, [api, fail]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = RUNNING.has(status?.latest?.buildStatus ?? '');

  // Tell the organizer how it ended, once, when a build we saw running stops.
  useEffect(() => {
    if (wasRunning.current && !running && status) {
      const state = status.latest?.buildStatus;
      if (state === 'SUCCEEDED') toast('Your changes are live on the website.');
      else if (state && BROKEN.has(state)) toast('The website was not updated. Nothing was lost. Try Publish again.');
    }
    wasRunning.current = running;
  }, [running, status, toast]);

  useEffect(() => {
    const every = setInterval(() => void refresh(), running ? pollMs.running : pollMs.idle);
    const onShow = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(every);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [running, refresh, pollMs.running, pollMs.idle]);

  const publish = useCallback(async () => {
    setStarting(true);
    try {
      const r = await api.publish();
      if (r.status === 'started') {
        justStarted.current = { build: { buildId: r.buildId, buildStatus: 'IN_PROGRESS', phase: r.phase ?? 'SUBMITTED', startedAt: r.startedAt }, until: Date.now() + JUST_STARTED_MS };
        toast('Publishing started. It takes about two minutes.');
      } else {
        toast('A publish is already running.');
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'nothing_to_publish') toast('Everything is already live.');
      else fail(e);
    } finally {
      setStarting(false);
      await refresh();
    }
  }, [api, fail, refresh, toast]);

  const value = useMemo<PublishValue>(() => {
    const pendingCount = status?.pending.count ?? 0;
    const lastFailed = BROKEN.has(status?.latest?.buildStatus ?? '');
    const notConfigured = error?.code === 'publishing_not_configured';
    return {
      status,
      running,
      starting,
      error,
      notConfigured,
      pendingCount,
      lastFailed,
      canPublish: !!status && !notConfigured && !running && !starting && (pendingCount > 0 || lastFailed || status.latest === null),
      publish,
      refresh,
    };
  }, [status, running, starting, error, publish, refresh]);

  return <PublishContext.Provider value={value}>{children}</PublishContext.Provider>;
}

export function usePublish(): PublishValue {
  const v = useContext(PublishContext);
  if (!v) throw new Error('usePublish must be used inside <PublishProvider>');
  return v;
}
