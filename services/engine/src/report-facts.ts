import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { channel, listPosts, localParts, zonedToUtc, type ChannelId, type Post } from './calendar.ts';
import { audienceOf, computePerformance, headline, readSnapshots, weightedEngagement, type MetricSource, type Snapshot } from './metrics.ts';
import { featuresOf, readPlaybook, type Playbook } from './playbook.ts';
import { home } from './paths.ts';
import { listCampaigns } from './store.ts';
import type { Campaign } from './types.ts';

/**
 * The fact sheet behind a report: every number a report shows or says, worked
 * out here, deterministically, from stored data. The writer only turns these
 * into sentences (and may not use a number that isn't here).
 *
 * Periods are compared fairly: the previous period is read as it stood the same
 * time after it ended ("as of" shifted back by the period's length), so a week
 * whose posts are two days old is never compared with a week whose posts have
 * had a month to grow.
 */

const DAY = 86_400_000;

// ── periods ────────────────────────────────────────────────────────────

export type PeriodKind = 'last7' | 'last30' | 'lastMonth' | 'lastQuarter' | 'custom';

export interface Period {
  kind: PeriodKind;
  /** Inclusive start, exclusive end (UTC instants). */
  start: string;
  end: string;
  tz: string;
  label: string;
}

const fmtDay = (iso: string, tz: string, year = false) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(new Date(iso));
const monthStart = (y: number, m: number, tz: string) => zonedToUtc(`${y}-${String(m + 1).padStart(2, '0')}-01`, '00:00', tz);
const ymOf = (iso: string, tz: string) => {
  const [y, m] = localParts(iso, tz).date.split('-').map(Number);
  return { y, m: m - 1 };
};

export function labelFor(kind: PeriodKind, start: string, end: string, tz: string): string {
  if (kind === 'lastMonth') return new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long', year: 'numeric' }).format(new Date(start));
  if (kind === 'lastQuarter') {
    const { y, m } = ymOf(start, tz);
    return `Q${Math.floor(m / 3) + 1} ${y}`;
  }
  const last = new Date(Date.parse(end) - 1).toISOString();
  return `${fmtDay(start, tz)} – ${fmtDay(last, tz, true)}`;
}

/** The period a report covers, ending at (or just before) `asOf`. */
export function periodFor(kind: PeriodKind, asOf: Date, tz: string, custom?: { start: string; end: string }): Period {
  const make = (start: string, end: string): Period => ({ kind, start, end, tz, label: labelFor(kind, start, end, tz) });
  if (kind === 'custom') {
    if (!custom || !(Date.parse(custom.start) < Date.parse(custom.end))) throw new Error('A custom period needs a start before its end.');
    return make(new Date(custom.start).toISOString(), new Date(custom.end).toISOString());
  }
  if (kind === 'last7' || kind === 'last30') {
    // Rolling: the N days up to the moment the report is made.
    const n = kind === 'last7' ? 7 : 30;
    return make(new Date(asOf.getTime() - n * DAY).toISOString(), asOf.toISOString());
  }
  const { y, m } = ymOf(asOf.toISOString(), tz);
  if (kind === 'lastMonth') {
    const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
    return make(monthStart(py, pm, tz), monthStart(y, m, tz));
  }
  const q = Math.floor(m / 3);
  const py = q === 0 ? y - 1 : y, pq = q === 0 ? 3 : q - 1;
  return make(monthStart(py, pq * 3, tz), monthStart(y, q * 3, tz));
}

/** The same kind of period `n` steps earlier (calendar-aware for months and quarters). */
export function shiftPeriod(p: Period, n: number): Period {
  if (p.kind === 'lastMonth' || p.kind === 'lastQuarter') {
    const step = p.kind === 'lastMonth' ? 1 : 3;
    const { y, m } = ymOf(p.start, p.tz);
    const at = (k: number) => {
      const t = y * 12 + m + k;
      return monthStart(Math.floor(t / 12), ((t % 12) + 12) % 12, p.tz);
    };
    const start = at(n * step), end = at(n * step + step);
    return { ...p, start, end, label: labelFor(p.kind, start, end, p.tz) };
  }
  const len = Date.parse(p.end) - Date.parse(p.start);
  const start = new Date(Date.parse(p.start) + n * len).toISOString(), end = new Date(Date.parse(p.end) + n * len).toISOString();
  return { ...p, start, end, label: labelFor(p.kind, start, end, p.tz) };
}

