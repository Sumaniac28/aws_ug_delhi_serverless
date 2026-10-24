import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import badge48 from '../../../public/brand/ug-badge-48.webp';
import badge96 from '../../../public/brand/ug-badge-96.webp';
import type { CollectionName } from '../lib/api.ts';
import { COLLECTION_ORDER, COLLECTIONS, isCollectionName } from '../lib/collections.ts';
import { useApp } from '../state/app.tsx';
import { usePublish } from '../state/publish.tsx';
import { Icon, type IconName } from './icons.tsx';
import { PublishControl } from './publish-control.tsx';

/** The chapter's own badge (the skyline hexagon), never the AWS logo. Decorative: the name next to it says who it is. */
export function Brand({ size = 40 }: { size?: number }) {
  return <img src={badge48} srcSet={`${badge48} 1x, ${badge96} 2x`} width={size} height={Math.round((size * 586) / 510)} alt="" className="shrink-0" />;
}

const KEY = 'theme';
const isDark = () => document.documentElement.classList.contains('dark');

/** Light by default; dark only when chosen. The choice is remembered (see public/theme-init.js). */
export function ThemeToggle({ className = 'border-input text-foreground hover:bg-muted' }: { className?: string }) {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const sync = () => setDark(isDark());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const toggle = () => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try {
      if (next) localStorage.setItem(KEY, 'dark');
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: the choice just will not persist */
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#0f141a' : '#fafaf8');
    setDark(next);
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={dark} className={`grid size-ctl place-items-center rounded-md border ${className}`}>
      <Icon name={dark ? 'moon' : 'sun'} size={18} />
      <span className="visually-hidden">Dark theme</span>
    </button>
  );
}

const NAV_ICONS: Record<CollectionName, IconName> = { events: 'calendar-event', speakers: 'microphone', sponsors: 'building-store', organizers: 'users', posts: 'news' };

const navClass = ({ isActive }: { isActive: boolean }) =>
  `relative flex min-h-ctl items-center gap-2.5 rounded-md px-3 text-sm no-underline transition-colors hover:bg-muted ${isActive ? 'bg-muted font-semibold text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary' : 'font-medium text-muted-foreground hover:text-foreground'}`;

/** A page names itself (an event's title) for the breadcrumb, once it has loaded. */
const CrumbContext = createContext<(title: string | undefined) => void>(() => {});
export function useCrumb(title: string | undefined) {
  const set = useContext(CrumbContext);
  useEffect(() => {
    set(title);
    return () => set(undefined);
  }, [title, set]);
}

function Breadcrumbs({ title }: { title?: string }) {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  const collection = parts[0] === 'c' && isCollectionName(parts[1]) ? parts[1] : undefined;
  const meta = collection ? COLLECTIONS[collection] : undefined;
  const last = parts[2] === 'new' ? `New ${meta?.singular}` : (title ?? parts[2]);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted-foreground">
      <ol className="flex min-w-0 items-center gap-1.5">
        {meta ? (
          <>
            <li>
              <Link to={`/c/${collection}`} className="no-underline hover:text-foreground hover:underline">
                {meta.label}
              </Link>
            </li>
            {parts[2] && (
              <>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="truncate font-medium text-foreground">
                  {last}
                </li>
              </>
            )}
          </>
        ) : (
          <li aria-current="page" className="font-medium text-foreground">
            {parts.length === 0 ? 'Dashboard' : 'Not found'}
          </li>
        )}
      </ol>
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { auth } = useApp();
  const user = auth.user();
  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Brand size={26} />
        <p className="leading-tight">
          <span className="block text-sm font-semibold">AWS UG Delhi NCR</span>
          <span className="block text-xs text-muted-foreground">Admin</span>
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        <nav aria-label="Main" className="grid gap-0.5" onClick={onNavigate}>
          <NavLink to="/" end className={navClass}>
            <Icon name="layout-dashboard" size={18} />
            Dashboard
          </NavLink>
          <p className="mt-4 mb-1 px-3 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">Content</p>
          {COLLECTION_ORDER.map((c) => (
            <NavLink key={c} to={`/c/${c}`} className={navClass}>
              <Icon name={NAV_ICONS[c]} size={18} />
              {COLLECTIONS[c].label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto grid gap-3">
          <PublishControl />
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
              {initials}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{user?.username}</p>
            <ThemeToggle />
            <button type="button" onClick={() => auth.logout()} className="grid size-ctl place-items-center rounded-md border border-input text-foreground hover:bg-muted" title="Sign out">
              <Icon name="logout" size={18} />
              <span className="visually-hidden">Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function Shell() {
  const [open, setOpen] = useState(false);
  const [crumb, setCrumb] = useState<string | undefined>();
  const { pendingCount } = usePublish();
  const { config } = useApp();
  const location = useLocation();
  const ctx = useMemo(() => setCrumb, []);
  // A new page closes the phone menu.
  useEffect(() => setOpen(false), [location.pathname]);
  // Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <CrumbContext.Provider value={ctx}>
      <div className="min-h-screen lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]">
        <a className="fixed left-4 -top-16 z-50 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground focus:top-4" href="#main">
          Skip to content
        </a>

        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden="true" onClick={() => setOpen(false)} />}
        <header
          id="admin-menu"
          className={`${open ? 'fixed inset-y-0 left-0 z-40 flex w-72 shadow-float' : 'hidden'} flex-col border-r border-border bg-sidebar lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-screen lg:w-auto lg:shadow-none`}
        >
          <Sidebar onNavigate={() => setOpen(false)} />
        </header>

        <div className="flex min-w-0 flex-col">
          <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-8">
            <button
              type="button"
              className="inline-flex min-h-ctl items-center gap-2 rounded-md border border-input px-3 text-sm font-semibold hover:bg-muted lg:hidden"
              aria-expanded={open}
              aria-controls="admin-menu"
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name={open ? 'x' : 'menu'} size={18} />
              Menu
              {pendingCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                  {pendingCount}
                  <span className="visually-hidden"> {pendingCount === 1 ? 'change' : 'changes'} waiting to go live</span>
                </span>
              )}
            </button>
            <Breadcrumbs title={crumb} />
            <a href={config.siteUrl} target="_blank" rel="noreferrer" className="ml-auto hidden items-center gap-1.5 text-sm font-medium text-muted-foreground no-underline hover:text-foreground sm:inline-flex">
              Open website
              <Icon name="external-link" size={14} />
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </div>
          <main id="main" className="px-4 py-6 sm:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-[70rem]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}

/** Full-page messages (sign in, not allowed, broken config). */
export function Centered({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="wrap-narrow flex flex-1 flex-col justify-center py-20">
      <div className="mb-6">
        <Brand size={56} />
      </div>
      <h1 className="text-3xl">{title}</h1>
      <div className="mt-4 space-y-3 text-base text-muted-foreground">{children}</div>
    </main>
  );
}
