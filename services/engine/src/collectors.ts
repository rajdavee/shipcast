import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { inQuietHours } from './agents.ts';
import { runClaude } from './claude.ts';
import { channel as channelInfo, listPosts, type ChannelId, type Post, type PostChannel } from './calendar.ts';
import { notifyDesktop } from './hub.ts';
import { AGE_BUCKETS, METRIC_KEYS, addSnapshot, bucketOf, parseMetricNumber, postedAt, readSnapshots, type AgeBucket, type MetricKey, type Snapshot } from './metrics.ts';
import { home } from './paths.ts';
import { PublishError, connections, postizBase, postizConfig, providerFailure, providerFetch, redactSecrets, youtubeAccess, youtubeStats } from './publish.ts';
import { readSettings } from './store.ts';

/**
 * Collectors: numbers come back by themselves where a platform lets us read
 * them — YouTube over the user's own Google connection, everything sent
 * through Postiz over its analytics API (a polite queue: Postiz allows ~30
 * calls an hour) — and everywhere else Shipcast asks the user, at most a few
 * times a day, offering quick entry or a screenshot it reads (and the user
 * confirms). A pass runs on the agents service's tick and snapshots each
 * published channel once per age bucket (1 d, 3 d, 7 d, 30 d).
 */

type Values = Partial<Record<MetricKey, number>>;
const H = 3_600_000;
const dir = () => join(home(), 'metrics');

// ── YouTube ────────────────────────────────────────────────────────────

