import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { currentContext } from './context.ts';
import { home, userDir } from './paths.ts';

/**
 * Claude plan usage windows. When Claude Code reports its usage limit, every
 * step that needs Claude waits until the window resets (renders and packaging
 * keep going), then resumes the interrupted session. Long campaigns run for
 * hours, so this is a pause, not a failure.
 */

// Usage belongs to a Claude account, and each user brings their own.
const file = () => {
  const u = currentContext()?.user;
  return u ? join(userDir(u), 'usage-pause.json') : join(home(), 'usage-pause.json');
};

/** When the limit resets (ms since epoch), or null if `text` isn't a usage-limit message. */
export function parseUsageReset(text: string, now = Date.now()): number | null {
  const at = parseRaw(text, now);
  // Never less than five minutes: a stale or past reset time must not spin retries.
  return at === null ? null : Math.max(at, now + 5 * 60_000);
}

function parseRaw(text: string, now: number): number | null {
  if (!/usage limit|limit reached|limit will reset|out of (?:extra )?usage|weekly limit|session limit/i.test(text)) return null;
  // "Claude AI usage limit reached|1761900000"
  const epoch = /limit reached\|(\d{10,13})/i.exec(text);
  if (epoch) {
    const n = Number(epoch[1]);
    return n < 1e12 ? n * 1000 : n;
  }
  // "resets 3pm", "will reset at 3:30 PM", "resets at 15:00"
  const t = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (t) {
    let h = Number(t[1]) % 24;
    const m = Number(t[2] ?? 0);
    const ap = t[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // A limit with no readable reset time: look again in 30 minutes.
  return now + 30 * 60_000;
}

export async function usagePause(): Promise<{ until: number; reason: string } | null> {
  if (!existsSync(file())) return null;
  try {
    const p = JSON.parse(await readFile(file(), 'utf8'));
    if (Number(p.until) > Date.now()) return p;
  } catch {}
  await rm(file(), { force: true }).catch(() => {});
  return null;
}

export async function setUsagePause(until: number, reason: string): Promise<void> {
  // A minute of slack after the reset so the first call doesn't bounce.
  await mkdir(dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify({ until: until + 60_000, reason: reason.slice(0, 300) }));
}