const inPeriod = (iso: string | undefined, p: Pick<Period, 'start' | 'end'>) => !!iso && iso >= p.start && iso < p.end;

// ── inputs ─────────────────────────────────────────────────────────────

/** One day of website numbers (filled by the Google connection). */
export interface SiteDay {
  date: string;
  sessions?: number;
  users?: number;
  keyEvents?: number;
  /** Sessions and key events by source (lower-case, e.g. "linkedin.com", "google"). */
  bySource?: Record<string, { sessions: number; keyEvents: number }>;
  /** UTM campaign → visits; Shipcast tags its links with the post id. */
  byCampaign?: Record<string, { sessions: number; keyEvents: number; source?: string }>;
  search?: { clicks: number; impressions: number; position?: number };
  topQueries?: { query: string; clicks: number; impressions: number }[];
}

export interface Note {
  id: string;
  /** Local date the event happened (YYYY-MM-DD). */
  date: string;
  text: string;
  by?: string;
}

export const KPI_KEYS = ['posts', 'audience', 'engagement', 'rate', 'clicks', 'follows', 'sessions', 'keyEvents', 'searchClicks'] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export interface Goal {
  id: string;
  metric: KpiKey;
  target: number;
  per: 'week' | 'month' | 'quarter';
  channel?: ChannelId;
  label?: string;
}

export interface FactsInput {
  posts: Post[];
  snapshots: Snapshot[];
  campaigns: Pick<Campaign, 'id' | 'name' | 'createdAt' | 'steps'>[];
  playbook?: Playbook | null;
  notes?: Note[];
  goals?: Goal[];
  site?: SiteDay[];
  /** Whether a website source is connected (for coverage), even before it has rows. */
  siteConnected?: boolean;
}

// ── output ─────────────────────────────────────────────────────────────

export interface Totals {
  posts: number;
  /** Posts with at least one reading. */
  measured: number;
  audience: number;
  engagement: number;
  /** Weighted engagement per person reached (0–1+), when there is an audience. */
  rate?: number;
  clicks: number;
  follows: number;
}

export interface ChannelFacts extends Totals {
  channel: ChannelId;
  name: string;
  prev: Totals;
}

export interface Kpi {
  key: KpiKey;
  label: string;
  value: number;
  prev?: number;
  /** Fractional change vs the previous period (0.23 = +23 %); absent when the previous value is 0 or unknown. */
  change?: number;
  /** Oldest first, ending with this period. */
  series: number[];
  unit?: 'percent';
}

export interface PostFact {
  post: string;
  title: string;
  channel: ChannelId;
  at: string;
  url?: string;
  format?: string;
  pillar?: string;
  media?: string;
  experiment?: string;
  audience?: number;
  engagement?: number;
  lift?: number;
  /** Playbook wins this post had (labels). */
  why: string[];
  /** Site visits and key events from this post's tagged links. */
  visits?: number;
  keyEvents?: number;
}

export interface GoalFact extends Goal {
  label: string;
  window: { start: string; end: string; label: string };
  actual: number;
  /** Share of the window gone (0–1). */
  elapsed: number;
  /** Forecast: where the window ends at the current pace (absent too early to say). */
  projected?: number;
  onTrack?: boolean;
  /** What each remaining week needs to hit the target. */
  needPerWeek?: number;
  done: boolean;
}

export interface Notable {
  kind: 'high' | 'low' | 'streak-up' | 'streak-down';
  key: KpiKey;
  channel?: ChannelId;
  text: string;
  value: number;
  /** For highs/lows: how many periods back this is the highest/lowest of; for streaks: its length. */
  n: number;
}

export interface WorkFacts {
  published: number;
  byChannel: Partial<Record<ChannelId, number>>;
  posts: PostFact[];
  experiments: { post: string; title: string; experiment: string; lift?: number }[];
  campaigns: { id: string; name: string; created: boolean; pieces: number }[];
  pieces: number;
  upcoming: number;
}

export interface SiteFacts {
  sessions: number;
  users: number;
  keyEvents: number;
  prev: { sessions: number; users: number; keyEvents: number };
  /** Sessions and key events from social sources (by channel). */
  social: { channel: ChannelId; sessions: number; keyEvents: number }[];
  search?: { clicks: number; impressions: number; ctr?: number; position?: number; prev: { clicks: number; impressions: number } };
  topQueries: { query: string; clicks: number; impressions: number }[];
  days: number;
}

