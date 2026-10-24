import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Auth } from '../lib/auth.ts';
import type { AppConfig } from '../lib/config.ts';

export interface AppContextValue {
  config: AppConfig;
  auth: Auth;
  api: ApiClient;
  /** Set when the session has ended mid-use; the app then shows the sign-in screen. */
  sessionEnded: boolean;
  endSession: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ config, auth, api, children }: { config: AppConfig; auth: Auth; api: ApiClient; children: ReactNode }) {
  const [sessionEnded, setSessionEnded] = useState(false);
  const endSession = useCallback(() => setSessionEnded(true), []);
  const value = useMemo(() => ({ config, auth, api, sessionEnded, endSession }), [config, auth, api, sessionEnded, endSession]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
export const useApi = () => useApp().api;
