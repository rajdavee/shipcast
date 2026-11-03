import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

/** Hash routing: #/new, #/calendar, #/library, #/c/<id>, #/ideas, #/brand, #/insights, #/settings/<tab> */
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : ['new'];
}
export const go = (path: string) => {
  window.location.hash = path;
};

export const SETTINGS_TABS = ['connections', 'generation', 'agents', 'skills'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
// Older names stay valid: docs, notifications and the code link to them.
const ALIAS: Record<string, string[]> = { trending: ['ideas'], voice: ['brand'], learning: ['insights'], setup: ['settings', 'connections'], skills: ['settings', 'skills'], projects: ['library'] };
/** The canonical route for any hash, old or new: ['settings', 'agents'], ['c', id], ['new']… */
export function resolveRoute(parts: string[]): string[] {
  const p = ALIAS[parts[0]] ? [...ALIAS[parts[0]], ...parts.slice(1)] : parts.length ? parts : ['new'];
  if (p[0] === 'settings') return ['settings', SETTINGS_TABS.includes(p[1] as SettingsTab) ? p[1] : 'connections'];
  return p;
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

/** A boolean remembered in localStorage. */
export function useStoredFlag(key: string, initial: boolean) {
  const [on, setOn] = useState(() => (read(key) ?? (initial ? '1' : '0')) === '1');
  const set = useCallback((v: boolean) => {
    setOn(v);
    write(key, v ? '1' : '0');
  }, [key]);
  return [on, set] as const;
}

export type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'shipcast.theme';
export const storedTheme = (): ThemePref => (read(THEME_KEY) === 'light' ? 'light' : read(THEME_KEY) === 'dark' ? 'dark' : 'system');
/** 'system' leaves the attribute off so CSS follows prefers-color-scheme. */
export const applyTheme = (t: ThemePref) => (t === 'system' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t));
const themeListeners = new Set<() => void>();
let themeNow: ThemePref | null = null;
/** One theme for the whole app: the sidebar switch and the palette share it. */
export function useTheme() {
  const theme = useSyncExternalStore((cb) => (themeListeners.add(cb), () => void themeListeners.delete(cb)), () => (themeNow ??= storedTheme()));
  const set = useCallback((t: ThemePref) => {
    themeNow = t;
    applyTheme(t);
    write(THEME_KEY, t === 'system' ? null : t);
    themeListeners.forEach((l) => l());
  }, []);
  return [theme, set] as const;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Keep Tab inside `ref` while active, and hand focus back to whatever had it on close. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  // Read during render: by the time effects run, autoFocus inside the trap has already moved focus.
  const saved = useRef<HTMLElement | null>(null);
  if (!active) saved.current = null;
  else if (!saved.current) saved.current = document.activeElement as HTMLElement | null;
  useEffect(() => {
    if (!active) return;
    const before = saved.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!ref.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [active]);
}

/** Load data and reload on demand (or every `poll` ms). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], poll?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    fnRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    reload();
    if (!poll) return;
    const t = setInterval(reload, poll);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload, setData };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<(s: string | null) => void>();
export function toast(msg: string) {
  toastListeners.forEach((l) => l(msg));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastListeners.forEach((l) => l(null)), 2600);
}
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastListeners.add(setMsg);
    return () => void toastListeners.delete(setMsg);
  }, []);
  return msg;
}

// Layers (drawer, dialog, menu) stack; Escape closes only the top one.
const escStack: { current: () => void }[] = [];
let escBound = false;
/** Close on Escape while active — only the most recently opened layer reacts. */
export function useEscape(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    escStack.push(entry);
    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !escStack.length || e.defaultPrevented) return;
        e.preventDefault();
        escStack[escStack.length - 1].current();
      });
    }
    return () => void escStack.splice(escStack.indexOf(entry), 1);
  }, [active]);
}

/** Matches a media query, live. */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}
