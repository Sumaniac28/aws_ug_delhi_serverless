import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { COLLECTION_ORDER, COLLECTIONS } from '../lib/collections.ts';
import { useApp } from '../state/app.tsx';
import { Button } from './primitives.tsx';

export function Logo({ size = 36 }: { size?: number }) {
  // Station roundel with a marigold line through it: the group's own mark (no AWS logo or smile).
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect x="0" y="16.5" width="40" height="7" className="fill-primary" />
      <circle cx="20" cy="20" r="13.5" className="fill-background stroke-foreground" strokeWidth="3" />
      <text x="20" y="24.6" textAnchor="middle" className="fill-foreground font-display" fontSize="12.5" fontWeight="800">
        UG
      </text>
    </svg>
  );
}

const KEY = 'theme';
const isDark = () => document.documentElement.classList.contains('dark');

/** Light by default; dark only when chosen. The choice is remembered (see public/theme-init.js). */
export function ThemeToggle() {
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#0d1b2f' : '#fbfaf7');
    setDark(next);
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={dark} className="grid size-11 place-items-center rounded-md border border-input text-foreground hover:bg-muted">
      {dark ? (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
      <span className="visually-hidden">Dark theme</span>
    </button>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-3 font-bold no-underline hover:bg-muted ${isActive ? 'text-primary-accent underline decoration-2 underline-offset-8' : ''}`;

export function Shell() {
  const { auth } = useApp();
  const user = auth.user();
  return (
    <>
      <a className="fixed left-4 -top-16 z-50 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground focus:top-4" href="#main">
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="wrap flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="font-display text-xl leading-none font-bold [font-stretch:82%]">
              AWS UG Delhi NCR <span className="text-muted-foreground">Admin</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user && <span className="text-muted-foreground">{user.username}</span>}
            <Button variant="ghost" onClick={() => auth.logout()}>
              Sign out
            </Button>
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Main" className="wrap flex flex-wrap gap-x-1 pb-2">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          {COLLECTION_ORDER.map((c) => (
            <NavLink key={c} to={`/c/${c}`} className={navClass}>
              {COLLECTIONS[c].label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="main" className="wrap flex-1 py-10">
        <Outlet />
      </main>
    </>
  );
}

/** Full-page messages (sign in, not allowed, broken config). */
export function Centered({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="wrap-narrow flex flex-1 flex-col justify-center py-20">
      <div className="mb-6">
        <Logo size={48} />
      </div>
      <h1 className="text-6xl">{title}</h1>
      <div className="mt-5 space-y-4 text-xl text-muted-foreground">{children}</div>
    </main>
  );
}
