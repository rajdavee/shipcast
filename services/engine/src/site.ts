import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withDirLock } from './filelock.ts';
import { googleSiteAccess, googleSiteConnected, providerFailure, providerFetch, PublishError } from './publish.ts';
import type { SiteDay } from './report-facts.ts';
import { DEFAULT_SITE, hostOfSite, readSiteSettings, siteDir, UTM_PREFIX, type SiteSettings } from './utm.ts';

/**
 * Website numbers for reports: Google Analytics 4 (visits, users, key
 * events — by source and by the UTM campaign Shipcast puts on its links) and
 * Search Console (clicks, impressions, position, top searches). Read-only,
 * cached per day in the workspace so a report never waits on Google.
 */

const GA_ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';
const GA_DATA = 'https://analyticsdata.googleapis.com/v1beta';
const GSC = 'https://www.googleapis.com/webmasters/v3';

// ── store ──────────────────────────────────────────────────────────────

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = async () => {
    await mkdir(siteDir(), { recursive: true });
    return withDirLock(siteDir(), fn);
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
};
async function writeJson(f: string, data: unknown) {
  const tmp = `${f}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, f);
}
const daysFile = () => join(siteDir(), 'days.json');
async function readDays(): Promise<SiteDay[]> {
  try {
    return JSON.parse(await readFile(daysFile(), 'utf8'));
  } catch {
    return [];
  }
}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function saveSiteSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  return serial(async () => {
    const cur = await readSiteSettings();
    const next: SiteSettings = { ...cur };
    if (patch.ga4Property !== undefined) {
      if (patch.ga4Property && !/^properties\/\d{1,20}$/.test(patch.ga4Property)) throw new PublishError('Pick a Google Analytics property from the list.', true);
      next.ga4Property = patch.ga4Property || undefined;
      next.ga4Name = patch.ga4Property ? String(patch.ga4Name ?? '').slice(0, 120) || undefined : undefined;
    }
    if (patch.gscSite !== undefined) {
      if (patch.gscSite && (patch.gscSite.length > 300 || !hostOfSite(patch.gscSite))) throw new PublishError('Pick a Search Console property from the list.', true);
      next.gscSite = patch.gscSite || undefined;
    }
    if (Array.isArray(patch.domains)) next.domains = [...new Set(patch.domains.map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter((d) => HOST_RE.test(d)))].slice(0, 10);
    if (typeof patch.utm === 'boolean') next.utm = patch.utm;
    await writeJson(join(siteDir(), 'settings.json'), next);
    return next;
  });
}

const recordSync = (patch: Pick<SiteSettings, 'lastSync' | 'lastError' | 'lastAttempt'>) =>
  serial(async () => {
    const cur = await readSiteSettings();
    await writeJson(join(siteDir(), 'settings.json'), { ...cur, ...patch, ...(patch.lastError === undefined ? { lastError: undefined } : {}) });
  });

// ── Google calls ───────────────────────────────────────────────────────

async function google<T>(url: string, init: RequestInit = {}, what = 'request'): Promise<T> {
  const token = await googleSiteAccess();
  const r = await providerFetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  if (r.status === 403) throw new PublishError('Google refused access — make sure this Google account can see the property (and that the Analytics Data, Analytics Admin and Search Console APIs are enabled for your Google app).', true);
  if (!r.ok) throw await providerFailure('Google', r, what);
  return (await r.json()) as T;
}

export interface PropertyChoice {
  id: string;
  name: string;
  account: string;
}

/** GA4 properties this Google account can read. */
export async function ga4Properties(): Promise<PropertyChoice[]> {
  const out: PropertyChoice[] = [];
  let page = '';
  for (let i = 0; i < 10; i++) {
    const j = await google<{ accountSummaries?: { displayName?: string; propertySummaries?: { property: string; displayName?: string }[] }[]; nextPageToken?: string }>(`${GA_ADMIN}/accountSummaries?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, {}, 'property list');
    for (const a of j.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ id: p.property, name: p.displayName ?? p.property, account: a.displayName ?? '' });
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return out;
}

/** Search Console properties this account can read. */
export async function searchSites(): Promise<{ id: string; permission: string }[]> {
  const j = await google<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(`${GSC}/sites`, {}, 'site list');
  return (j.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => ({ id: s.siteUrl, permission: s.permissionLevel }));
}

// ── mapping (pure, tested with fixtures) ───────────────────────────────

interface Ga4Report {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}
const gaDate = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);
const n = (v: string | number | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Merge GA4 reports (by date; by date × source; by date × campaign × source) into days. */
export function mapGa4(totals: Ga4Report, bySource: Ga4Report, byCampaign: Ga4Report): Map<string, SiteDay> {
  const days = new Map<string, SiteDay>();
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d }).get(d)!;
  for (const r of totals.rows ?? []) {
    const d = day(gaDate(r.dimensionValues[0].value));
    d.sessions = n(r.metricValues[0]?.value);
    d.users = n(r.metricValues[1]?.value);
    d.keyEvents = n(r.metricValues[2]?.value);
  }
  for (const r of bySource.rows ?? []) {
    const d = day(gaDate(r.dimensionValues[0].value));
    const src = (r.dimensionValues[1]?.value ?? '(not set)').toLowerCase().slice(0, 80);
    (d.bySource ??= {})[src] = { sessions: n(r.metricValues[0]?.value), keyEvents: n(r.metricValues[1]?.value) };
  }
  for (const r of byCampaign.rows ?? []) {
    const camp = r.dimensionValues[1]?.value ?? '';
    if (!camp.startsWith(UTM_PREFIX)) continue;
    const post = camp.slice(UTM_PREFIX.length);
    if (!/^[\w-]{1,80}$/.test(post)) continue;
    const d = day(gaDate(r.dimensionValues[0].value));
    const cur = (d.byCampaign ??= {})[post];
    const src = (r.dimensionValues[2]?.value ?? '').toLowerCase().slice(0, 80);
    d.byCampaign[post] = { sessions: (cur?.sessions ?? 0) + n(r.metricValues[0]?.value), keyEvents: (cur?.keyEvents ?? 0) + n(r.metricValues[1]?.value), ...(src ? { source: src } : cur?.source ? { source: cur.source } : {}) };
  }
  return days;
}

