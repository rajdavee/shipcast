import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Hash routing: #/new, #/campaigns, #/c/<id>, #/packs, #/connect, #/settings */
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