export interface Facts {
  version: 1;
  period: Period;
  prevPeriod: Period;
  asOf: string;
  totals: Totals;
  prev: Totals;
  kpis: Kpi[];
  channels: ChannelFacts[];
  /** Change in audience by channel; sums to the total change. */
  waterfall: { channel: ChannelId; name: string; delta: number }[];
  /** The total audience change split into "more posts" and "more per post" (sums exactly). */
  split?: { volume: number; quality: number; perPost: number; prevPerPost: number };
  top: PostFact[];
  bottom: PostFact[];
  work: WorkFacts;
  goals: GoalFact[];
  notable: Notable[];
  site?: SiteFacts;
  notes: Note[];
  playbook: { channel: ChannelId; wins: string[]; losses: string[] }[];
  coverage: { missing: { post: string; title: string; channel: ChannelId }[]; sources: Partial<Record<MetricSource, number>>; site: 'connected' | 'none'; messages: string[] };
}

// ── readings ───────────────────────────────────────────────────────────

const RANK: Record<MetricSource, number> = { youtube: 5, instagram: 5, linkedin: 5, postiz: 4, csv: 3, screenshot: 2, manual: 1 };

/** The newest reading of each post × channel taken at or before `asOf`. */
export function readingsAsOf(snaps: Snapshot[], asOf: string): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  for (const s of snaps) {
    if (s.at > asOf) continue;
    const k = `${s.post}|${s.channel}`;
    const cur = out.get(k);
    if (!cur || s.ageHours > cur.ageHours + 1 || (Math.abs(s.ageHours - cur.ageHours) <= 1 && RANK[s.source] > RANK[cur.source])) out.set(k, s);
  }
  return out;
}

const sentAt = (p: Post, ch: ChannelId) => p.channels.find((c) => c.channel === ch)?.sentAt ?? (p.status === 'published' ? p.at : undefined);

/** Channel-posts that went out in a period. */
export function publishedIn(posts: Post[], p: Pick<Period, 'start' | 'end'>): { post: Post; channel: ChannelId; at: string }[] {
  const out: { post: Post; channel: ChannelId; at: string }[] = [];
  for (const post of posts)
    for (const c of post.channels) {
      const at = sentAt(post, c.channel);
      if ((c.state === 'sent' || post.status === 'published') && inPeriod(at, p)) out.push({ post, channel: c.channel, at: at! });
    }
  return out;
}

const emptyTotals = (): Totals => ({ posts: 0, measured: 0, audience: 0, engagement: 0, clicks: 0, follows: 0 });

function totalsFor(items: { post: Post; channel: ChannelId }[], reads: Map<string, Snapshot>): Totals {
  const t = emptyTotals();
  for (const { post, channel: ch } of items) {
    t.posts++;
    const s = reads.get(`${post.id}|${ch}`);
    if (!s) continue;
    t.measured++;
    t.audience += audienceOf(s) ?? 0;
    t.engagement += weightedEngagement(s) ?? 0;
    t.clicks += s.clicks ?? 0;
    t.follows += s.follows ?? 0;
  }
  if (t.audience > 0) t.rate = t.engagement / t.audience;
  return t;
}

// ── site ───────────────────────────────────────────────────────────────

const SOCIAL_SOURCES: Partial<Record<ChannelId, RegExp>> = {
  linkedin: /(^|\.)linkedin|lnkd\.in/,
  youtube: /youtube|youtu\.be/,
  instagram: /instagram/,
  x: /(^|\W)(x\.com|t\.co|twitter)/,
  facebook: /facebook|fb\.com|^fb$/,
  tiktok: /tiktok/,
  threads: /threads/,
  pinterest: /pinterest|pin\.it/,
};
export function channelOfSource(src: string): ChannelId | undefined {
  const s = src.toLowerCase();
  return (Object.entries(SOCIAL_SOURCES) as [ChannelId, RegExp][]).find(([, re]) => re.test(s))?.[0];
}

