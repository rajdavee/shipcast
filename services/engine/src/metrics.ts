import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { channel, getPost, listPosts, parseCsv, type ChannelId, type Post } from './calendar.ts';
import { withDirLock } from './filelock.ts';
import { home } from './paths.ts';

/**
 * Pulse: what happened after a post went out. Numbers arrive as snapshots —
 * from a platform API, the platform's own export, a confirmed screenshot or
 * the user — each tagged with how old the post was. Posts are only ever
 * compared with the same channel's posts at the same age, as a lift over
 * "your usual" (the median), because platforms and post ages aren't
 * comparable in raw numbers.
 */

export type MetricSource = 'manual' | 'csv' | 'screenshot' | 'youtube' | 'postiz' | 'instagram' | 'linkedin';

export interface Snapshot {
  id: string;
  post: string;
  channel: ChannelId;
  /** When the numbers were read. */
  at: string;
  /** Hours since the post went out when read. */
  ageHours: number;
  source: MetricSource;
  impressions?: number;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  follows?: number;
  /** Video: average share of the video watched, 0–100. */
  avgViewPct?: number;
}

export const METRIC_KEYS = ['impressions', 'reach', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks', 'follows', 'avgViewPct'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Fixed ages to compare at; a snapshot counts for the nearest bucket it's close enough to. */
export const AGE_BUCKETS = [
  { id: '1d', hours: 24 },
  { id: '3d', hours: 72 },
  { id: '7d', hours: 168 },
  { id: '30d', hours: 720 },
] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number]['id'];

export function bucketOf(ageHours: number): AgeBucket | null {
  // Within roughly ±40 % of a bucket's age (30 d accepts anything older than 3 weeks).
  for (const b of AGE_BUCKETS) if (ageHours >= b.hours * 0.6 && ageHours <= b.hours * 1.4) return b.id;
  return ageHours > 500 ? '30d' : null;
}

// ── store ──────────────────────────────────────────────────────────────

const dir = () => join(home(), 'metrics');
const file = () => join(dir(), 'snapshots.json');
// The api and agents services both write snapshots: in-process queue plus a folder lock across processes.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = () => withDirLock(dir(), fn);
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
};

export async function readSnapshots(): Promise<Snapshot[]> {
  try {
    return JSON.parse(await readFile(file(), 'utf8'));
  } catch {
    return [];
  }
}
async function writeSnapshots(all: Snapshot[]) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 1) + '\n');
  await rename(tmp, file());
}

/** When a post's channel went out: its sent time, else its scheduled time. */
export function postedAt(p: Post, ch: ChannelId): string | undefined {
  return p.channels.find((c) => c.channel === ch)?.sentAt ?? p.at;
}

/** A number as platforms print it ("1.2K", "3,410", "12 %"); undefined when it isn't one or is negative. */
export const parseMetricNumber = (v: unknown) => {
  if (v === undefined || v === null || v === '') return undefined;
  // "1.2K", "3,410", "12 %" — the ways platforms print numbers.
  const s = String(v).trim().replace(/,/g, '').replace(/%$/, '').trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
};
const num = parseMetricNumber;

