import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { launchChrome } from './chrome.ts';
import { home } from './paths.ts';

/**
 * "Sign in to record": each site gets its own Chrome profile in the current
 * workspace's private folder. The user signs in once in a visible window;
 * takes then reuse the profile headless. Cookies stay inside the profile and
 * are never read, copied or logged.
 */

const sessionsRoot = () => join(home(), 'private', 'chrome-sessions');

/** A real (not headless-shell) Chrome: sign-in needs a window, and the same binary must read the cookies back. */
export function fullChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The host a session belongs to, from a host or a URL. Anything that can't be a host is refused before it becomes a path. */
export function sessionHost(hostOrUrl: string): string {
  let h = String(hostOrUrl).trim().toLowerCase();
  if (h.includes('://')) h = new URL(h).host;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(h)) throw Object.assign(new Error('not a host'), { status: 400 });
  return h;
}

const dirName = (host: string) => host.replace(':', '_');

/** The private profile folder for a host (created 0700). */
export async function sessionProfileDir(hostOrUrl: string): Promise<string> {
  const dir = join(sessionsRoot(), dirName(sessionHost(hostOrUrl)));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const d of [join(home(), 'private'), sessionsRoot(), dir]) await chmod(d, 0o700).catch(() => {});
  return dir;
}

export interface SignInResult {
  host: string;
  profileDir: string;
  /** How the window ended: the user closed it, or the wait ran out. */
  closed: 'window' | 'timeout';
}

/**
 * Open a visible Chrome window on the host's profile at `url` and wait until
 * the user closes it (or `timeoutMs` passes), then shut Chrome down cleanly
 * so the sign-in is saved.
 */
export async function openSignInWindow(url: string, opts: { timeoutMs?: number } = {}): Promise<SignInResult> {
  const host = sessionHost(url);
  const profileDir = await sessionProfileDir(host);
  const bin = fullChrome();
  if (!bin) throw new Error('Signing in needs Google Chrome or Chromium installed.');
  const chrome = await launchChrome({ profileDir, headful: true, bin, startUrl: url, windowSize: { width: 1280, height: 900 } });
  let closed: SignInResult['closed'] = 'timeout';
  try {
    const until = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    let gone = false;
    chrome.exited.then(() => (gone = true));
    while (Date.now() < until && !gone) {
      await new Promise((r) => setTimeout(r, 750));
      // On macOS Chrome outlives its last window, so watch the tabs rather than the process.
      const pages = await chrome
        .send('Target.getTargets')
        .then((r) => r.targetInfos.filter((t: any) => t.type === 'page').length)
        .catch(() => 0);
      if (pages === 0) gone = true;
    }
    if (gone) closed = 'window';
  } finally {
    await chrome.close();
  }
  return { host, profileDir, closed };
}

export async function forgetSession(hostOrUrl: string): Promise<boolean> {
  const dir = join(sessionsRoot(), dirName(sessionHost(hostOrUrl)));
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export interface SessionInfo {
  host: string;
  profileDir: string;
  updatedAt: string;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const names = await readdir(sessionsRoot()).catch(() => [] as string[]);
  const out: SessionInfo[] = [];
  for (const n of names.sort()) {
    const profileDir = join(sessionsRoot(), n);
    const s = await stat(profileDir).catch(() => null);
    if (s?.isDirectory()) out.push({ host: n.replace('_', ':'), profileDir, updatedAt: s.mtime.toISOString() });
  }
  return out;
}