function siteDaysIn(site: SiteDay[], p: Period): SiteDay[] {
  const a = localParts(p.start, p.tz).date;
  const b = localParts(new Date(Date.parse(p.end) - 1).toISOString(), p.tz).date;
  return site.filter((d) => d.date >= a && d.date <= b);
}

function siteTotals(days: SiteDay[]) {
  return days.reduce((t, d) => ({ sessions: t.sessions + (d.sessions ?? 0), users: t.users + (d.users ?? 0), keyEvents: t.keyEvents + (d.keyEvents ?? 0) }), { sessions: 0, users: 0, keyEvents: 0 });
}

function searchTotals(days: SiteDay[]) {
  const s = days.filter((d) => d.search);
  if (!s.length) return undefined;
  const clicks = s.reduce((a, d) => a + d.search!.clicks, 0);
  const impressions = s.reduce((a, d) => a + d.search!.impressions, 0);
  const wpos = s.filter((d) => d.search!.position !== undefined && d.search!.impressions > 0);
  const position = wpos.length ? wpos.reduce((a, d) => a + d.search!.position! * d.search!.impressions, 0) / wpos.reduce((a, d) => a + d.search!.impressions, 0) : undefined;
  return { clicks, impressions, ...(impressions ? { ctr: clicks / impressions } : {}), ...(position !== undefined ? { position: Math.round(position * 10) / 10 } : {}) };
}

function siteFacts(site: SiteDay[], p: Period, prev: Period): SiteFacts | undefined {
  const days = siteDaysIn(site, p);
  if (!days.length) return undefined;
  const pdays = siteDaysIn(site, prev);
  const social = new Map<ChannelId, { sessions: number; keyEvents: number }>();
  for (const d of days)
    for (const [src, v] of Object.entries(d.bySource ?? {})) {
      const ch = channelOfSource(src);
      if (!ch) continue;
      const cur = social.get(ch) ?? { sessions: 0, keyEvents: 0 };
      social.set(ch, { sessions: cur.sessions + v.sessions, keyEvents: cur.keyEvents + v.keyEvents });
    }
  const q = new Map<string, { clicks: number; impressions: number }>();
  for (const d of days) for (const t of d.topQueries ?? []) q.set(t.query, { clicks: (q.get(t.query)?.clicks ?? 0) + t.clicks, impressions: (q.get(t.query)?.impressions ?? 0) + t.impressions });
  const search = searchTotals(days);
  const psearch = searchTotals(pdays);
  return {
    ...siteTotals(days),
    prev: siteTotals(pdays),
    social: [...social.entries()].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.sessions - a.sessions),
    ...(search ? { search: { ...search, prev: { clicks: psearch?.clicks ?? 0, impressions: psearch?.impressions ?? 0 } } } : {}),
    topQueries: [...q.entries()].map(([query, v]) => ({ query, ...v })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 5),
    days: days.length,
  };
}

/** Visits and key events credited to a post by its UTM campaign (the post id). */
function visitsFor(site: SiteDay[], post: string, ch: ChannelId, from: string): { visits: number; keyEvents: number } | undefined {
  let visits = 0, keyEvents = 0, seen = false;
  for (const d of site) {
    if (d.date < from.slice(0, 10)) continue;
    const v = d.byCampaign?.[post];
    if (!v || (v.source && channelOfSource(v.source) && channelOfSource(v.source) !== ch)) continue;
    seen = true;
    visits += v.sessions;
    keyEvents += v.keyEvents;
  }
  return seen ? { visits, keyEvents } : undefined;
}

// ── stats ──────────────────────────────────────────────────────────────

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Robust z-score: distance from the median in MADs (scaled to match a standard deviation). */
export function robustZ(x: number, history: number[]): number | undefined {
  if (history.length < 4) return undefined;
  const med = median(history);
  const mad = median(history.map((h) => Math.abs(h - med))) * 1.4826;
  if (mad === 0) return x === med ? 0 : undefined;
  return (x - med) / mad;
}

/** Length of the run of strict rises (positive) or falls (negative) ending at the last value. */
export function streak(series: number[]): number {
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) {
    const d = series[i] - series[i - 1];
    if (d === 0) break;
    const dir = d > 0 ? 1 : -1;
    if (n !== 0 && Math.sign(n) !== dir) break;
    n += dir;
  }
  return n;
}

