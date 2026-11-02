import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { home } from '@shipcast/engine';
import { estimate, MODELS, type Capability, type ModelInfo, type Provider } from './registry.ts';

/**
 * Picking a model: filter by what the shot needs (capability, references,
 * pinned frames, audio), licence and the providers the user has connected;
 * then rank by tier — drafts favour speed and price, premium favours realism.
 * An explicit model id always wins.
 */

export type Tier = 'draft' | 'standard' | 'premium';

export interface RouteNeeds {
  capability: Capability;
  model?: string;
  tier?: Tier;
  refs?: number;
  lastFrame?: boolean;
  audio?: boolean;
  seconds?: number;
  /** Only models whose licence allows commercial use (default true). */
  commercial?: boolean;
  /** Providers with keys. */
  providers: Provider[];
}

export function route(n: RouteNeeds): ModelInfo[] {
  if (n.model) {
    const m = MODELS.find((x) => x.id === n.model || x.endpoint === n.model);
    if (!m) throw new Error(`unknown model "${n.model}"`);
    if (m.capability !== n.capability) throw new Error(`${m.id} does ${m.capability}, not ${n.capability}`);
    return [m];
  }
  const tier = n.tier ?? 'standard';
  const fits = MODELS.filter(
    (m) =>
      m.capability === n.capability &&
      n.providers.includes(m.provider) &&
      (n.commercial === false || m.commercialOK) &&
      (!n.refs || (m.inputs.refs ?? (m.inputs.firstFrame ? 1 : 0)) >= n.refs) &&
      (!n.lastFrame || m.inputs.lastFrame) &&
      (!n.audio || m.inputs.audio),
  );
  const w = tier === 'draft' ? { q: 1, s: 2, c: 3 } : tier === 'premium' ? { q: 4, s: 0.5, c: 0.5 } : { q: 2.5, s: 1, c: 1.5 };
  const cheapest = Math.min(...fits.map((m) => estimate(m, { seconds: n.seconds })).filter((x) => x > 0), 1);
  const score = (m: ModelInfo) => {
    const cost = estimate(m, { seconds: n.seconds });
    const value = cost > 0 ? cheapest / cost : 0.2; // the offline stand-in is free but worthless
    return w.q * m.quality + w.s * m.speed + w.c * 5 * value - (m.provider === 'fake' ? 100 : 0);
  };
  return fits.sort((a, b) => score(b) - score(a));
}

// ── spend ledger and result cache: ~/.shipcast/gen ──────────────────────

const dir = () => join(home(), 'gen');
const ledgerFile = () => join(dir(), 'ledger.json');
const month = () => new Date().toISOString().slice(0, 7);

interface Ledger {
  months: Record<string, number>;
  keys: Record<string, number>;
  log: { at: string; key: string; model: string; usd: number }[];
}

async function readLedger(): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(ledgerFile(), 'utf8'));
  } catch {
    return { months: {}, keys: {}, log: [] };
  }
}

export async function spent(key?: string): Promise<{ month: number; key: number }> {
  const l = await readLedger();
  return { month: l.months[month()] ?? 0, key: key ? l.keys[key] ?? 0 : 0 };
}

// One writer at a time: concurrent jobs would otherwise read the same ledger and lose each other's spend.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};
/** Spend that passed the cap check but hasn't been recorded yet (jobs in flight). */
const reserved = new Map<string, number>();
const reservedFor = (key: string) => [...reserved.entries()].filter(([k]) => k.startsWith(`${key}::`)).reduce((a, [, v]) => a + v, 0);
const reservedAll = () => [...reserved.values()].reduce((a, v) => a + v, 0);

/** Refuse before spending if this request would break a cap; on success the amount is held until released. */
export function checkBudget(key: string, usd: number, caps: { perKey: number; perMonth: number }): Promise<() => void> {
  return serial(async () => {
    const hold = `${key}::${Math.random().toString(36).slice(2)}`;
    const release = () => void reserved.delete(hold);
    if (usd <= 0) return release;
    const s = await spent(key);
    const k = s.key + reservedFor(key);
    const m = s.month + reservedAll();
    if (k + usd > caps.perKey) throw new Error(`This would take the project's generation spend to $${(k + usd).toFixed(2)}, over its $${caps.perKey.toFixed(2)} cap. Raise it in Setup → Generation, or use a draft tier.`);
    if (m + usd > caps.perMonth) throw new Error(`This would take this month's generation spend to $${(m + usd).toFixed(2)}, over the $${caps.perMonth.toFixed(2)} monthly cap (Setup → Generation).`);
    reserved.set(hold, usd);
    return release;
  });
}

export function record(key: string, model: string, usd: number): Promise<void> {
  if (usd <= 0) return Promise.resolve();
  return serial(() => recordNow(key, model, usd));
}

async function recordNow(key: string, model: string, usd: number): Promise<void> {
  const l = await readLedger();
  l.months[month()] = +((l.months[month()] ?? 0) + usd).toFixed(4);
  l.keys[key] = +((l.keys[key] ?? 0) + usd).toFixed(4);
  l.log = [...l.log, { at: new Date().toISOString(), key, model, usd }].slice(-2000);
  await mkdir(dir(), { recursive: true });
  await writeFile(ledgerFile(), JSON.stringify(l, null, 1));
}

/** Same model + same inputs (+ seed) = same file: re-runs and retakes of approved shots cost nothing. */
export function cacheKey(model: string, payload: unknown, inputHashes: string[]): string {
  return createHash('sha256').update(JSON.stringify([model, payload, inputHashes])).digest('hex').slice(0, 24);
}

export const cacheDir = () => join(dir(), 'cache');
export const cached = (k: string, ext: string) => {
  const f = join(cacheDir(), `${k}${ext}`);
  return existsSync(f) ? f : null;
};
