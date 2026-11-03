// Pure calendar logic for the web app: zone-aware dates, grids, slot times and the channel rules
// (mirrors services/engine/src/calendar.ts so the drawer can check as you type). No DOM, no React.

export type ChannelId = 'linkedin' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'threads' | 'facebook' | 'pinterest' | 'newsletter' | 'blog';
export type PublishVia = 'manual' | 'direct' | 'postiz';
export type PostStatus = 'idea' | 'draft' | 'ready' | 'scheduled' | 'published' | 'failed';
export type ChannelState = 'pending' | 'sending' | 'sent' | 'failed' | 'due';

export interface ChannelInfo {
  id: ChannelId;
  name: string;
  captionMax: number;
  foldAt?: number;
  titleMax?: number;
  hashtagsMax: number;
  needsMedia: boolean;
  media: string;
  formats: string[];
  via: PublishVia[];
  firstComment?: boolean;
}

export interface PostChannel {
  channel: ChannelId;
  account?: string;
  title?: string;
  caption: string;
  firstComment?: string;
  hashtags: string[];
  media: string[];
  via: PublishVia;
  state?: ChannelState;
  url?: string;
  error?: string;
  sentAt?: string;
  attempts?: number;
  retryAt?: string;
  lastAttemptAt?: string;
  remoteId?: string;
  note?: string;
}

export interface Post {
  id: string;
  title: string;
  status: PostStatus;
  at?: string;
  tz: string;
  channels: PostChannel[];
  format?: string;
  campaign?: string;
  step?: string;
  pillar?: string;
  trend?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPlan {
  tz: string;
  pillars: { name: string; share: number; about?: string }[];
  cadence: Partial<Record<ChannelId, { perWeek: number; slots: string[] }>>;
}

/** LinkedIn and Instagram lead everywhere the channels are listed. */
export const CHANNEL_ORDER: ChannelId[] = ['linkedin', 'instagram', 'youtube', 'x', 'tiktok', 'threads', 'facebook', 'pinterest', 'newsletter', 'blog'];
export const STATUSES: PostStatus[] = ['idea', 'draft', 'ready', 'scheduled', 'published', 'failed'];
export const STATUS_LABEL: Record<PostStatus, string> = { idea: 'Idea', draft: 'Draft', ready: 'Ready', scheduled: 'Scheduled', published: 'Published', failed: 'Failed' };
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const PUBLISHER_FIELDS = ['state', 'url', 'error', 'sentAt', 'attempts', 'retryAt', 'lastAttemptAt', 'remoteId', 'note'] as const;

// ── dates (YYYY-MM-DD strings; arithmetic in UTC so local DST never shifts a day) ──

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock date and time of an instant in a zone. */
export function localParts(iso: string, tz: string): { date: string; time: string } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

/** The instant a wall-clock time in a zone refers to (two passes settle the offset and DST edges). */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const guess = Date.parse(`${date}T${time}:00Z`);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(t).toISOString(), tz);
    t -= Date.parse(`${lp.date}T${lp.time}:00Z`) - guess;
  }
  return new Date(t).toISOString();
}

export const todayIn = (tz: string, now = new Date()) => localParts(now.toISOString(), tz).date;
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return d.toISOString().slice(0, 10);
}
/** 0 = Monday … 6 = Sunday. */
export const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
export const startOfWeek = (date: string) => addDays(date, -weekday(date));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Monday-first weeks covering the anchor's month (4–6 rows of 7 dates). */
export function monthGrid(anchor: string): string[][] {
  const first = `${anchor.slice(0, 7)}-01`;
  const next = addMonths(first, 1);
  const weeks: string[][] = [];
  for (let d = startOfWeek(first); d < next; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}
export const weekDates = (anchor: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));

export type View = 'month' | 'week' | 'list';
/** First and last date (inclusive) a view shows around an anchor date. */
export function viewRange(view: View, anchor: string): { from: string; to: string } {
  if (view === 'month') {
    const g = monthGrid(anchor);
    return { from: g[0][0], to: g[g.length - 1][6] };
  }
  if (view === 'week') return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) };
  return { from: anchor, to: addDays(anchor, 27) };
}
export function shiftAnchor(view: View, anchor: string, dir: 1 | -1): string {
  return view === 'month' ? addMonths(anchor, dir) : addDays(anchor, dir * (view === 'week' ? 7 : 28));
}

