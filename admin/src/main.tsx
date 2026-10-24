import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigErrorScreen, UNAUTHORIZED_EVENT } from './App.tsx';
import './styles/app.css';
import { ApiClient } from './lib/api.ts';
import { CognitoAuth, DevAuth, type Auth } from './lib/auth.ts';
import { ConfigError, loadConfig } from './lib/config.ts';

async function start() {
  const root = createRoot(document.getElementById('root')!);

  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    root.render(<ConfigErrorScreen message={e instanceof ConfigError ? e.message : 'The admin could not start.'} />);
    return;
  }

  let auth: Auth;
  let authError: string | undefined;
  if (config.devAuth) {
    auth = new DevAuth();
  } else {
    const cognito = new CognitoAuth({ domain: config.cognito!.domain, clientId: config.cognito!.clientId, redirectUri: `${window.location.origin}/` });
    try {
      // Returning from the hosted sign-in page with ?code=...: finish the sign-in and tidy the address bar.
      const next = await cognito.handleRedirect(new URL(window.location.href));
      if (next) window.history.replaceState(null, '', next);
    } catch (e) {
      authError = e instanceof Error ? e.message : 'Sign-in failed.';
      window.history.replaceState(null, '', window.location.pathname);
    }
    auth = cognito;
  }

  const api = new ApiClient({
    baseUrl: config.apiUrl,
    token: () => auth.accessToken(),
    onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
  });

  root.render(
    <StrictMode>
      <App config={config} auth={auth} api={api} authError={authError} />
    </StrictMode>,
  );
}

void start();
