/**
 * The site's motion (DESIGN.md, "Motion"): scroll reveal and line drawing, count-up numbers, marquee control,
 * the countdown board and the gallery viewer. Styles live in src/styles/motion.css. Everything here is an
 * enhancement: the server-rendered page is complete without it, and with reduced motion only the useful parts
 * (pause buttons, countdown text, the photo viewer) run.
 */
import { formatCount, valueAt } from '../lib/motion/count';
import { countdownState, pad2 } from '../lib/motion/countdown';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

// ---------- 4. Count-up numbers ----------
function countUp(el: HTMLElement) {
  const target = Number(el.dataset.countup);
  const show = el.querySelector<HTMLElement>('[data-countup-show]');
  if (!show || !Number.isFinite(target)) return;
  const t0 = performance.now();
  const step = (t: number) => {
    const p = (t - t0) / 900;
    show.textContent = formatCount(valueAt(target, p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 6 + 8. Reveal once in view; line drawing is the same trigger ----------
function initReveal() {
  const items = [...document.querySelectorAll<HTMLElement>('[data-reveal], [data-countup]')];
  if (reduced || !('IntersectionObserver' in window)) return;
  const settle = (el: HTMLElement) => setTimeout(() => el.classList.add('is-settled'), 1500);

  // Whatever is already on screen stays as it is: nothing visible disappears and comes back.
  const fold = innerHeight * 0.9;
  const pending: HTMLElement[] = [];
  for (const el of items) {
    if (el.getBoundingClientRect().top < fold) {
      el.classList.add('is-in', 'is-settled');
    } else {
      if (el.dataset.countup !== undefined) el.querySelector('[data-countup-show]')!.textContent = formatCount(0);
      pending.push(el);
    }
  }
  root.classList.add('motion-ready');

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        io.unobserve(el);
        el.classList.add('is-in');
        settle(el);
        if (el.dataset.countup !== undefined) countUp(el);
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  pending.forEach((el) => io.observe(el));
}

// ---------- Pause buttons (WCAG 2.2.2) ----------
function initPauseButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-pause]').forEach((btn) => {
    const target = btn.closest<HTMLElement>('[data-pausable]');
    if (!target) return;
    btn.addEventListener('click', () => {
      const paused = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(paused));
      target.toggleAttribute('data-paused', paused);
      target.dispatchEvent(new CustomEvent('pausechange', { detail: paused }));
    });
  });
}

// ---------- 1 + 2. Marquees: speed from content, still while off-screen ----------
function initMarquees() {
  const marquees = document.querySelectorAll<HTMLElement>('.marquee');
  if (!marquees.length || reduced) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => (e.target as HTMLElement).toggleAttribute('data-offscreen', !e.isIntersecting)));
  marquees.forEach((m) => {
    const track = m.querySelector<HTMLElement>('.marquee-track');
    // A steady reading speed whatever the number of items: about 40px a second.
    if (track) m.style.setProperty('--marquee-duration', `${Math.max(20, Math.round(track.scrollWidth / 40))}s`);
    io.observe(m);
  });
}

// ---------- 3. Countdown board ----------
function initCountdowns() {
  document.querySelectorAll<HTMLElement>('[data-countdown]').forEach((board) => {
    const { start = '', end = '' } = board.dataset;
    const label = board.querySelector<HTMLElement>('[data-countdown-label]')!;
    const digits = board.querySelector<HTMLElement>('[data-countdown-digits]')!;
    const units = Object.fromEntries([...board.querySelectorAll<HTMLElement>('[data-u]')].map((u) => [u.dataset.u!, u]));
    let timer: number | undefined;

    const set = (u: string, text: string) => {
      const el = units[u];
      if (!el || el.textContent === text) return;
      el.textContent = text;
      if (!reduced) {
        el.classList.remove('is-tick');
        void el.offsetWidth; // restart the flap animation
        el.classList.add('is-tick');
      }
    };
    const render = () => {
      const s = countdownState(start, end);
      if (s.kind === 'ended') {
        stop();
        board.remove();
        return;
      }
      board.hidden = false;
      if (s.kind === 'live') {
        label.textContent = 'Happening now';
        digits.hidden = true;
        stop();
        return;
      }
      units.d!.hidden = s.days === 0;
      set('d', `${s.days}d`);
      set('h', pad2(s.hours));
      set('m', pad2(s.minutes));
      set('s', pad2(s.seconds));
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const run = () => {
      stop();
      if (board.hasAttribute('data-paused') || document.hidden) return;
      render();
      timer = window.setInterval(render, 1000);
    };
    board.addEventListener('pausechange', run);
    document.addEventListener('visibilitychange', run);
    render();
    run();
  });
}

// ---------- 10. Gallery viewer ----------
function initLightbox() {
  const dialog = document.querySelector<HTMLDialogElement>('dialog.lightbox');
  const items = [...document.querySelectorAll<HTMLAnchorElement>('[data-lightbox-item]')];
  if (!dialog || !items.length || typeof dialog.showModal !== 'function') return;
  const img = dialog.querySelector<HTMLImageElement>('[data-lb-img]')!;
  const caption = dialog.querySelector<HTMLElement>('[data-lb-caption]')!;
  const counter = dialog.querySelector<HTMLElement>('[data-lb-count]')!;
  let index = 0;
  let opener: HTMLElement | null = null;

  const show = (i: number) => {
    index = (i + items.length) % items.length;
    const a = items[index]!;
    img.src = a.href;
    img.srcset = a.dataset.srcset ?? '';
    img.alt = a.dataset.alt ?? '';
    caption.textContent = a.dataset.alt ?? '';
    counter.textContent = `${index + 1} of ${items.length}`;
  };
  const thumbOf = (i: number) => items[i]?.querySelector('img');

  const open = (i: number, from: HTMLElement) => {
    opener = from;
    const thumb = thumbOf(i);
    const doOpen = () => {
      if (thumb) thumb.style.viewTransitionName = '';
      img.style.viewTransitionName = 'lightbox-photo';
      show(i);
      dialog.showModal();
    };
    if (!reduced && document.startViewTransition && thumb) {
      thumb.style.viewTransitionName = 'lightbox-photo';
      document.startViewTransition(doOpen).finished.finally(() => (img.style.viewTransitionName = ''));
    } else doOpen();
  };

  items.forEach((a, i) =>
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new-tab clicks keep working
      e.preventDefault();
      open(i, a);
    }),
  );
  dialog.querySelector('[data-lb-prev]')?.addEventListener('click', () => show(index - 1));
  dialog.querySelector('[data-lb-next]')?.addEventListener('click', () => show(index + 1));
  dialog.querySelector('[data-lb-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  // Clicking the dim backdrop closes; clicking the photo does not.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  // Swipe on touch screens.
  let x0: number | null = null;
  dialog.addEventListener('pointerdown', (e) => (x0 = e.pointerType === 'touch' ? e.clientX : null));
  dialog.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  dialog.addEventListener('close', () => opener?.focus());
}