/** Splits A₁ − A₀ = posts × per-post exactly into a volume part and a quality part (midpoint / Shapley split). */
export function volumeQuality(n0: number, a0: number, n1: number, a1: number): { volume: number; quality: number; perPost: number; prevPerPost: number } | undefined {
  if (!n0 || !n1) return undefined;
  const q0 = a0 / n0, q1 = a1 / n1;
  // Rounded so the two parts still add up to the whole change.
  const volume = Math.round(((n1 - n0) * (q1 + q0)) / 2);
  return { volume, quality: a1 - a0 - volume, perPost: Math.round(q1), prevPerPost: Math.round(q0) };
}

const change = (v: number, p: number | undefined) => (p !== undefined && p > 0 ? v / p - 1 : undefined);

// ── build ──────────────────────────────────────────────────────────────

export const KPI_LABELS: Record<KpiKey, string> = {
  posts: 'Posts published',
  audience: 'People reached',
  engagement: 'Engagement',
  rate: 'Engagement rate',
  clicks: 'Link clicks',
  follows: 'New followers',
  sessions: 'Website visits',
  keyEvents: 'Key events',
  searchClicks: 'Search clicks',
};

const SERIES = 12;

function kpiValue(key: KpiKey, t: Totals, site?: { sessions: number; keyEvents: number; searchClicks?: number }): number | undefined {
  switch (key) {
    case 'posts': return t.posts;
    case 'audience': return t.audience;
    case 'engagement': return t.engagement;
    case 'rate': return t.rate === undefined ? undefined : Math.round(t.rate * 10_000) / 100;
    case 'clicks': return t.clicks;
    case 'follows': return t.follows;
    case 'sessions': return site?.sessions;
    case 'keyEvents': return site?.keyEvents;
    case 'searchClicks': return site?.searchClicks;
  }
}

function postFact(post: Post, ch: ChannelId, at: string, perf: ReturnType<typeof computePerformance>, reads: Map<string, Snapshot>, pb: Playbook | null | undefined, site: SiteDay[]): PostFact {
  const c = post.channels.find((x) => x.channel === ch)!;
  const h = headline(perf, post.id, ch);
  const s = reads.get(`${post.id}|${ch}`);
  const f = featuresOf(post, ch);
  const wins = pb?.channels.find((x) => x.channel === ch)?.wins ?? [];
  const why = f ? wins.filter((w) => w.confidence !== 'low' && f[w.feature] === w.level).map((w) => w.label) : [];
  const v = visitsFor(site, post.id, ch, at);
  const aud = s ? audienceOf(s) : undefined;
  const eng = s ? weightedEngagement(s) : undefined;
  return {
    post: post.id,
    title: post.title,
    channel: ch,
    at,
    ...(c.url ? { url: c.url } : {}),
    ...(post.format ? { format: post.format } : {}),
    ...(post.pillar ? { pillar: post.pillar } : {}),
    ...(c.media[0] ? { media: c.media[0] } : {}),
    ...(post.experiment ? { experiment: post.experiment } : {}),
    ...(aud !== undefined ? { audience: aud } : {}),
    ...(eng !== undefined ? { engagement: eng } : {}),
    ...(h?.lift !== undefined ? { lift: h.lift } : {}),
    why,
    ...(v ? { visits: v.visits, keyEvents: v.keyEvents } : {}),
  };
}

