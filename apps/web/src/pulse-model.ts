// Pure Pulse logic for the web app: how lifts, forecasts and heat read, which numbers each
// channel asks for, and a few mirrors of the engine (metrics.ts, playbook.ts) so the UI can
// explain a forecast. No DOM, no React. Types mirror the engine's JSON.
import { localParts, type ChannelId, type Post, type PostChannel } from './calendar-model.ts';

export type { ChannelId };
export const METRIC_KEYS = ['impressions', 'reach', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks', 'follows', 'avgViewPct'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricSource = 'manual' | 'csv' | 'screenshot' | 'youtube' | 'postiz' | 'instagram' | 'linkedin';
export type AgeBucket = '1d' | '3d' | '7d' | '30d';

export interface Snapshot extends Partial<Record<MetricKey, number>> {
  id: string;
  post: string;
  channel: ChannelId;
  at: string;
  ageHours: number;
  source: MetricSource;
}
export interface Performance {
  post: string;
  channel: ChannelId;
  bucket: AgeBucket;
  ageHours: number;
  audience?: number;
  engagement?: number;
  rate?: number;
  liftAudience?: number;
  liftEngagement?: number;
  lift?: number;
  baselineN: number;
  source: MetricSource;
}
export type Confidence = 'high' | 'medium' | 'low';
export interface Effect { feature: string; level: string; effect: number; lo: number; hi: number; n: number; confidence: Confidence; posts: string[] }
export interface PlaybookFinding extends Effect { label: string }
export interface HeatCell { weekday: string; hour: string; lift: number; n: number; posts: string[] }
export interface ChannelModel { channel: ChannelId; n: number; sigma: number; effects: Effect[] }
export interface ChannelPlaybook { channel: ChannelId; n: number; ready: boolean; message?: string; wins: PlaybookFinding[]; losses: PlaybookFinding[]; heat: HeatCell[]; bestSlots: HeatCell[]; narrative?: string[]; model?: ChannelModel }
export interface Playbook { computedAt: string; channels: ChannelPlaybook[] }
export interface Forecast { channel: ChannelId; lift: number; lo: number; hi: number; label: string; unseen: string[] }
export interface Calibration { n: number; inside: number | null; rank: number | null; rows: { post: string; channel: ChannelId; lift: number; lo: number; hi: number; actual: number; inBand: boolean }[] }
export interface CriticCalibration { n: number; rank: number | null; rows: { post: string; critic: number; lift: number }[] }
export interface PendingNumbers { post: string; title: string; channel: ChannelId; bucket: AgeBucket; since: string; notified: boolean }
export interface ScreenshotReading { values: Partial<Record<MetricKey, number>>; seen: { date?: string; title?: string }; dropped: string[] }

/** Engine constants the empty states explain. */
export const MIN_BASELINE = 3;
export const MIN_POSTS = 6;

// ── numbers ────────────────────────────────────────────────────────────

/** A number as platforms print it ("1.2K", "3,410", "12 %"); undefined when it isn't one. Mirrors the engine's parseMetricNumber. */
export function parseMetric(v: string): number | undefined {
  const s = v.trim().replace(/,/g, '').replace(/%$/, '').trim();
  if (!s) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** 842 · 1.2K · 12K · 3.4M */
export function fmtCount(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const short = (x: number, s: string) => `${x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')}${s}`;
  return a >= 1e6 ? short(n / 1e6, 'M') : a >= 1e4 ? short(n / 1e3, 'K') : a >= 1e3 ? short(n / 1e3, 'K') : String(Math.round(n * 10) / 10);
}

/** 2.1× · 0.6× · 12× */
export const fmtX = (x: number) => `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;

// ── lift ──────────────────────────────────────────────────────────────

export type Tone = 'up' | 'down' | 'flat' | 'none';
/** Within ±5 % of usual reads as "about usual": the noise floor of a handful of posts. */
export const liftTone = (lift?: number): Tone => (lift === undefined || !(lift > 0) ? 'none' : lift >= 1.05 ? 'up' : lift <= 0.95 ? 'down' : 'flat');

/** The calendar badge: ▲2.1× / ▼0.6× / ≈1.0× / — (no baseline yet). */
export function liftBadge(lift?: number): { text: string; tone: Tone; label: string } {
  const tone = liftTone(lift);
  if (tone === 'none') return { text: '—', tone, label: 'No baseline yet' };
  const x = fmtX(lift!);
  return { text: tone === 'up' ? `▲${x}` : tone === 'down' ? `▼${x}` : `≈${x}`, tone, label: `${x} your usual` };
}

/** How strongly a published post's calendar chip is tinted: 0 at usual, 1 at 3× either way. */
export const heatStrength = (lift?: number) => (lift && lift > 0 ? Math.min(1, Math.abs(Math.log(lift)) / Math.log(3)) : 0);

/** Which comparison age a reading counts for (±40 % of the bucket; 30 d takes anything past three weeks). Mirrors the engine. */
export function bucketOf(ageHours: number): AgeBucket | null {
  for (const [id, h] of [['1d', 24], ['3d', 72], ['7d', 168], ['30d', 720]] as const) if (ageHours >= h * 0.6 && ageHours <= h * 1.4) return id;
  return ageHours > 500 ? '30d' : null;
}

export const BUCKET_LABEL: Record<AgeBucket, string> = { '1d': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days' };
export const BUCKET_ADJ: Record<AgeBucket, string> = { '1d': '1-day', '3d': '3-day', '7d': '7-day', '30d': '30-day' };

/** The headline reading for a post's channel: the oldest bucket with a lift (most settled), else the oldest at all. Mirrors the engine. */
export function headlineOf(perf: Performance[], post: string, ch: ChannelId): Performance | undefined {
  const order: AgeBucket[] = ['30d', '7d', '3d', '1d'];
  const mine = perf.filter((p) => p.post === post && p.channel === ch);
  return order.map((b) => mine.find((p) => p.bucket === b && p.lift !== undefined)).find(Boolean) ?? order.map((b) => mine.find((p) => p.bucket === b)).find(Boolean);
}

/** One badge for a post: the channel with the most settled lift, first channel first on ties. */
export function postHeadline(perf: Performance[], p: Pick<Post, 'id' | 'channels'>): Performance | undefined {
  const hs = p.channels.map((c) => headlineOf(perf, p.id, c.channel)).filter((h): h is Performance => !!h);
  return hs.find((h) => h.lift !== undefined) ?? hs[0];
}

/** "2.1× your usual reach and engagement at 7 days, vs 14 posts" */
export function liftHeadline(h: Performance, channelName: string): string {
  const age = BUCKET_LABEL[h.bucket];
  if (h.lift === undefined) return `No baseline yet — your usual on ${channelName} at ${age} needs ${MIN_BASELINE} other posts with numbers (${h.baselineN} so far).`;
  const what = h.liftAudience !== undefined && h.liftEngagement !== undefined ? 'reach and engagement' : h.liftAudience !== undefined ? 'reach' : 'engagement';
  return `${fmtX(h.lift)} your usual ${what} at ${age}, vs ${h.baselineN} post${h.baselineN === 1 ? '' : 's'}`;
}

// ── forecast ──────────────────────────────────────────────────────────

/** The small calendar hint: always a tilde, never a badge — it isn't a result. */
export const forecastHint = (f: Pick<Forecast, 'lift'>) => `~${fmtX(f.lift)}`;
export const forecastLabel = (f: Pick<Forecast, 'lo' | 'hi'>) => `Forecast: likely ${f.lo.toFixed(1)}–${f.hi.toFixed(1)}× your usual`;

/** Where the band and point sit on a 0.25×–4× log axis, as percentages. */
export function bandPos(f: Pick<Forecast, 'lift' | 'lo' | 'hi'>, span = Math.log(4)): { lo: number; hi: number; at: number } {
  const p = (x: number) => Math.max(0, Math.min(100, 50 + (Math.log(Math.max(x, 1e-3)) / span) * 50));
  return { lo: p(f.lo), hi: p(f.hi), at: p(f.lift) };
}

// ── manual entry ──────────────────────────────────────────────────────

/** The numbers each platform actually shows, in the order its stats screen lists them (5–7 each). */
export const CHANNEL_FIELDS: Record<ChannelId, MetricKey[]> = {
  linkedin: ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks', 'follows'],
  instagram: ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'follows'],
  youtube: ['views', 'likes', 'comments', 'shares', 'follows', 'avgViewPct'],
  tiktok: ['views', 'likes', 'comments', 'shares', 'saves', 'follows'],
  x: ['impressions', 'likes', 'comments', 'shares', 'saves', 'clicks'],
  threads: ['views', 'likes', 'comments', 'shares', 'follows'],
  facebook: ['reach', 'impressions', 'likes', 'comments', 'shares', 'clicks'],
  pinterest: ['impressions', 'saves', 'clicks', 'likes', 'comments'],
  newsletter: ['reach', 'views', 'clicks', 'shares', 'follows'],
  blog: ['views', 'reach', 'clicks', 'comments', 'shares'],
};
const BASE_LABEL: Record<MetricKey, string> = { impressions: 'Impressions', reach: 'Reach', views: 'Views', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', clicks: 'Clicks', follows: 'Follows', avgViewPct: 'Avg. viewed %' };
// Each platform's own words, so the form reads like the screen the numbers come from.
const CHANNEL_LABEL: Partial<Record<ChannelId, Partial<Record<MetricKey, string>>>> = {
  linkedin: { reach: 'Members reached', likes: 'Reactions', shares: 'Reposts', follows: 'Followers gained' },
  instagram: { reach: 'Accounts reached', follows: 'Follows' },
  youtube: { follows: 'Subscribers gained', avgViewPct: 'Avg. % viewed' },
  x: { comments: 'Replies', shares: 'Reposts', saves: 'Bookmarks', clicks: 'Link clicks' },
  threads: { comments: 'Replies', shares: 'Reposts' },
  facebook: { likes: 'Reactions' },
  pinterest: { saves: 'Saves', clicks: 'Outbound clicks', likes: 'Reactions' },
  newsletter: { reach: 'Delivered', views: 'Opens', shares: 'Forwards', follows: 'New subscribers' },
  blog: { reach: 'Visitors' },
};
export const fieldsFor = (ch: ChannelId): MetricKey[] => CHANNEL_FIELDS[ch] ?? ['reach', 'likes', 'comments', 'shares', 'clicks'];
export const metricLabel = (ch: ChannelId, k: MetricKey) => CHANNEL_LABEL[ch]?.[k] ?? BASE_LABEL[k];

export const SOURCE_LABEL: Record<MetricSource, string> = { manual: 'Typed', csv: 'CSV export', screenshot: 'Screenshot', youtube: 'YouTube', postiz: 'Postiz', instagram: 'Instagram', linkedin: 'LinkedIn' };

/** Check a quick-form draft: parsed values, and the fields that aren't numbers. */
export function readForm(values: Partial<Record<MetricKey, string>>): { values: Partial<Record<MetricKey, number>>; bad: MetricKey[] } {
  const out: Partial<Record<MetricKey, number>> = {};
  const bad: MetricKey[] = [];
  for (const [k, v] of Object.entries(values) as [MetricKey, string][]) {
    if (!v?.trim()) continue;
    const n = parseMetric(v);
    if (n === undefined || (k === 'avgViewPct' && n > 100)) bad.push(k);
    else out[k] = n;
  }
  return { values: out, bad };
}

/** Who saw it and what they did with it — the two series the snapshot chart draws. Mirrors the engine. */
export const audienceOf = (s: Partial<Snapshot>) => s.reach ?? s.impressions ?? s.views;
export function engagementOf(s: Partial<Snapshot>): number | undefined {
  if ([s.likes, s.comments, s.shares, s.saves, s.clicks].every((x) => x === undefined)) return undefined;
  return (s.likes ?? 0) + 2 * (s.comments ?? 0) + 3 * (s.shares ?? 0) + 3 * (s.saves ?? 0) + (s.clicks ?? 0);
}

/** Points for a step chart over post age, scaled into a w×h box (age on a sqrt axis so the first day isn't squashed). */
export function stepChart(snaps: Pick<Snapshot, 'ageHours'>[], value: (s: never) => number | undefined, w: number, h: number, maxAge = 168): { x: number; y: number; v: number; age: number }[] {
  const pts = snaps.map((s) => ({ age: s.ageHours, v: value(s as never) })).filter((p): p is { age: number; v: number } => p.v !== undefined).sort((a, b) => a.age - b.age);
  if (!pts.length) return [];
  const top = Math.max(...pts.map((p) => p.v)) || 1;
  const span = Math.sqrt(Math.max(maxAge, pts[pts.length - 1].age));
  return pts.map((p) => ({ ...p, x: (Math.sqrt(p.age) / span) * w, y: h - (p.v / top) * h }));
}
/** Numbers only grow after posting, so the line starts at zero and steps up at each reading. */
export const stepPath = (pts: { x: number; y: number }[], h: number) => (pts.length ? `M0 ${h} ${pts.map((p) => `H${p.x.toFixed(1)} V${p.y.toFixed(1)}`).join(' ')}` : '');

export function ageLabel(hours: number): string {
  return hours < 36 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
}

// ── playbook ──────────────────────────────────────────────────────────

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const HOUR_BUCKETS = ['morning', 'midday', 'afternoon', 'evening', 'night'] as const;
export const HOUR_LABEL: Record<string, string> = { morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
export const HOUR_RANGE: Record<string, string> = { morning: '5–11', midday: '11–14', afternoon: '14–17', evening: '17–21', night: '21–5' };

/** 7 weekdays × 5 day-parts, Monday first; empty slots are null. */
export function heatGrid(cells: HeatCell[]): (HeatCell | null)[][] {
  return WEEKDAYS.map((d) => HOUR_BUCKETS.map((h) => cells.find((c) => c.weekday === d && c.hour === h) ?? null));
}

/** A diverging colour step for a lift: tone plus 0 (about usual) … 4 (≥ ~1.8× or ≤ ~0.55×). */
export function heatLevel(lift?: number): { tone: Tone; level: 0 | 1 | 2 | 3 | 4 } {
  const tone = liftTone(lift);
  if (tone === 'none') return { tone, level: 0 };
  const a = Math.abs(Math.log(lift!));
  return { tone, level: a < 0.05 ? 0 : a < 0.15 ? 1 : a < 0.3 ? 2 : a < 0.6 ? 3 : 4 };
}

/** A diverging bar from "usual" (the middle) on a 0.25×–4× log axis, with its 80 % band. */
export function effectBar(e: Pick<Effect, 'effect' | 'lo' | 'hi'>, span = Math.log(4)): { left: number; width: number; lo: number; hi: number } {
  const p = (x: number) => Math.max(0, Math.min(100, 50 + (Math.log(Math.max(x, 1e-3)) / span) * 50));
  const at = p(e.effect);
  return { left: Math.min(50, at), width: Math.abs(at - 50), lo: p(e.lo), hi: p(e.hi) };
}

const LEVEL_NAMES: Record<string, string> = {
  'pdf-carousel': 'PDF carousels', 'image-carousel': 'Image carousels', 'single-image': 'Single images', 'video-vertical': 'Vertical videos', 'video-landscape': 'Landscape videos', 'text-only': 'Text-only posts',
  morning: 'Mornings (5–11)', midday: 'Midday (11–14)', afternoon: 'Afternoons (14–17)', evening: 'Evenings (17–21)', night: 'Nights (21–5)',
  Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays', Sun: 'Sundays',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Plain names for a feature level (the engine's levelLabel, worded for a list). */
export function levelName(feature: string, level: string): string {
  switch (feature) {
    case 'mediaKind': case 'weekday': case 'hour': return LEVEL_NAMES[level] ?? level;
    case 'format': return `${cap(level.replace(/-/g, ' '))} format`;
    case 'pillar': return `${level} pillar`;
    case 'slides': return level === 'none' ? 'No slides' : `${level} slides`;
    case 'captionLen': return `${cap(level.replace('-', ' '))} captions`;
    case 'hashtags': return `${level} hashtags`;
    case 'firstComment': return level === 'none' ? 'No first comment' : level === 'link' ? 'Link in first comment' : 'Text first comment';
    case 'linkInCaption': return level === 'yes' ? 'Link in caption' : 'No link in caption';
    case 'emoji': return `${level} emoji`;
    case 'trend': return level === 'yes' ? 'Trend-linked posts' : 'Posts not linked to a trend';
    case 'cta': return level === 'none' ? 'No call to action' : `${cap(level.replace('-', ' '))} calls to action`;
    case 'hook': return `${cap(level.replace('-', ' '))} hooks`;
    default: return `${feature}: ${level}`;
  }
}

/** A "why" sentence built only from the finding's own numbers, for when no narrative has been written. */
export function whySentence(e: Effect, channelName: string): string {
  const name = levelName(e.feature, e.level);
  const dir = e.effect >= 1 ? `did ${fmtX(e.effect)} your usual` : `did ${fmtX(e.effect)} your usual — below it`;
  const band = e.lo > 1 || e.hi < 1 ? `the likely range (${fmtX(e.lo)}–${fmtX(e.hi)}) stays on one side of usual` : `the likely range (${fmtX(e.lo)}–${fmtX(e.hi)}) still crosses usual, so treat it as a lead`;
  return `${name} on ${channelName} ${dir} across ${e.n} posts, after allowing for everything else about them; ${band}.`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

/** "Forecasts landed inside their range 7 of 9 times" — null until one has been scored. */
export function calibrationLine(c: Pick<Calibration, 'n' | 'rows'>): string | null {
  if (!c.n) return null;
  const inside = c.rows.filter((r) => r.inBand).length;
  return `Forecasts landed inside their range ${inside} of ${c.n} time${c.n === 1 ? '' : 's'}`;
}

/** How well critic scores rank posts by what happened: a word, not a decimal. */
export function criticStrength(rank: number | null): 'none' | 'weak' | 'moderate' | 'strong' | 'inverse' {
  if (rank === null) return 'none';
  if (rank <= -0.2) return 'inverse';
  return rank < 0.2 ? 'weak' : rank < 0.5 ? 'moderate' : 'strong';
}
export function criticLine(c: Pick<CriticCalibration, 'n' | 'rank'>): string {
  const s = criticStrength(c.rank);
  if (s === 'none') return `Not enough yet — critic scores are compared with results once 5 posts made in Shipcast have numbers (${c.n} so far).`;
  if (s === 'inverse') return `Critic scores run against your results (${c.n} posts) — the critic likes what your audience doesn't.`;
  return `Critic scores track your results: ${s} (${c.n} posts).`;
}

// ── features of a draft (mirrors services/engine/src/playbook.ts featuresOf) ──

const DAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function hourBucket(h: number): (typeof HOUR_BUCKETS)[number] {
  return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 14 ? 'midday' : h >= 14 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
}
export function mediaKind(c: Pick<PostChannel, 'channel' | 'media'>): string {
  const m = c.media ?? [];
  if (m.some((f) => /\.pdf$/i.test(f))) return 'pdf-carousel';
  const video = m.find((f) => /\.(mp4|mov|webm|m4v)$/i.test(f));
  if (video) {
    if (/vertical|reel|9x16|tiktok|shorts?\b|story|portrait/i.test(video)) return 'video-vertical';
    if (/landscape|16x9|wide/i.test(video)) return 'video-landscape';
    return ['tiktok', 'instagram'].includes(c.channel) ? 'video-vertical' : 'video-landscape';
  }
  const images = m.filter((f) => /\.(png|jpe?g|gif|webp|avif)$/i.test(f));
  return images.length > 1 ? 'image-carousel' : images.length === 1 ? 'single-image' : 'text-only';
}
export function hookByRules(line: string): string | null {
  const l = line.trim();
  if (!l) return null;
  if (/^before\b|\bbefore\b.*\bafter\b|\bfrom .{2,40} to .{2,40}\b(in|with)\b|→/i.test(l)) return 'before-after';
  if (/\?\s*$|^(why|what|how|who|when|where|which|ever|do|does|did|is|are|can|should|would)\b[^.!]*\?/i.test(l)) return 'question';
  if (/^how (to|i|we)\b|^(a |the )?(step-by-step|guide|tutorial)\b|\bhere'?s how\b/i.test(l)) return 'how-to';
  if (/^(\d+|three|four|five|six|seven|eight|nine|ten)\s+\w+/i.test(l)) return 'number';
  if (/^(stop|don'?t|never|quit)\b|\b(is|are) (dead|overrated|a myth|wrong|lying)\b|\bmyth\b|\bunpopular opinion\b|\beveryone is wrong\b|\bwrong\b/i.test(l)) return 'contrarian';
  if (/^(introducing|announcing|new:|today we|we('re| are) (launching|releasing|excited)|we just (launched|shipped|released)|(it'?s|now) live|just (launched|shipped|released))/i.test(l)) return 'announcement';
  if (/^(i|i'm|i've|i was|we|we're|we've|my|our)\b.*\b(when|last|ago|years?|months?|yesterday)\b|^(last (year|month|week)|yesterday|\d+ (years|months|weeks) ago)\b/i.test(l)) return 'story';
  if (/^["“].+["”]/.test(l)) return 'quote';
  return null;
}
const bucket = (n: number, edges: [number, string][], last: string) => edges.find(([max]) => n <= max)?.[1] ?? last;
const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|dev|ai|app|co|org|net)\b/i;

/** The features a forecast can be explained by. Hooks the rules can't place stay "other" here, as in the engine's forecast. */
export function draftFeatures(p: Post, ch: ChannelId): Record<string, string> | null {
  const c = p.channels.find((x) => x.channel === ch);
  if (!c) return null;
  const at = c.sentAt ?? p.at;
  const lp = at ? localParts(at, p.tz || 'UTC') : null;
  const caption = c.caption ?? '';
  const first = caption.split('\n').map((l) => l.trim()).find(Boolean) ?? c.title ?? p.title;
  return {
    mediaKind: mediaKind(c),
    format: p.format || 'none',
    pillar: p.pillar || 'none',
    weekday: lp ? DAYS_SUN[new Date(`${lp.date}T12:00:00Z`).getUTCDay()] : 'unknown',
    hour: lp ? hourBucket(Number(lp.time.slice(0, 2))) : 'unknown',
    captionLen: bucket(caption.length, [[149, 'short'], [599, 'medium'], [1299, 'long']], 'very-long'),
    hashtags: bucket(c.hashtags.length, [[0, '0'], [3, '1-3'], [6, '4-6']], '7+'),
    firstComment: !c.firstComment?.trim() ? 'none' : URL_RE.test(c.firstComment) ? 'link' : 'text',
    linkInCaption: URL_RE.test(caption) ? 'yes' : 'no',
    trend: p.trend ? 'yes' : 'no',
    hook: hookByRules(first) ?? 'other',
  };
}

/** The learned effects that apply to a draft, strongest first (only ones with enough posts behind them). */
export function factorsFor(model: Pick<ChannelModel, 'effects'> | undefined, f: Record<string, string> | null, max = 4): Effect[] {
  if (!model || !f) return [];
  return model.effects
    .filter((e) => f[e.feature] === e.level && e.n >= 3 && Math.abs(Math.log(e.effect)) >= 0.05)
    .sort((a, b) => Math.abs(Math.log(b.effect)) - Math.abs(Math.log(a.effect)))
    .slice(0, max);
}

/** Top and bottom posts by headline lift on one channel. */
export function leaderboard(perf: Performance[], ch: ChannelId, n = 5): { top: Performance[]; bottom: Performance[] } {
  const seen = new Set<string>();
  const rows: Performance[] = [];
  for (const p of perf) {
    if (p.channel !== ch || seen.has(p.post)) continue;
    seen.add(p.post);
    const h = headlineOf(perf, p.post, ch);
    if (h?.lift !== undefined) rows.push(h);
  }
  rows.sort((a, b) => b.lift! - a.lift!);
  const top = rows.slice(0, n);
  return { top, bottom: rows.slice(Math.max(n, rows.length - n)).reverse() };
}