/** Dated posts by the day they fall on in the plan's zone, each day in time order. */
export function bucketByDay(posts: Post[], tz: string): Map<string, Post[]> {
  const out = new Map<string, Post[]>();
  for (const p of posts) {
    if (!p.at) continue;
    const d = localParts(p.at, tz).date;
    (out.get(d) ?? out.set(d, []).get(d)!).push(p);
  }
  for (const list of out.values()) list.sort((a, b) => a.at!.localeCompare(b.at!));
  return out;
}

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** A minute of the day snapped to `step`, kept inside [lo, hi]. */
export const snapMinutes = (min: number, step = 15, lo = 0, hi = 24 * 60 - step) => Math.max(lo, Math.min(hi, Math.round(min / step) * step));

/** Time a backlog idea gets when dropped on a day: that weekday's preferred slot, else the channel's first slot, else 09:00. */
export function slotTime(plan: ContentPlan | null, ch: ChannelId | undefined, date: string): string {
  const slots = (ch && plan?.cadence[ch]?.slots) || [];
  const day = DAY_NAMES[weekday(date)];
  return (slots.find((s) => s.startsWith(day)) ?? slots[0])?.slice(4) ?? '09:00';
}

/** Moving a post to another day keeps its wall-clock time in the plan's zone. */
export function moveToDay(at: string, date: string, tz: string): string {
  return zonedToUtc(date, localParts(at, tz).time, tz);
}

// ── the plan ──────────────────────────────────────────────────────────

/** How many posts a cadence makes between two dates (inclusive from, exclusive to), per channel — mirrors the planner's slot layout, skipping days a channel already has a post. */
export function cadenceCount(plan: ContentPlan, from: string, to: string, taken: Post[] = []): { channel: ChannelId; perWeek: number; posts: number }[] {
  const out: { channel: ChannelId; perWeek: number; posts: number }[] = [];
  const busy = new Set(taken.filter((p) => p.at).flatMap((p) => p.channels.map((c) => `${c.channel}@${localParts(p.at!, plan.tz).date}`)));
  for (const ch of CHANNEL_ORDER) {
    const cad = plan.cadence[ch];
    if (!cad?.perWeek) continue;
    const slots = cad.slots.length ? cad.slots : ['Tue 09:00'];
    const days = new Set(slots.map((s) => s.slice(0, 3)));
    const extra = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].filter((d) => !days.has(d));
    while (days.size < Math.min(cad.perWeek, 7) && extra.length) days.add(extra.shift()!);
    const used = new Set([...days].slice(0, cad.perWeek));
    let n = 0;
    for (let d = from; d < to; d = addDays(d, 1)) if (used.has(DAY_NAMES[weekday(d)]) && !busy.has(`${ch}@${d}`)) n++;
    out.push({ channel: ch, perWeek: cad.perWeek, posts: n });
  }
  return out;
}

/** Set one pillar's share and spread the difference over the others so the total stays 100. */
export function rebalance(shares: number[], i: number, value: number): number[] {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = shares.map((s, j) => (j === i ? 0 : s));
  const rest = others.reduce((a, b) => a + b, 0);
  const left = 100 - v;
  if (shares.length === 1) return [100];
  const exact = others.map((s, j) => (j === i ? v : rest ? (s / rest) * left : left / (shares.length - 1)));
  const out = exact.map(Math.floor);
  // Largest remainders get the rounding leftovers, so 6.67 becomes 7 before 13.33 becomes 14.
  let gap = 100 - out.reduce((a, b) => a + b, 0);
  const order = out.map((_, j) => j).filter((j) => j !== i).sort((a, b) => exact[b] - out[b] - (exact[a] - out[a]));
  for (let k = 0; gap > 0; k = (k + 1) % order.length, gap--) out[order[k]]++;
  return out;
}

// ── channel rules (as you type) ───────────────────────────────────────

export const fullCaption = (c: Pick<PostChannel, 'caption' | 'hashtags'>) => [c.caption.trim(), c.hashtags.join(' ')].filter(Boolean).join('\n\n');

