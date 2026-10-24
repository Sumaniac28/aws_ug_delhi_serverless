import { useEffect, useMemo, useState } from 'react';
import { createBrowserRouter, createMemoryRouter, isRouteErrorResponse, useParams, useRouteError, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ConfigErrorScreen, NotAllowedScreen, SignInScreen } from './pages/auth-screens.tsx';
import { CollectionList } from './pages/CollectionList.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { ItemEditor } from './pages/ItemEditor.tsx';
import type { ApiClient } from './lib/api.ts';
import type { Auth } from './lib/auth.ts';
import { isCollectionName } from './lib/collections.ts';
import type { AppConfig } from './lib/config.ts';
import { AppProvider, useApp } from './state/app.tsx';
import { PublishProvider } from './state/publish.tsx';
import { Alert, ButtonLink } from './ui/primitives.tsx';
import { Shell } from './ui/shell.tsx';
import { ToastProvider } from './ui/toast.tsx';

export const UNAUTHORIZED_EVENT = 'awsug:unauthorized';

function NotFound() {
  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="text-2xl">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <p>
        <ButtonLink to="/">Back to the dashboard</ButtonLink>
      </p>
    </div>
  );
}

function ListRoute() {
  const { collection } = useParams();
  return isCollectionName(collection) ? <CollectionList key={collection} collection={collection} /> : <NotFound />;
}

function EditorRoute({ isNew }: { isNew?: boolean }) {
  const { collection, id } = useParams();
  if (!isCollectionName(collection)) return <NotFound />;
  return <ItemEditor key={`${collection}/${isNew ? 'new' : id}`} collection={collection} id={isNew ? undefined : id} />;
}

function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unknown error';
  return (
    <main className="wrap-narrow py-20">
      <Alert tone="error" title="Something went wrong on this page.">
        {message}
      </Alert>
      <p className="mt-4">
        <ButtonLink to="/">Back to the dashboard</ButtonLink>
      </p>
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'c/:collection', element: <ListRoute /> },
      { path: 'c/:collection/new', element: <EditorRoute isNew /> },
      { path: 'c/:collection/:id', element: <EditorRoute /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

/** Gates the app behind sign-in and the organizers group, then shows the routes. */
function Gate({ router, pollMs }: { router: ReturnType<typeof createBrowserRouter>; pollMs?: { running: number; idle: number } }) {
  const { auth, config, sessionEnded, endSession } = useApp();
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, endSession);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, endSession);
  }, [endSession]);

  if (sessionEnded || !auth.isSignedIn()) {
    return <SignInScreen auth={auth} notice={sessionEnded ? 'Your session has ended. Sign in again to continue.' : undefined} />;
  }
  const user = auth.user();
  // Cosmetic: the API enforces the group on every request. This just explains the situation kindly.
  if (!config.devAuth && user && !user.groups.includes('organizers')) {
    return <NotAllowedScreen username={user.username} onSignOut={() => auth.logout()} />;
  }
  return (
    <PublishProvider pollMs={pollMs}>
      <RouterProvider router={router} />
    </PublishProvider>
  );
}

export function App({
  config,
  auth,
  api,
  authError,
  router: provided,
  publishPollMs,
}: {
  config: AppConfig;
  auth: Auth;
  api: ApiClient;
  authError?: string;
  router?: ReturnType<typeof createBrowserRouter>;
  /** How often the Publish control re-checks (tests shorten it). */
  publishPollMs?: { running: number; idle: number };
}) {
  const router = useMemo(() => provided ?? createBrowserRouter(routes), [provided]);
  const [error] = useState(authError);
  if (error && !auth.isSignedIn()) {
    return <SignInScreen auth={auth} error={error} />;
  }
  return (
    <AppProvider config={config} auth={auth} api={api}>
      <ToastProvider>
        <Gate router={router} pollMs={publishPollMs} />
      </ToastProvider>
    </AppProvider>
  );
}

export { ConfigErrorScreen, createMemoryRouter };