// ---------- Speakers: search by name, sort A to Z or by number of talks ----------
function initSpeakerTools() {
  const list = document.querySelector<HTMLElement>('[data-speaker-list]');
  const input = document.querySelector<HTMLInputElement>('[data-speaker-search]');
  if (!list || !input) return;
  const items = [...list.querySelectorAll<HTMLElement>('[data-speaker]')];
  const count = document.querySelector<HTMLElement>('[data-speaker-count]');
  const none = document.querySelector<HTMLElement>('[data-speaker-none]');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-speaker-sort]')];
  const total = items.length;

  const apply = () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const li of items) {
      const hit = !q || (li.dataset.name ?? '').includes(q);
      li.hidden = !hit;
      if (hit) shown++;
    }
    if (count) count.textContent = String(shown);
    none?.classList.toggle('hidden', shown > 0);
    // Cards that were hidden before the first reveal must not stay invisible when they appear.
    list.classList.add('is-in');
  };
  const sort = (by: string) => {
    const key = (li: HTMLElement) => (by === 'talks' ? -Number(li.dataset.talks) : 0);
    const sorted = [...items].sort((a, b) => key(a) - key(b) || Number(a.dataset.order) - Number(b.dataset.order));
    sorted.forEach((li) => list.appendChild(li));
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.speakerSort === by)));
  };
  input.addEventListener('input', apply);
  buttons.forEach((b) => b.addEventListener('click', () => sort(b.dataset.speakerSort ?? 'name')));
  if (count) count.textContent = String(total);
}

// ---------- In-page navigation: mark the section in view ----------
function initSectionNav() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-section-link]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [a.getAttribute('href')!.slice(1), a]));
  const visible = new Set<string>();
  const mark = () => {
    // The first section (in page order) that is on screen wins.
    const current = [...byId.keys()].find((id) => visible.has(id));
    links.forEach((a) => a.removeAttribute('aria-current'));
    if (current) byId.get(current)!.setAttribute('aria-current', 'true');
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id));
      mark();
    },
    { rootMargin: '-20% 0px -60% 0px' },
  );
  byId.forEach((_a, id) => {
    const section = document.getElementById(id);
    if (section) io.observe(section);
  });
}

initReveal();
initSpeakerTools();
initSectionNav();
initPauseButtons();
initMarquees();
initCountdowns();
initLightbox();

/** The header gets a hairline and a soft shadow once the page has moved, so it reads as floating over the content. */
function initHeaderScroll() {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (!header) return;
  const set = () => header.setAttribute('data-scrolled', String(window.scrollY > 8));
  set();
  window.addEventListener('scroll', set, { passive: true });
}
initHeaderScroll();

/** Blog topic chips: they only appear with JavaScript (there is nothing to filter without it) and hide posts that lack the topic. */
function initTagFilter() {
  const group = document.querySelector<HTMLElement>('[data-tag-filter]');
  if (!group) return;
  group.hidden = false;
  const posts = [...document.querySelectorAll<HTMLElement>('[data-post]')];
  const none = document.querySelector<HTMLElement>('[data-no-posts]');
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tag]');
    if (!btn) return;
    const tag = btn.dataset.tag ?? '';
    group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    let shown = 0;
    for (const post of posts) {
      const has = !tag || (post.dataset.tags ?? '').split('|').includes(tag);
      post.hidden = !has;
      if (has) shown++;
    }
    none?.classList.toggle('hidden', shown > 0);
  });
}
initTagFilter();

/** "Copy link" on a blog post: the button only shows with JavaScript, where copying works. */
function initCopyLink() {
  const btn = document.querySelector<HTMLButtonElement>('[data-copy-link]');
  if (!btn || !navigator.clipboard) return;
  btn.classList.remove('hidden');
  btn.classList.add('inline-flex');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copyLink ?? location.href);
      const label = btn.querySelector('[data-copy-label]');
      if (label) {
        label.textContent = 'Link copied';
        setTimeout(() => (label.textContent = 'Copy link'), 2000);
      }
    } catch {
      /* clipboard blocked: the link is in the address bar anyway */
    }
  });
}
initCopyLink();