/** The video id from what the publisher stored, or the link someone pasted. */
export function videoIdOf(c: Pick<PostChannel, 'remoteId' | 'url'>): string | undefined {
  if (c.remoteId && /^[\w-]{11}$/.test(c.remoteId)) return c.remoteId;
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/))([\w-]{11})/.exec(c.url ?? '');
  return m?.[1];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function readYoutube(c: Pick<PostChannel, 'remoteId' | 'url'>, sentAt: string, now = new Date()): Promise<Values> {
  const id = videoIdOf(c);
  if (!id) throw new PublishError('No YouTube video id on this post.', true);
  const access = await youtubeAccess();
  const scopes = await youtubeStats();
  if (!scopes.stats) throw new PublishError('Reconnect YouTube in Settings → Connections so Shipcast can read its numbers.', true);
  const auth = { authorization: `Bearer ${access}` };
  const r = await providerFetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${id}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw await providerFailure('YouTube', r, 'stats read');
  const st = ((await r.json()) as { items?: { statistics?: Record<string, string> }[] }).items?.[0]?.statistics;
  if (!st) throw new PublishError('YouTube has no such video on this account (deleted or private?).', true);
  const out: Values = {};
  const put = (k: MetricKey, v: unknown) => {
    const n = parseMetricNumber(v);
    if (n !== undefined) out[k] = n;
  };
  put('views', st.viewCount), put('likes', st.likeCount), put('comments', st.commentCount);
  if (scopes.analytics) {
    const q = new URLSearchParams({ ids: 'channel==MINE', startDate: ymd(new Date(sentAt)), endDate: ymd(now), metrics: 'averageViewPercentage,subscribersGained', filters: `video==${id}` });
    // Analytics are extra (and lag a day or two); the public counts above stand on their own.
    try {
      const a = await providerFetch(`https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (a.ok) {
        const j = (await a.json()) as { columnHeaders?: { name?: string }[]; rows?: unknown[][] };
        const row = j.rows?.[0] ?? [];
        j.columnHeaders?.forEach((h, i) => (h.name === 'averageViewPercentage' ? put('avgViewPct', row[i]) : h.name === 'subscribersGained' ? put('follows', row[i]) : undefined));
      }
    } catch {}
  }
  return out;
}

// ── Postiz ─────────────────────────────────────────────────────────────

/** Labels Postiz's providers use for per-post numbers. "Engagement" is left out: we weigh the parts ourselves. */
const POSTIZ_LABELS: Record<string, MetricKey> = {
  likes: 'likes', reactions: 'likes', favorites: 'likes', hearts: 'likes',
  comments: 'comments', replies: 'comments',
  shares: 'shares', reposts: 'shares', retweets: 'shares', quotes: 'shares', reshares: 'shares',
  impressions: 'impressions', 'unique impressions': 'reach', reach: 'reach',
  views: 'views', 'video views': 'views', plays: 'views',
  saves: 'saves', saved: 'saves', bookmarks: 'saves',
  clicks: 'clicks', 'link clicks': 'clicks',
  follows: 'follows', followers: 'follows', 'new followers': 'follows',
};

/** Postiz's answer for a post: a series per label. One point is the running total; several are per-day counts, summed. */
export function mapPostizAnalytics(body: unknown): Values {
  const out: Values = {};
  if (!Array.isArray(body)) return out;
  for (const m of body as { label?: unknown; data?: { total?: unknown; date?: unknown }[] }[]) {
    const k = POSTIZ_LABELS[String(m?.label ?? '').trim().toLowerCase()];
    if (!k || !Array.isArray(m.data) || !m.data.length) continue;
    const byDay = new Map<string, number>();
    for (const [i, d] of m.data.entries()) {
      const n = parseMetricNumber(d?.total);
      if (n !== undefined) byDay.set(String(d?.date ?? i), n);
    }
    if (!byDay.size) continue;
    const v = [...byDay.values()].reduce((a, b) => a + b, 0);
    out[k] = Math.max(out[k] ?? 0, v);
  }
  return out;
}

export class PostizBusy extends Error {
  until: number;
  constructor(until: number) {
    super('Postiz asked us to slow down.');
    this.until = until;
  }
}

export async function readPostiz(postId: string, sentAt: string, now = new Date()): Promise<Values> {
  const cfg = await postizConfig();
  const days = Math.min(365, Math.max(1, Math.ceil((now.getTime() - Date.parse(sentAt)) / (24 * H)) + 1));
  const r = await providerFetch(`${postizBase(cfg.url)}/analytics/post/${encodeURIComponent(postId)}?date=${days}`, { headers: { authorization: cfg.key }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 429) {
    const after = Number(r.headers.get('retry-after'));
    throw new PostizBusy(now.getTime() + (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) * 1000 : H));
  }
  if (!r.ok) throw await providerFailure('Postiz', r, 'analytics read');
  const body = await r.json();
  // { missing: true }: Postiz has no published copy (yet) to ask the platform about.
  if (body && !Array.isArray(body) && (body as { missing?: boolean }).missing) throw new PublishError('Postiz has not published this post yet.');
  return mapPostizAnalytics(body);
}

// ── shared files (the api and agents services both touch them) ─────────

let chain: Promise<unknown> = Promise.resolve();
async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = join(dir(), '.collect.lock');
  await mkdir(dir(), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      await mkdir(lock);
      break;
    } catch {
      if (i > 200) {
        const s = await stat(lock).catch(() => null);
        if (s && Date.now() - s.mtimeMs > 10_000) await rm(lock, { recursive: true, force: true });
        i = 0;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => withFileLock(fn);
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}
async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await readFile(file, 'utf8')) };
  } catch {
    return fallback;
  }
}
async function writeJsonFile(file: string, data: unknown) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1) + '\n');
  await rename(tmp, file);
}

// ── the Postiz queue ───────────────────────────────────────────────────

/** Postiz allows ~30 calls an hour per key, and publishing spends some of them too. */
export const POSTIZ_PER_HOUR = 25;

export interface PostizQueueItem {
  post: string;
  channel: ChannelId;
  remoteId: string;
  /** The age bucket it's for, or "now" for a read someone asked for. */
  bucket: AgeBucket | 'now';
  queuedAt: string;
  tries?: number;
  /** After a failed try: not before this. */
  retryAt?: string;
}
export interface PostizQueue {
  /** When each read in the last hour went out: the bucket's spent tokens. */
  reads: string[];
  pausedUntil?: string;
  items: PostizQueueItem[];
}
const queueFile = () => join(dir(), 'postiz-queue.json');
export const readPostizQueue = () => readJsonFile<PostizQueue>(queueFile(), { reads: [], items: [] });

/** Reads Postiz still allows this hour (a rolling hour, so a burst can't spend two hours' worth across the boundary). */
export function postizTokens(q: PostizQueue, now: Date): number {
  if (q.pausedUntil && Date.parse(q.pausedUntil) > now.getTime()) return 0;
  return Math.max(0, POSTIZ_PER_HOUR - q.reads.filter((t) => now.getTime() - Date.parse(t) < H).length);
}
/** When the next read may go: now, or when the oldest read in the hour ages out. */
export function postizNextSlot(q: PostizQueue, now: Date): Date {
  if (q.pausedUntil && Date.parse(q.pausedUntil) > now.getTime()) return new Date(q.pausedUntil);
  const recent = q.reads.map(Date.parse).filter((t) => now.getTime() - t < H).sort((a, b) => a - b);
  return recent.length < POSTIZ_PER_HOUR ? now : new Date(recent[recent.length - POSTIZ_PER_HOUR] + H);
}

const itemKey = (i: Pick<PostizQueueItem, 'post' | 'channel' | 'bucket'>) => `${i.post}|${i.channel}|${i.bucket}`;
export function enqueuePostiz(item: Omit<PostizQueueItem, 'queuedAt'>, now = new Date()): Promise<boolean> {
  return locked(async () => {
    const q = await readPostizQueue();
    if (q.items.some((x) => itemKey(x) === itemKey(item))) return false;
    q.items.push({ ...item, queuedAt: now.toISOString() });
    await writeJsonFile(queueFile(), q);
    return true;
  });
}
/** Take the oldest due read and spend a token on it in one locked step, or nothing if the hour's reads are used up. */
function takePostiz(now: Date): Promise<PostizQueueItem | undefined> {
  return locked(async () => {
    const q = await readPostizQueue();
    q.reads = q.reads.filter((t) => now.getTime() - Date.parse(t) < H);
    q.items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    const i = q.items.findIndex((x) => !x.retryAt || Date.parse(x.retryAt) <= now.getTime());
    if (i < 0 || !postizTokens(q, now)) return undefined;
    const [item] = q.items.splice(i, 1);
    q.reads.push(now.toISOString());
    await writeJsonFile(queueFile(), q);
    return item;
  });
}
function putBackPostiz(item: PostizQueueItem, pausedUntil?: number): Promise<void> {
  return locked(async () => {
    const q = await readPostizQueue();
    if (!q.items.some((x) => itemKey(x) === itemKey(item))) q.items.push(item);
    if (pausedUntil) q.pausedUntil = new Date(pausedUntil).toISOString();
    await writeJsonFile(queueFile(), q);
  });
}

// ── schedule state ─────────────────────────────────────────────────────

export interface Nudge {
  post: string;
  channel: ChannelId;
  bucket: AgeBucket;
  since: string;
  notifiedAt?: string;
}
interface CollectState {
  /** post|channel|bucket → when it was collected, queued or turned into a nudge. Once per bucket. */
  done: Record<string, string>;
  nudges: Nudge[];
  /** When nudge notifications went out (the daily cap). */
  notified: string[];
  /** "Collect now" requests for direct reads, left by the api for the next pass. */
  asked: { post: string; channel: ChannelId; at: string }[];
  failures: Record<string, { n: number; retryAt: string }>;
}
const stateFile = () => join(dir(), 'collect-state.json');
const readState = () => readJsonFile<CollectState>(stateFile(), { done: {}, nudges: [], notified: [], asked: [], failures: {} });

export const NUDGES_PER_DAY = 3;
const MAX_TRIES = 3;
/** Past this share over a bucket's age the bucket's window has closed (bucketOf's own tolerance). */
const WINDOW = 1.4;
const windowEnd = (b: AgeBucket) => AGE_BUCKETS.find((x) => x.id === b)!.hours * WINDOW;
const bucketLabel: Record<AgeBucket, string> = { '1d': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days' };

export type CollectorKind = 'youtube' | 'postiz';
/** Which collector can read this channel's numbers, if any. LinkedIn personal analytics need partner approval, so direct LinkedIn has none. */
export function collectorFor(c: PostChannel, yt: { stats: boolean; connected: boolean }): CollectorKind | undefined {
  if (c.via === 'postiz' && c.remoteId) return 'postiz';
  if (c.channel === 'youtube' && yt.connected && yt.stats && videoIdOf(c)) return 'youtube';
  return undefined;
}

const sentChannels = (p: Post) => p.channels.filter((c) => c.state === 'sent' && c.sentAt);

/** Published channels waiting for someone to add their numbers (no collector can read them). */
export async function pendingNumbers(now = new Date()): Promise<{ post: string; title: string; channel: ChannelId; bucket: AgeBucket; since: string; notified: boolean }[]> {
  const [state, snaps, posts] = await Promise.all([readState(), readSnapshots(), listPosts()]);
  return state.nudges.filter((n) => stillWanted(n, posts, snaps, now)).map((n) => ({ post: n.post, title: posts.find((p) => p.id === n.post)!.title, channel: n.channel, bucket: n.bucket, since: n.since, notified: !!n.notifiedAt }));
}
function stillWanted(n: Nudge, posts: Post[], snaps: Snapshot[], now: Date): boolean {
  const p = posts.find((x) => x.id === n.post);
  const c = p && sentChannels(p).find((x) => x.channel === n.channel);
  if (!p || !c) return false;
  const age = (now.getTime() - Date.parse(postedAt(p, n.channel)!)) / H;
  // Numbers typed after the window closes would count for another age, so the ask lapses with it.
  if (age > windowEnd(n.bucket)) return false;
  return !snaps.some((s) => s.post === n.post && s.channel === n.channel && bucketOf(s.ageHours) === n.bucket);
}

function nudgeText(p: Post, ch: ChannelId, b: AgeBucket, now: Date): { title: string; message: string } {
  const went = new Date(postedAt(p, ch)!);
  const kind = /carousel|document/.test(p.format ?? '') ? 'carousel' : /reel|short|video|audiogram|tour/.test(p.format ?? '') ? 'video' : /newsletter|email/.test(p.format ?? '') ? 'newsletter' : /blog|article/.test(p.format ?? '') ? 'article' : 'post';
  const name = channelInfo(ch)?.name ?? ch;
  const recent = now.getTime() - went.getTime() < 6 * 24 * H;
  const tz = p.tz || 'UTC';
  const title = recent ? `How did ${went.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })}'s ${name} ${kind} do?` : `How did your ${name} ${kind} from ${went.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz })} do?`;
  return { title, message: `Add its numbers (${bucketLabel[b]} in): "${p.title}" — type them, or drop a screenshot of its stats.` };
}

// ── the pass ───────────────────────────────────────────────────────────

export interface MetricsDeps {
  now?: () => Date;
  notify?: (title: string, message: string) => Promise<void>;
  log?: (text: string) => void;
  /** Swap the readers (tests); default the real YouTube and Postiz reads. */
  readers?: Partial<Record<CollectorKind, (c: PostChannel, sentAt: string, now: Date) => Promise<Values>>>;
  /** Most reads of each kind per pass, so a tick stays short. */
  maxReads?: number;
}
export interface MetricsReport {
  skipped?: string;
  collected: string[];
  queued: string[];
  nudged: string[];
  notified: string[];
  failed: string[];
  /** Postiz reads still waiting for the rate limit. */
  waiting: number;
}

let inFlight: Promise<MetricsReport> | null = null;
/** One metrics pass; a pass still going (slow network) makes the next tick return at once. */
export function runMetrics(deps: MetricsDeps = {}): Promise<MetricsReport> {
  if (inFlight) return Promise.resolve({ skipped: 'A metrics pass is still running.', collected: [], queued: [], nudged: [], notified: [], failed: [], waiting: 0 });
  inFlight = metricsOnce(deps).finally(() => (inFlight = null));
  return inFlight;
}

async function metricsOnce(deps: MetricsDeps): Promise<MetricsReport> {
  const clock = deps.now ?? (() => new Date());
  const notify = deps.notify ?? notifyDesktop;
  const log = deps.log ?? ((t: string) => console.log(`[metrics] ${t}`));
  const maxReads = deps.maxReads ?? 10;
  const read: Record<CollectorKind, (c: PostChannel, sentAt: string, now: Date) => Promise<Values>> = {
    youtube: deps.readers?.youtube ?? ((c, s, n) => readYoutube(c, s, n)),
    postiz: deps.readers?.postiz ?? ((c, s, n) => readPostiz(c.remoteId!, s, n)),
  };
  const report: MetricsReport = { collected: [], queued: [], nudged: [], notified: [], failed: [], waiting: 0 };
  const settings = await readSettings();
  if (settings.metricsPaused) return { ...report, skipped: 'Collecting numbers is paused.' };
  const now = clock();
  const conn = (await connections(now.getTime())).youtube;
  const yt = { connected: conn.connected, stats: conn.stats.stats };
  const posts = await listPosts();
  const snaps = await readSnapshots();
  // Take the api's "collect now" requests; everything else in the state is only ever written by this pass.
  const asked = await locked(async () => {
    const s = await readState();
    if (s.asked.length) await writeJsonFile(stateFile(), { ...s, asked: [] });
    return s.asked;
  });
  const state = await readState();
  const before = JSON.stringify(state);
  const name = (p: Post, ch: ChannelId) => `${p.title} → ${channelInfo(ch)?.name ?? ch}`;
  const nudge = (p: Post, ch: ChannelId, b: AgeBucket) => {
    if (snaps.some((s) => s.post === p.id && s.channel === ch && bucketOf(s.ageHours) === b)) return;
    if (state.nudges.some((n) => n.post === p.id && n.channel === ch && n.bucket === b)) return;
    state.nudges.push({ post: p.id, channel: ch, bucket: b, since: now.toISOString() });
    report.nudged.push(`${name(p, ch)} (${b})`);
  };
  const save = async (p: Post, c: PostChannel, source: 'youtube' | 'postiz', v: Values) => {
    if (!Object.keys(v).length) return log(`${name(p, c.channel)}: no numbers yet`);
    await addSnapshot({ ...v, post: p.id, channel: c.channel, source }, now);
    report.collected.push(name(p, c.channel));
  };

  const direct: { p: Post; c: PostChannel; key?: string; b?: AgeBucket }[] = [];
  for (const p of posts) {
    for (const c of sentChannels(p)) {
      const went = postedAt(p, c.channel)!;
      const age = (now.getTime() - Date.parse(went)) / H;
      const kind = collectorFor(c, yt);
      for (const { id: b, hours } of AGE_BUCKETS) {
        // Due once the bucket's age is reached; a pass missed while the computer was off still counts until the window closes.
        if (age < hours || age > hours * WINDOW) continue;
        const key = `${p.id}|${c.channel}|${b}`;
        if (state.done[key]) continue;
        if (kind === 'postiz') {
          if (await enqueuePostiz({ post: p.id, channel: c.channel, remoteId: c.remoteId!, bucket: b }, now)) report.queued.push(`${name(p, c.channel)} (${b})`);
          state.done[key] = now.toISOString();
        } else if (kind === 'youtube') {
          const f = state.failures[key];
          if (!f || Date.parse(f.retryAt) <= now.getTime()) direct.push({ p, c, key, b });
        } else {
          nudge(p, c.channel, b);
          state.done[key] = now.toISOString();
        }
      }
    }
  }
  for (const a of asked) {
    const p = posts.find((x) => x.id === a.post);
    const c = p && sentChannels(p).find((x) => x.channel === a.channel);
    if (p && c && collectorFor(c, yt) === 'youtube') direct.push({ p, c });
  }

  for (const { p, c, key, b } of direct.slice(0, maxReads)) {
    try {
      await save(p, c, 'youtube', await read.youtube(c, postedAt(p, c.channel)!, now));
      if (key) (state.done[key] = now.toISOString()), delete state.failures[key];
    } catch (e) {
      const msg = await redactSecrets((e as Error).message || 'unknown error');
      log(`${name(p, c.channel)}: read failed — ${msg}`);
      report.failed.push(name(p, c.channel));
      if (!key || !b) continue;
      const n = (state.failures[key]?.n ?? 0) + 1;
      // A read that keeps failing (or can't work) becomes a request for the numbers instead.
      if ((e instanceof PublishError && e.permanent) || n >= MAX_TRIES) {
        delete state.failures[key];
        state.done[key] = now.toISOString();
        nudge(p, c.channel, b);
      } else state.failures[key] = { n, retryAt: new Date(now.getTime() + n * H).toISOString() };
    }
  }

  for (let i = 0; i < maxReads; i++) {
    const item = await takePostiz(now);
    if (!item) break;
    const p = posts.find((x) => x.id === item.post);
    const c = p && sentChannels(p).find((x) => x.channel === item.channel && x.remoteId === item.remoteId);
    if (!p || !c) continue;
    const went = postedAt(p, c.channel)!;
    // Still queued after its window closed (a long rate-limit wait): it would no longer be a reading at that age.
    if (item.bucket !== 'now' && (now.getTime() - Date.parse(went)) / H > windowEnd(item.bucket)) continue;
    try {
      await save(p, c, 'postiz', await read.postiz(c, went, now));
    } catch (e) {
      if (e instanceof PostizBusy) {
        await putBackPostiz(item, e.until);
        log('Postiz asked to slow down; reads wait');
        break;
      }
      const msg = await redactSecrets((e as Error).message || 'unknown error');
      log(`${name(p, c.channel)}: Postiz read failed — ${msg}`);
      report.failed.push(name(p, c.channel));
      const tries = (item.tries ?? 0) + 1;
      if (!(e instanceof PublishError && e.permanent) && tries < MAX_TRIES) await putBackPostiz({ ...item, tries, retryAt: new Date(now.getTime() + tries * 15 * 60_000).toISOString() });
      else if (item.bucket !== 'now') nudge(p, c.channel, item.bucket);
    }
  }
  report.waiting = (await readPostizQueue()).items.length;

  // Nudges: keep the ones still wanted; ping for the oldest un-pinged, a few a day, never in quiet hours.
  const fresh = await readSnapshots();
  state.nudges = state.nudges.filter((n) => stillWanted(n, posts, fresh, now));
  state.notified = state.notified.filter((t) => now.getTime() - Date.parse(t) < 48 * H);
  const today = ymd(now);
  const quiet = inQuietHours(now, settings.agentsQuietStart, settings.agentsQuietEnd);
  for (const n of [...state.nudges].sort((a, b) => a.since.localeCompare(b.since))) {
    if (n.notifiedAt || quiet || state.notified.filter((t) => t.slice(0, 10) === today).length >= NUDGES_PER_DAY) continue;
    const p = posts.find((x) => x.id === n.post)!;
    const t = nudgeText(p, n.channel, n.bucket, now);
    await notify(t.title, t.message);
    n.notifiedAt = now.toISOString();
    state.notified.push(now.toISOString());
    report.notified.push(`${name(p, n.channel)} (${n.bucket})`);
  }
  // Forget bookkeeping for posts that are gone or past every window.
  const live = new Set(posts.filter((p) => sentChannels(p).some((c) => (now.getTime() - Date.parse(postedAt(p, c.channel)!)) / H <= windowEnd('30d') + 24)).map((p) => p.id));
  for (const k of Object.keys(state.done)) if (!live.has(k.split('|')[0])) delete state.done[k];
  for (const k of Object.keys(state.failures)) if (!live.has(k.split('|')[0])) delete state.failures[k];

  // Most passes change nothing; the tick runs every 20 s, so don't rewrite the file for nothing.
  if (JSON.stringify(state) !== before)
    await locked(async () => {
      const cur = await readState();
      await writeJsonFile(stateFile(), { ...state, asked: cur.asked });
    });
  return report;
}

/** "Collect now" on a post: queue a read for every published channel a collector can read. */
export async function collectNow(post: Post, now = new Date()): Promise<{ queued: ChannelId[]; manual: ChannelId[] }> {
  const conn = (await connections(now.getTime())).youtube;
  const yt = { connected: conn.connected, stats: conn.stats.stats };
  const out = { queued: [] as ChannelId[], manual: [] as ChannelId[] };
  for (const c of sentChannels(post)) {
    const kind = collectorFor(c, yt);
    if (kind === 'postiz') await enqueuePostiz({ post: post.id, channel: c.channel, remoteId: c.remoteId!, bucket: 'now' }, now);
    else if (kind === 'youtube')
      await locked(async () => {
        const s = await readState();
        if (!s.asked.some((a) => a.post === post.id && a.channel === c.channel)) s.asked.push({ post: post.id, channel: c.channel, at: now.toISOString() });
        await writeJsonFile(stateFile(), s);
      });
    (kind ? out.queued : out.manual).push(c.channel);
  }
  return out;
}

// ── screenshot reading ─────────────────────────────────────────────────

const IMAGE_EXT = /^\.(png|jpe?g|webp|gif)$/i;
export const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
/** No platform count is near this; a bigger number is a misread. */
const ABSURD = 1e9;

export type ScreenshotAsk = (prompt: string, cwd: string, image: string) => Promise<string>;
let defaultAsk: ScreenshotAsk | null = null;
/** Tests swap the vision call; null restores Claude. */
export function setScreenshotAsk(f: ScreenshotAsk | null) {
  defaultAsk = f;
}

async function askClaude(prompt: string, cwd: string, image: string): Promise<string> {
  let text = '';
  // Read is the only tool, and only on the one copied image in an otherwise empty folder.
  const run = runClaude({ prompt, cwd, allowedTools: [`Read(./${image})`], model: 'sonnet', extraArgs: ['--max-turns', '4', '--disallowedTools', 'WebFetch,WebSearch,Bash,Write,Edit,Glob,Grep,Task', '--setting-sources', 'project', '--strict-mcp-config'], onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; } });
  const timer = setTimeout(run.kill, 120_000);
  const r = await run.done;
  clearTimeout(timer);
  return r.result?.text || text;
}