function goalWindow(per: Goal['per'], asOf: Date, tz: string): Period {
  if (per === 'week') {
    // Monday-based local week containing asOf.
    const today = localParts(asOf.toISOString(), tz).date;
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const mon = new Date(Date.parse(`${today}T12:00:00Z`) - dow * DAY).toISOString().slice(0, 10);
    const sun = new Date(Date.parse(`${mon}T12:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
    const start = zonedToUtc(mon, '00:00', tz), end = zonedToUtc(sun, '00:00', tz);
    return { kind: 'custom', start, end, tz, label: `week of ${fmtDay(start, tz)}` };
  }
  const { y, m } = ymOf(asOf.toISOString(), tz);
  const step = per === 'month' ? 1 : 3;
  const m0 = per === 'month' ? m : Math.floor(m / 3) * 3;
  const t = y * 12 + m0 + step;
  const start = monthStart(y, m0, tz), end = monthStart(Math.floor(t / 12), t % 12, tz);
  return { kind: per === 'month' ? 'lastMonth' : 'lastQuarter', start, end, tz, label: labelFor(per === 'month' ? 'lastMonth' : 'lastQuarter', start, end, tz) };
}

export function buildFacts(input: FactsInput, period: Period, asOf: Date = new Date()): Facts {
  const asOfIso = asOf.toISOString();
  const prevPeriod = shiftPeriod(period, -1);
  const site = input.site ?? [];
  const perf = computePerformance(input.snapshots.filter((s) => s.at <= asOfIso));
  const lag = (p: Period) => new Date(asOf.getTime() - (Date.parse(period.end) - Date.parse(p.end))).toISOString();
  const readsNow = readingsAsOf(input.snapshots, asOfIso);

  // Per period (this one and the history before it), read as of the same lag after its end.
  const history = Array.from({ length: SERIES }, (_, i) => {
    const p = i === 0 ? period : shiftPeriod(period, -i);
    const reads = i === 0 ? readsNow : readingsAsOf(input.snapshots, lag(p));
    const items = publishedIn(input.posts, p);
    const st = siteTotals(siteDaysIn(site, p));
    const sc = searchTotals(siteDaysIn(site, p));
    const byChannel = new Map<ChannelId, Totals>();
    for (const ch of new Set(items.map((x) => x.channel))) byChannel.set(ch, totalsFor(items.filter((x) => x.channel === ch), reads));
    return { p, items, totals: totalsFor(items, reads), byChannel, site: { sessions: st.sessions, keyEvents: st.keyEvents, ...(sc ? { searchClicks: sc.clicks } : {}) }, siteDays: siteDaysIn(site, p).length };
  }).reverse();
  const cur = history[history.length - 1];
  const prev = history[history.length - 2];
  // Periods before the first post (or first site day) aren't history, just emptiness.
  const firstAny = Math.min(
    ...input.posts.flatMap((p) => [p.createdAt, ...p.channels.map((c) => c.sentAt)]).map((x) => (x ? Date.parse(x) : NaN)).filter(Number.isFinite),
    ...input.snapshots.map((x) => Date.parse(x.at) - x.ageHours * 3_600_000),
    ...site.map((d) => Date.parse(`${d.date}T00:00:00Z`)),
  );
  const live = history.filter((h, i) => i >= history.length - 2 || Date.parse(h.p.end) > firstAny);

  const hasSite = site.length > 0;
  const kpis: Kpi[] = KPI_KEYS.filter((k) => (['sessions', 'keyEvents'].includes(k) ? hasSite && cur.siteDays > 0 : k === 'searchClicks' ? cur.site.searchClicks !== undefined : true)).flatMap((key) => {
    const v = kpiValue(key, cur.totals, cur.site);
    if (v === undefined) return [];
    const pv = kpiValue(key, prev.totals, prev.siteDays ? prev.site : undefined);
    const series = live.map((h) => kpiValue(key, h.totals, h.siteDays ? h.site : undefined) ?? 0);
    return [{ key, label: KPI_LABELS[key], value: Math.round(v * 100) / 100, ...(pv !== undefined ? { prev: Math.round(pv * 100) / 100 } : {}), ...(change(v, pv) !== undefined ? { change: Math.round(change(v, pv)! * 1000) / 1000 } : {}), series, ...(key === 'rate' ? { unit: 'percent' as const } : {}) }];
  });

  const chans = [...new Set([...cur.byChannel.keys(), ...prev.byChannel.keys()])].sort();
  const channels: ChannelFacts[] = chans.map((ch) => ({ channel: ch, name: channel(ch)?.name ?? ch, ...(cur.byChannel.get(ch) ?? emptyTotals()), prev: prev.byChannel.get(ch) ?? emptyTotals() }));
  const waterfall = channels.map((c) => ({ channel: c.channel, name: c.name, delta: c.audience - c.prev.audience })).filter((w) => w.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const split = volumeQuality(prev.totals.measured, prev.totals.audience, cur.totals.measured, cur.totals.audience);

  const facts = cur.items.map(({ post, channel: ch, at }) => postFact(post, ch, at, perf, readsNow, input.playbook, site));
  const ranked = facts.filter((f) => f.lift !== undefined).sort((a, b) => b.lift! - a.lift!);
  const byAudience = facts.filter((f) => f.lift === undefined && f.audience !== undefined).sort((a, b) => b.audience! - a.audience!);
  const top = (ranked.length ? ranked : byAudience).slice(0, 3);
  const bottom = ranked.length >= 5 ? ranked.slice(-2).reverse().filter((f) => f.lift! < 1 && !top.includes(f)) : [];

  // Work done.
  const byChannel: Partial<Record<ChannelId, number>> = {};
  for (const f of facts) byChannel[f.channel] = (byChannel[f.channel] ?? 0) + 1;
  const camps = input.campaigns
    .map((c) => ({ id: c.id, name: c.name, created: inPeriod(c.createdAt, period), pieces: c.steps.filter((s) => s.kind === 'pack' && s.status === 'done' && inPeriod(s.endedAt, period)).length }))
    .filter((c) => c.created || c.pieces > 0);
  const nextWeek = { start: asOfIso, end: new Date(asOf.getTime() + 7 * DAY).toISOString() };
  const work: WorkFacts = {
    published: facts.length,
    byChannel,
    posts: [...facts].sort((a, b) => a.at.localeCompare(b.at)),
    experiments: [...new Map(facts.filter((f) => f.experiment).map((f) => [f.post, { post: f.post, title: f.title, experiment: f.experiment!, ...(f.lift !== undefined ? { lift: f.lift } : {}) }])).values()],
    campaigns: camps,
    pieces: camps.reduce((a, c) => a + c.pieces, 0),
    upcoming: input.posts.filter((p) => ['scheduled', 'ready'].includes(p.status) && inPeriod(p.at, nextWeek)).length,
  };

  // Goals.
  const goals: GoalFact[] = (input.goals ?? []).map((g) => {
    const w = goalWindow(g.per, asOf, period.tz);
    const items = publishedIn(input.posts, w).filter((x) => x.at <= asOfIso && (!g.channel || x.channel === g.channel));
    const t = totalsFor(items, readsNow);
    const sd = siteDaysIn(site, w);
    const actual = kpiValue(g.metric, t, { ...siteTotals(sd), searchClicks: searchTotals(sd)?.clicks ?? 0 }) ?? 0;
    const len = Date.parse(w.end) - Date.parse(w.start);
    const elapsed = Math.min(1, Math.max(0, (asOf.getTime() - Date.parse(w.start)) / len));
    const rate = g.metric === 'rate';
    const projected = rate ? actual : elapsed >= 0.2 ? actual / elapsed : undefined;
    const weeksLeft = ((1 - elapsed) * len) / (7 * DAY);
    const label = g.label || `${KPI_LABELS[g.metric]}${g.channel ? ` on ${channel(g.channel)?.name ?? g.channel}` : ''}`;
    return {
      ...g,
      label,
      window: { start: w.start, end: w.end, label: w.label },
      actual: Math.round(actual * 100) / 100,
      elapsed: Math.round(elapsed * 100) / 100,
      ...(projected !== undefined ? { projected: Math.round(projected), onTrack: projected >= g.target } : {}),
      ...(!rate && actual < g.target && weeksLeft >= 0.5 ? { needPerWeek: Math.ceil((g.target - actual) / weeksLeft) } : {}),
      done: actual >= g.target,
    };
  });

  // Notable: unusual highs/lows against your own history, and runs of growth or decline.
  const notable: Notable[] = [];
  const seriesOf = (key: KpiKey, ch?: ChannelId) => live.map((h) => kpiValue(key, ch ? h.byChannel.get(ch) ?? emptyTotals() : h.totals, h.siteDays ? h.site : undefined) ?? 0);
  const scopes: (ChannelId | undefined)[] = [undefined, ...chans];
  for (const key of ['audience', 'engagement', 'follows', 'clicks', 'sessions', 'keyEvents'] as KpiKey[])
    for (const ch of scopes) {
      if (ch && ['sessions', 'keyEvents'].includes(key)) continue;
      const s = seriesOf(key, ch);
      const x = s[s.length - 1];
      const before = s.slice(0, -1);
      const where = ch ? ` on ${channel(ch)?.name ?? ch}` : '';
      const z = robustZ(x, before);
      if (z !== undefined && Math.abs(z) >= 2 && x > 0) {
        const high = z > 0;
        const n = (() => {
          let k = 0;
          for (let i = before.length - 1; i >= 0 && (high ? before[i] < x : before[i] > x); i--) k++;
          return k + 1;
        })();
        if (n >= 4) notable.push({ kind: high ? 'high' : 'low', key, ...(ch ? { channel: ch } : {}), value: x, n, text: `${KPI_LABELS[key]}${where}: ${high ? 'highest' : 'lowest'} in ${n === s.length ? 'all' : n} ${period.kind === 'lastMonth' ? 'months' : period.kind === 'lastQuarter' ? 'quarters' : 'periods'} on record` });
      }
      const st = streak(s);
      if (Math.abs(st) >= 3 && !(key === 'clicks' || key === 'keyEvents')) notable.push({ kind: st > 0 ? 'streak-up' : 'streak-down', key, ...(ch ? { channel: ch } : {}), value: x, n: Math.abs(st), text: `${KPI_LABELS[key]}${where} ${st > 0 ? 'grew' : 'fell'} ${Math.abs(st)} periods in a row` });
    }
  // Channel-level highs repeat the total when one channel carries it; keep the strongest few.
  notable.sort((a, b) => b.n - a.n);
  const notableTop = notable.slice(0, 5);

  // Coverage: what the report can't see.
  const missing = cur.items.filter(({ post, channel: ch }) => !readsNow.has(`${post.id}|${ch}`)).map(({ post, channel: ch }) => ({ post: post.id, title: post.title, channel: ch }));
  const sources: Partial<Record<MetricSource, number>> = {};
  for (const { post, channel: ch } of cur.items) {
    const s = readsNow.get(`${post.id}|${ch}`);
    if (s) sources[s.source] = (sources[s.source] ?? 0) + 1;
  }
  const messages: string[] = [];
  if (missing.length) messages.push(`${missing.length} published post${missing.length === 1 ? ' has' : 's have'} no numbers yet.`);
  if (!input.siteConnected && !hasSite) messages.push('Website numbers are not connected (Settings → Website).');
  else if (!cur.siteDays) messages.push('No website numbers for this period yet.');
  if (!input.playbook?.channels.some((c) => c.ready)) messages.push('Not enough history yet to explain what works.');

  const notes = (input.notes ?? []).filter((n) => {
    const a = localParts(prevPeriod.start, period.tz).date, b = localParts(new Date(Date.parse(period.end) - 1).toISOString(), period.tz).date;
    return n.date >= a && n.date <= b;
  });

  return {
    version: 1,
    period,
    prevPeriod,
    asOf: asOfIso,
    totals: cur.totals,
    prev: prev.totals,
    kpis,
    channels,
    waterfall,
    ...(split ? { split } : {}),
    top,
    bottom,
    work,
    goals,
    notable: notableTop,
    ...(hasSite ? (() => {
      const s = siteFacts(site, period, prevPeriod);
      return s ? { site: s } : {};
    })() : {}),
    notes,
    playbook: (input.playbook?.channels ?? []).filter((c) => c.ready && chans.includes(c.channel)).map((c) => ({ channel: c.channel, wins: c.wins.filter((w) => w.confidence !== 'low').slice(0, 3).map((w) => w.label), losses: c.losses.filter((w) => w.confidence !== 'low').slice(0, 2).map((w) => w.label) })),
    coverage: { missing, sources, site: input.siteConnected || hasSite ? 'connected' : 'none', messages },
  };
}

// ── gathering from the workspace ───────────────────────────────────────

export const reportsDir = () => join(home(), 'reports');

async function readJson<T>(f: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return fallback;
  }
}

export const readNotes = () => readJson<Note[]>(join(reportsDir(), 'notes.json'), []);
export const readGoals = () => readJson<Goal[]>(join(reportsDir(), 'goals.json'), []);
export const readSiteDays = () => readJson<SiteDay[]>(join(home(), 'site', 'days.json'), []);

/** Everything a fact sheet needs, from the current workspace. */
export async function gatherFacts(period: Period, asOf = new Date(), extra: { siteConnected?: boolean } = {}): Promise<Facts> {
  const [posts, snapshots, campaigns, playbook, notes, goals, site] = await Promise.all([listPosts(), readSnapshots(), listCampaigns(), readPlaybook(), readNotes(), readGoals(), readSiteDays()]);
  return buildFacts({ posts, snapshots, campaigns, playbook, notes, goals, site, siteConnected: extra.siteConnected }, period, asOf);
}