/** Record numbers for a published post's channel. Replaces an earlier snapshot from the same source in the same age bucket. */
export function addSnapshot(input: Partial<Snapshot> & { post: string; channel: ChannelId; source: MetricSource }, now = new Date()): Promise<Snapshot> {
  return serial(async () => {
    const p = await getPost(input.post);
    if (!p) throw new Error('post not found');
    if (!p.channels.some((c) => c.channel === input.channel)) throw new Error(`post has no ${input.channel} channel`);
    const sent = postedAt(p, input.channel);
    if (!sent) throw new Error('this post has no date — numbers need to know when it went out');
    const at = input.at ? new Date(input.at) : now;
    const age = input.ageHours ?? (at.getTime() - Date.parse(sent)) / 3_600_000;
    if (age < 0) throw new Error("that post hasn't gone out yet");
    const s: Snapshot = { id: `m${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, post: p.id, channel: input.channel, at: at.toISOString(), ageHours: Math.round(age * 10) / 10, source: input.source };
    let any = false;
    for (const k of METRIC_KEYS) {
      const v = num((input as Record<string, unknown>)[k]);
      if (v !== undefined) {
        (s as unknown as Record<string, number>)[k] = k === 'avgViewPct' ? Math.min(100, v) : v;
        any = true;
      }
    }
    if (!any) throw new Error('no numbers to save');
    const b = bucketOf(s.ageHours);
    const all = (await readSnapshots()).filter((x) => !(x.post === s.post && x.channel === s.channel && x.source === s.source && b && bucketOf(x.ageHours) === b));
    await writeSnapshots([...all, s]);
    return s;
  });
}

export function deleteSnapshot(id: string): Promise<boolean> {
  return serial(async () => {
    const all = await readSnapshots();
    if (!all.some((s) => s.id === id)) return false;
    await writeSnapshots(all.filter((s) => s.id !== id));
    return true;
  });
}

// ── normalising ────────────────────────────────────────────────────────

/** Who saw it: reach if known, else impressions, else views. */
export const audienceOf = (s: Partial<Snapshot>) => s.reach ?? s.impressions ?? s.views;

/** Engagement weighted by intent: a save or share says more than a like. */
export function weightedEngagement(s: Partial<Snapshot>): number | undefined {
  const parts = [s.likes, s.comments, s.shares, s.saves, s.clicks];
  if (parts.every((x) => x === undefined)) return undefined;
  return (s.likes ?? 0) + 2 * (s.comments ?? 0) + 3 * (s.shares ?? 0) + 3 * (s.saves ?? 0) + (s.clicks ?? 0);
}

export function engagementRate(s: Partial<Snapshot>): number | undefined {
  const a = audienceOf(s);
  const e = weightedEngagement(s);
  return a && e !== undefined ? e / a : undefined;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};

export interface Performance {
  post: string;
  channel: ChannelId;
  bucket: AgeBucket;
  ageHours: number;
  audience?: number;
  engagement?: number;
  rate?: number;
  /** × your usual (median of this channel's other posts at this age). */
  liftAudience?: number;
  liftEngagement?: number;
  /** One number: geometric mean of the lifts we have. */
  lift?: number;
  /** How many of your other posts the "usual" is made of. */
  baselineN: number;
  source: MetricSource;
}

/** The best snapshot per post, channel and bucket (latest read; API sources beat typed ones). */
function latestPerBucket(snaps: Snapshot[]): Map<string, Snapshot> {
  const rank: Record<MetricSource, number> = { youtube: 5, instagram: 5, linkedin: 5, postiz: 4, csv: 3, screenshot: 2, manual: 1 };
  const out = new Map<string, Snapshot>();
  for (const s of snaps) {
    const b = bucketOf(s.ageHours);
    if (!b) continue;
    const k = `${s.post}|${s.channel}|${b}`;
    const cur = out.get(k);
    if (!cur || rank[s.source] > rank[cur.source] || (rank[s.source] === rank[cur.source] && s.at > cur.at)) out.set(k, s);
  }
  return out;
}

/** Below this many other posts the "usual" is too thin to call a lift. */
export const MIN_BASELINE = 3;

/** Every post's performance at every age it has numbers for. */
export function computePerformance(snaps: Snapshot[]): Performance[] {
  const best = latestPerBucket(snaps);
  const rows = [...best.entries()].map(([k, s]) => ({ k, s, b: k.split('|')[2] as AgeBucket, aud: audienceOf(s), eng: weightedEngagement(s) }));
  return rows.map(({ s, b, aud, eng }) => {
    const peers = rows.filter((r) => r.s.channel === s.channel && r.b === b && r.s.post !== s.post);
    const audPeers = peers.map((r) => r.aud).filter((x): x is number => x !== undefined && x > 0);
    const engPeers = peers.map((r) => r.eng).filter((x): x is number => x !== undefined && x > 0);
    const liftAudience = aud !== undefined && audPeers.length >= MIN_BASELINE ? aud / median(audPeers) : undefined;
    const liftEngagement = eng !== undefined && engPeers.length >= MIN_BASELINE ? eng / median(engPeers) : undefined;
    const lifts = [liftAudience, liftEngagement].filter((x): x is number => x !== undefined && x > 0);
    return {
      post: s.post,
      channel: s.channel,
      bucket: b,
      ageHours: s.ageHours,
      ...(aud !== undefined ? { audience: aud } : {}),
      ...(eng !== undefined ? { engagement: eng } : {}),
      ...(engagementRate(s) !== undefined ? { rate: Math.round(engagementRate(s)! * 10_000) / 10_000 } : {}),
      ...(liftAudience !== undefined ? { liftAudience: round2(liftAudience) } : {}),
      ...(liftEngagement !== undefined ? { liftEngagement: round2(liftEngagement) } : {}),
      ...(lifts.length ? { lift: round2(Math.exp(lifts.reduce((a, x) => a + Math.log(x), 0) / lifts.length)) } : {}),
      baselineN: Math.max(audPeers.length, engPeers.length),
      source: s.source,
    };
  });
}
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The headline number for a post's channel: the oldest bucket we can compare (the most settled). */
export function headline(perf: Performance[], post: string, ch: ChannelId): Performance | undefined {
  const order: AgeBucket[] = ['30d', '7d', '3d', '1d'];
  const mine = perf.filter((p) => p.post === post && p.channel === ch);
  return order.map((b) => mine.find((p) => p.bucket === b && p.lift !== undefined)).find(Boolean) ?? order.map((b) => mine.find((p) => p.bucket === b)).find(Boolean);
}

export async function postPerformance(postId: string) {
  const snaps = await readSnapshots();
  const perf = computePerformance(snaps);
  return { snapshots: snaps.filter((s) => s.post === postId).sort((a, b) => a.ageHours - b.ageHours), performance: perf.filter((p) => p.post === postId) };
}

// ── import ─────────────────────────────────────────────────────────────

/** Column names the platforms' own exports and people's sheets use, mapped to ours. */
const ALIASES: Record<string, MetricKey | 'url' | 'date' | 'channel' | 'title' | 'post_id'> = {
  'post url': 'url', url: 'url', link: 'url', permalink: 'url', 'post link': 'url', 'video url': 'url',
  'post id': 'post_id', post_id: 'post_id', shipcast_id: 'post_id',
  date: 'date', 'post publish date': 'date', 'published': 'date', 'publish date': 'date', 'created date': 'date', 'video publish time': 'date',
  channel: 'channel', platform: 'channel', network: 'channel', title: 'title', 'post title': 'title', 'video title': 'title',
  impressions: 'impressions', 'impressions (total)': 'impressions', reach: 'reach', 'members reached': 'reach', 'accounts reached': 'reach', views: 'views', 'video views': 'views', plays: 'views',
  likes: 'likes', reactions: 'likes', 'likes (total)': 'likes', comments: 'comments', shares: 'shares', reposts: 'shares', retweets: 'shares', saves: 'saves', saved: 'saves', bookmarks: 'saves',
  clicks: 'clicks', 'link clicks': 'clicks', 'clicks (total)': 'clicks', follows: 'follows', 'followers gained': 'follows', 'new followers': 'follows', 'subscribers gained': 'follows', 'average percentage viewed (%)': 'avgViewPct', 'avg view %': 'avgViewPct',
};

const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const normUrl = (u: string) => u.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

/** Numbers from a CSV (a platform export or your own sheet). Rows are matched to posts by URL, Shipcast id, or channel + day (+ title). */
export async function importMetricsCsv(text: string, fallbackChannel?: ChannelId, now = new Date()): Promise<{ saved: number; unmatched: string[] }> {
  const [head, ...rows] = parseCsv(text);
  if (!head) return { saved: 0, unmatched: ['The file is empty.'] };
  const cols = head.map((h) => ALIASES[h.trim().toLowerCase()]);
  const posts = (await listPosts()).filter((p) => p.at);
  let saved = 0;
  const unmatched: string[] = [];
  for (const [i, r] of rows.slice(0, 5000).entries()) {
    const get = (k: string) => {
      const j = cols.indexOf(k as never);
      return j >= 0 ? (r[j] ?? '').trim() : '';
    };
    const url = get('url');
    const ch = (channel(get('channel').toLowerCase())?.id ?? fallbackChannel) as ChannelId | undefined;
    const date = get('date') ? new Date(get('date')) : null;
    const title = get('title').toLowerCase();
    let match: { p: Post; ch: ChannelId } | undefined;
    if (get('post_id')) {
      const p = posts.find((x) => x.id === get('post_id'));
      const c = p && (ch && p.channels.some((x) => x.channel === ch) ? ch : p.channels[0]?.channel);
      if (p && c) match = { p, ch: c };
    }
    if (!match && url) {
      for (const p of posts) for (const c of p.channels) if (c.url && normUrl(c.url) === normUrl(url)) match = { p, ch: c.channel };
    }
    if (!match && ch && date && !Number.isNaN(date.getTime())) {
      const day = posts.filter((p) => p.channels.some((c) => c.channel === ch) && sameDay(postedAt(p, ch)!, date.toISOString()));
      const pick = day.length === 1 ? day[0] : day.find((p) => title && (p.title.toLowerCase().includes(title.slice(0, 30)) || title.includes(p.title.toLowerCase().slice(0, 30))));
      if (pick) match = { p: pick, ch };
    }
    if (!match) {
      unmatched.push(`Row ${i + 2}: no matching post${url ? ` for ${url}` : ''}${date && !Number.isNaN(date.getTime()) ? ` on ${date.toISOString().slice(0, 10)}` : ''}.`);
      continue;
    }
    const values: Partial<Snapshot> = {};
    for (const k of METRIC_KEYS) if (get(k)) (values as Record<string, unknown>)[k] = get(k);
    try {
      await addSnapshot({ ...values, post: match.p.id, channel: match.ch, source: 'csv' }, now);
      saved++;
    } catch (e) {
      unmatched.push(`Row ${i + 2}: ${(e as Error).message}.`);
    }
  }
  return { saved, unmatched: unmatched.slice(0, 50) };
}