const METRIC_HELP: Record<MetricKey, string> = {
  impressions: 'impressions / times shown', reach: 'reach / members or accounts reached / unique viewers', views: 'views / plays / video views', likes: 'likes / reactions', comments: 'comments / replies',
  shares: 'shares / reposts', saves: 'saves / bookmarks', clicks: 'clicks / link clicks', follows: 'follows / new followers / subscribers gained', avgViewPct: 'average percentage of the video watched (0–100)',
};

export interface ScreenshotReading {
  values: Values;
  seen: { date?: string; title?: string };
  /** Keys or numbers that were thrown away (unknown, unreadable or absurd). */
  dropped: string[];
}

/** Check what the vision pass said: known keys only, platform number formats, nothing absurd. */
export function validateReading(raw: string): ScreenshotReading {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    throw new Error("Couldn't read any numbers from that image.");
  }
  if (!j || typeof j !== 'object') throw new Error("Couldn't read any numbers from that image.");
  const src = (j.values && typeof j.values === 'object' ? j.values : Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'date' && k !== 'title'))) as Record<string, unknown>;
  const out: ScreenshotReading = { values: {}, seen: {}, dropped: [] };
  for (const [k, v] of Object.entries(src)) {
    if (!(METRIC_KEYS as readonly string[]).includes(k)) {
      out.dropped.push(k.slice(0, 40));
      continue;
    }
    const n = parseMetricNumber(typeof v === 'number' || typeof v === 'string' ? v : undefined);
    if (n === undefined || n > ABSURD || (k === 'avgViewPct' && n > 100) || /^\s*-/.test(String(v))) {
      out.dropped.push(k);
      continue;
    }
    out.values[k as MetricKey] = n;
  }
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : undefined);
  const date = text(j.date, 40);
  const title = text(j.title, 200);
  if (date) out.seen.date = date;
  if (title) out.seen.title = title;
  return out;
}

