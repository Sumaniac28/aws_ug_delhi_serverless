import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type BuildSummary, type CollectionName, type ListItem } from '../lib/api.ts';
import { useApp } from './app.tsx';

export interface Async<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
  reload: () => void;
}

/** Runs an API call on mount (and whenever `key` changes), with loading, error and reload. */
export function useAsync<T>(fn: () => Promise<T>, key: string): Async<T> {
  const { endSession } = useApp();
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, loading: true }));
    fnRef.current().then(
      (data) => live && setState({ data, loading: false }),
      (e) => {
        if (!live) return;
        if (e?.name === 'AuthError') return endSession();
        setState({ error: e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e?.message ?? e)), loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [key, tick, endSession]);

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Lists of items other forms refer to (speakers for an event, organizers for a post...). */
export function useRefOptions(collection: CollectionName) {
  const { api } = useApp();
  const list = useAsync<ListItem[]>(() => api.list(collection), `refs:${collection}`);
  return { items: list.data ?? [], loading: list.loading, error: list.error };
}

const ACTIVE = new Set(['IN_PROGRESS']);

/** Starts site builds and follows the latest one until it finishes. */
export function usePublish() {
  const { api, endSession } = useApp();
  const [latest, setLatest] = useState<BuildSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  const [note, setNote] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setLatest(await api.publishStatus());
      setError(undefined);
    } catch (e: any) {
      if (e?.name === 'AuthError') return endSession();
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e?.message ?? e)));
    }
  }, [api, endSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a build runs, check on it every few seconds.
  const running = !!latest?.buildStatus && ACTIVE.has(latest.buildStatus);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [running, refresh]);

  const publish = useCallback(async () => {
    setBusy(true);
    setNote(undefined);
    try {
      const r = await api.publish();
      setNote(r.status === 'already-running' ? 'A publish is already running.' : 'Publishing started.');
      await refresh();
    } catch (e: any) {
      if (e?.name === 'AuthError') return endSession();
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e?.message ?? e)));
    } finally {
      setBusy(false);
    }
  }, [api, refresh, endSession]);

  return { latest, running, busy, error, note, publish, notConfigured: error?.code === 'publishing_not_configured' };
}