interface GscRows {
  rows?: { keys: string[]; clicks: number; impressions: number; position?: number }[];
}
/** Merge Search Console rows (by date; by date × query) into days. */
export function mapSearch(days: Map<string, SiteDay>, byDate: GscRows, byQuery: GscRows, top = 10): Map<string, SiteDay> {
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d }).get(d)!;
  for (const r of byDate.rows ?? []) day(r.keys[0]).search = { clicks: n(r.clicks), impressions: n(r.impressions), ...(r.position !== undefined ? { position: Math.round(n(r.position) * 10) / 10 } : {}) };
  const q = new Map<string, { query: string; clicks: number; impressions: number }[]>();
  for (const r of byQuery.rows ?? []) q.set(r.keys[0], [...(q.get(r.keys[0]) ?? []), { query: String(r.keys[1] ?? '').slice(0, 120), clicks: n(r.clicks), impressions: n(r.impressions) }]);
  for (const [d, rows] of q) day(d).topQueries = rows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, top);
  return days;
}

/** Replace the synced dates' rows, keep the rest (and at most ~13 months). */
export function mergeDays(old: SiteDay[], fresh: Map<string, SiteDay>, keep = 400): SiteDay[] {
  const all = new Map(old.map((d) => [d.date, d]));
  for (const [d, v] of fresh) all.set(d, { ...(all.get(d) ?? {}), ...v });
  return [...all.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-keep);
}

// ── sync ───────────────────────────────────────────────────────────────

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

async function ga4Report(property: string, body: Record<string, unknown>): Promise<Ga4Report> {
  return google<Ga4Report>(`${GA_DATA}/${property}:runReport`, { method: 'POST', body: JSON.stringify({ limit: 25_000, ...body }) }, 'Analytics report');
}
async function gscQuery(site: string, body: Record<string, unknown>): Promise<GscRows> {
  return google<GscRows>(`${GSC}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify({ dataState: 'all', ...body }) }, 'Search Console query');
}

export interface SiteSyncResult {
  days: number;
  from: string;
  to: string;
  ga4: boolean;
  search: boolean;
}

/** Pull the last `days` days (120 on the first sync, so reports have history) and cache them. */
export async function syncSite(opts: { days?: number; now?: Date } = {}): Promise<SiteSyncResult> {
  const s = await readSiteSettings();
  if (!s.ga4Property && !s.gscSite) throw new PublishError('Pick a Google Analytics property or a Search Console site first.', true);
  const old = await readDays();
  const span = opts.days ?? (old.length ? 10 : 120);
  const now = (opts.now ?? new Date()).getTime();
  const from = iso(now - span * 86_400_000), to = iso(now);
  const fresh = new Map<string, SiteDay>();
  try {
    if (s.ga4Property) {
      const range = { dateRanges: [{ startDate: from, endDate: to }] };
      const [totals, bySource, byCampaign] = await Promise.all([
        ga4Report(s.ga4Property, { ...range, dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }] }),
        ga4Report(s.ga4Property, { ...range, dimensions: [{ name: 'date' }, { name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }] }),
        ga4Report(s.ga4Property, { ...range, dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }, { name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], dimensionFilter: { filter: { fieldName: 'sessionCampaignName', stringFilter: { matchType: 'BEGINS_WITH', value: UTM_PREFIX } } } }),
      ]);
      for (const [d, v] of mapGa4(totals, bySource, byCampaign)) fresh.set(d, v);
    }
    if (s.gscSite) {
      const [byDate, byQuery] = await Promise.all([gscQuery(s.gscSite, { startDate: from, endDate: to, dimensions: ['date'], rowLimit: 1000 }), gscQuery(s.gscSite, { startDate: from, endDate: to, dimensions: ['date', 'query'], rowLimit: 25_000 })]);
      mapSearch(fresh, byDate, byQuery);
    }
  } catch (e) {
    await recordSync({ lastAttempt: new Date(now).toISOString(), lastError: (e as Error).message.slice(0, 300) });
    throw e;
  }
  await serial(async () => writeJson(daysFile(), mergeDays(await readDays(), fresh)));
  await recordSync({ lastSync: new Date(now).toISOString(), lastAttempt: new Date(now).toISOString(), lastError: undefined });
  return { days: fresh.size, from, to, ga4: !!s.ga4Property, search: !!s.gscSite };
}

export const SITE_SYNC_EVERY_MS = 6 * 3_600_000;

/** For the background pass: sync when connected, set up and not synced in the last six hours. */
export async function syncSiteIfDue(now = new Date()): Promise<SiteSyncResult | undefined> {
  const s = await readSiteSettings();
  if (!s.ga4Property && !s.gscSite) return undefined;
  // A failing sync waits its turn too, rather than hammering Google every tick.
  const last = s.lastAttempt ?? s.lastSync;
  if (last && now.getTime() - Date.parse(last) < SITE_SYNC_EVERY_MS) return undefined;
  if (!(await googleSiteConnected())) return undefined;
  return syncSite({ now });
}

export async function siteStatus() {
  const s = await readSiteSettings();
  const days = await readDays();
  return { ...DEFAULT_SITE, ...s, connected: await googleSiteConnected(), days: days.length, firstDay: days[0]?.date ?? null, lastDay: days.at(-1)?.date ?? null };
}