/**
 * Read a platform's stats screenshot into proposed numbers. Nothing is saved:
 * the user checks the proposal and confirms it as a `screenshot` snapshot.
 */
export async function readMetricsFromImage(file: string, opts: { channel: ChannelId; ask?: ScreenshotAsk }): Promise<ScreenshotReading> {
  const ext = extname(file).toLowerCase();
  if (!IMAGE_EXT.test(ext)) throw new Error('Send a PNG, JPEG, WebP or GIF screenshot.');
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) throw new Error('That screenshot is missing.');
  if (st.size > MAX_SCREENSHOT_BYTES) throw new Error('That screenshot is too large (15 MB at most).');
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-shot-'));
  try {
    const image = `screenshot${ext}`;
    await copyFile(file, join(cwd, image));
    const name = channelInfo(opts.channel)?.name ?? opts.channel;
    const prompt = `Read the image ${image} in the current folder. It is a screenshot of a ${name} post's statistics.

Copy the numbers you can actually see into these keys (leave out any key that isn't shown — never estimate or compute one):
${METRIC_KEYS.map((k) => `- ${k}: ${METRIC_HELP[k]}`).join('\n')}

Copy each number as printed (e.g. "1.2K", "3,410", "45%"). Also give the post's date and title (or first words) if the screenshot shows them.

Reply with only JSON: {"values": {"<key>": "<number>"}, "date": "<as shown, or omit>", "title": "<as shown, or omit>"}`;
    return validateReading(await (opts.ask ?? defaultAsk ?? askClaude)(prompt, cwd, image));
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