/** Same wording and rules as the engine's channelProblems. */
export function channelProblems(c: PostChannel, info: ChannelInfo | undefined): string[] {
  if (!info) return [];
  const out: string[] = [];
  const text = [c.caption, c.hashtags.join(' ')].filter(Boolean).join('\n\n');
  if (!c.caption.trim() && c.channel !== 'youtube') out.push(`${info.name}: write the caption.`);
  if (text.length > info.captionMax) out.push(`${info.name}: ${text.length} characters with hashtags, over the ${info.captionMax} limit.`);
  if (info.titleMax && c.channel === 'youtube' && !c.title?.trim()) out.push('YouTube: add a title.');
  if (info.titleMax && c.title && c.title.length > info.titleMax) out.push(`${info.name}: title is ${c.title.length} characters (max ${info.titleMax}).`);
  if (c.hashtags.length > info.hashtagsMax) out.push(`${info.name}: ${c.hashtags.length} hashtags (keep to ${info.hashtagsMax}${info.hashtagsMax ? ' or fewer' : ' — none'}).`);
  if (info.needsMedia && !c.media.length) out.push(`${info.name}: attach the ${info.media.split(',')[0]} — make it with Shipcast or add a file.`);
  if (c.channel === 'instagram' && c.media.length > 10) out.push(`Instagram: ${c.media.length} files; a carousel takes up to 10.`);
  if (c.channel === 'x' && c.media.filter((m) => /\.(png|jpe?g|webp|gif)$/i.test(m)).length > 4) out.push('X: up to 4 images per post.');
  if (c.firstComment && !info.firstComment) out.push(`${info.name}: first comments aren't supported here.`);
  return out;
}

/** Why the post can't be scheduled yet ([] = it can). */
export function scheduleProblems(p: Post, channels: ChannelInfo[], now = new Date()): string[] {
  const out: string[] = [];
  if (!p.at) out.push('Pick a date and time.');
  else if (Date.parse(p.at) < now.getTime() - 60_000) out.push('That time has passed — pick a future time.');
  if (!p.channels.length) out.push('Choose at least one channel.');
  for (const c of p.channels) out.push(...channelProblems(c, channels.find((x) => x.id === c.channel)));
  return out;
}

/** The caption split where the feed folds it ("…see more"); `rest` is empty when it all shows. */
export function foldCaption(text: string, foldAt?: number): { shown: string; rest: string } {
  if (!foldAt || text.length <= foldAt) return { shown: text, rest: '' };
  // Cut on a word boundary near the fold, as feeds do.
  const cut = text.lastIndexOf(' ', foldAt);
  const at = cut > foldAt * 0.7 ? cut : foldAt;
  return { shown: text.slice(0, at).trimEnd(), rest: text.slice(at) };
}

/** "#Launch, dev tools #ai" → ['#Launch', '#devtools', '#ai'] (the engine's normalisation, deduplicated). */
export function parseHashtags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\n]|(?=#)/)) {
    const h = raw.trim().replace(/^#?/, '#').replace(/\s+/g, '');
    if (h.length > 1 && !out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out;
}

export type NextAction = 'make' | 'schedule' | 'send' | 'mark' | 'retry' | null;
/** The one thing to do next: Make it → Schedule → Send now / Mark posted. */
export function nextAction(p: Post, channels: ChannelInfo[]): NextAction {
  if (p.status === 'published') return null;
  if (p.status === 'failed') return 'retry';
  if (p.status === 'scheduled') return p.channels.some((c) => c.via !== 'manual' && c.state !== 'sent') ? 'send' : 'mark';
  const media = p.channels.some((c) => c.media.length);
  const needs = p.channels.some((c) => channels.find((x) => x.id === c.channel)?.needsMedia);
  if (!media && !p.step && (needs || p.format)) return 'make';
  return 'schedule';
}

/** An edited copy sent back to the server keeps the publisher's latest bookkeeping, never the editor's stale one. */
export function withServerState(edit: Post, server: Post | undefined): Post {
  return {
    ...edit,
    channels: edit.channels.map((c) => {
      const prev = server?.channels.find((x) => x.channel === c.channel && x.account === c.account);
      const out: PostChannel = { ...c };
      for (const k of PUBLISHER_FIELDS) delete out[k];
      if (prev) for (const k of PUBLISHER_FIELDS) if (prev[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = prev[k];
      return out;
    }),
  };
}

/** Filter posts by channel chips (any of) and statuses (any of); empty means all. */
export function filterPosts(posts: Post[], channels: ChannelId[], statuses: PostStatus[]): Post[] {
  return posts.filter((p) => (!channels.length || p.channels.some((c) => channels.includes(c.channel))) && (!statuses.length || statuses.includes(p.status)));
}

/** A path under the Shipcast home → the project id and the path inside it, when it's a project file. */
export function projectFile(path: string): { campaign: string; rest: string } | null {
  const m = path.match(/^campaigns\/([^/]+)\/(.+)$/);
  return m ? { campaign: m[1], rest: m[2] } : null;
}
