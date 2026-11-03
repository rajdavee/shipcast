import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { home } from './paths.ts';

/**
 * The content calendar: every planned post across every channel, in one
 * place. A post moves idea → draft → ready → scheduled → published; each of
 * its channels carries its own copy, media and way of being published
 * (manual post kit, a direct connection, or a Postiz instance). Stored as one
 * JSON file under ~/.shipcast/calendar, written atomically and one writer at
 * a time.
 */

export type ChannelId = 'linkedin' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'threads' | 'facebook' | 'pinterest' | 'newsletter' | 'blog';
export type PublishVia = 'manual' | 'direct' | 'postiz';
export type PostStatus = 'idea' | 'draft' | 'ready' | 'scheduled' | 'published' | 'failed';

export interface ChannelInfo {
  id: ChannelId;
  name: string;
  /** Caption/body limit in characters (for YouTube: the description). */
  captionMax: number;
  /** Where the feed cuts the caption ("…see more"); write the hook before it. */
  foldAt?: number;
  titleMax?: number;
  hashtagsMax: number;
  /** Needs at least one media file to post. */
  needsMedia: boolean;
  /** What the media can be. */
  media: string;
  /** Shipcast formats that make good posts here, best first. */
  formats: string[];
  via: PublishVia[];
  firstComment?: boolean;
}

/** Platform rules as of Nov 2026 (official docs); used for validation, previews and the planner. */
export const CALENDAR_CHANNELS: ChannelInfo[] = [
  { id: 'linkedin', name: 'LinkedIn', captionMax: 3000, foldAt: 210, hashtagsMax: 5, needsMedia: false, media: 'text, 1–20 images, a PDF document (carousel) or one video', formats: ['carousel', 'social-post', 'quote-cards', 'reel', 'document', 'case-study', 'newsletter'], via: ['manual', 'direct', 'postiz'], firstComment: true },
  { id: 'instagram', name: 'Instagram', captionMax: 2200, foldAt: 125, hashtagsMax: 30, needsMedia: true, media: '1 image, a carousel of up to 10 images/videos, or a reel', formats: ['photo-carousel', 'social-post', 'quote-cards', 'reel', 'ugc-ad'], via: ['manual', 'postiz'], firstComment: true },
  { id: 'youtube', name: 'YouTube', captionMax: 5000, titleMax: 100, hashtagsMax: 15, needsMedia: true, media: 'one video (Shorts: vertical, up to 3 min)', formats: ['youtube-video', 'shorts', 'explainer-video', 'reel', 'audiogram', 'product-tour'], via: ['manual', 'direct', 'postiz'] },
  { id: 'x', name: 'X', captionMax: 280, hashtagsMax: 2, needsMedia: false, media: 'text, up to 4 images or one video', formats: ['social-post', 'copy-kit', 'reel', 'quote-cards'], via: ['manual', 'postiz'] },
  { id: 'tiktok', name: 'TikTok', captionMax: 2200, hashtagsMax: 5, needsMedia: true, media: 'a vertical video or a photo carousel', formats: ['reel', 'photo-carousel', 'ugc-ad', 'social-short'], via: ['manual', 'postiz'] },
  { id: 'threads', name: 'Threads', captionMax: 500, hashtagsMax: 1, needsMedia: false, media: 'text, up to 20 images or a video', formats: ['social-post', 'quote-cards'], via: ['manual', 'postiz'] },
  { id: 'facebook', name: 'Facebook', captionMax: 63206, foldAt: 480, hashtagsMax: 3, needsMedia: false, media: 'text, images or a video', formats: ['social-post', 'reel', 'carousel'], via: ['manual', 'postiz'] },
  { id: 'pinterest', name: 'Pinterest', captionMax: 500, titleMax: 100, hashtagsMax: 0, needsMedia: true, media: 'a 2:3 image or a video', formats: ['pins-endscreens', 'infographic'], via: ['manual', 'postiz'] },
  { id: 'newsletter', name: 'Newsletter', captionMax: 100_000, titleMax: 50, hashtagsMax: 0, needsMedia: false, media: 'an email issue', formats: ['newsletter', 'email'], via: ['manual'] },
  { id: 'blog', name: 'Blog', captionMax: 100_000, titleMax: 60, hashtagsMax: 0, needsMedia: false, media: 'an article', formats: ['blog-article'], via: ['manual'] },
];
export const channel = (id: string) => CALENDAR_CHANNELS.find((c) => c.id === id);

export interface PostChannel {
  channel: ChannelId;
  /** Account or page handle, when you post to more than one. */
  account?: string;
  title?: string;
  caption: string;
  firstComment?: string;
  hashtags: string[];
  /** Files from a Shipcast deliverable (paths relative to the Shipcast home) or anywhere the user picked. */
  media: string[];
  via: PublishVia;
  state?: 'pending' | 'sending' | 'sent' | 'failed' | 'due';
  url?: string;
  error?: string;
  sentAt?: string;
}

export interface Post {
  id: string;
  title: string;
  status: PostStatus;
  /** ISO time it goes out (UTC); absent for ideas. */
  at?: string;
  /** IANA zone the time was planned in (for display and ICS). */
  tz: string;
  channels: PostChannel[];
  /** Shipcast format that makes it, and where the made piece lives. */
  format?: string;
  campaign?: string;
  step?: string;
  pillar?: string;
  /** Trend card it came from. */
  trend?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPlan {
  tz: string;
  pillars: { name: string; share: number; about?: string }[];
  /** Per channel: posts a week and preferred slots like "Tue 09:00". */
  cadence: Partial<Record<ChannelId, { perWeek: number; slots: string[] }>>;
}

export const DEFAULT_PLAN: ContentPlan = {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  pillars: [
    { name: 'Teach', share: 40, about: 'How-tos and lessons your audience can use today' },
    { name: 'Show', share: 30, about: 'The product doing real work: demos, before/after, results' },
    { name: 'Story', share: 20, about: 'Behind the scenes, decisions, people' },
    { name: 'Ask', share: 10, about: 'Launches, offers, invitations' },
  ],
  cadence: { linkedin: { perWeek: 3, slots: ['Tue 09:00', 'Wed 12:00', 'Thu 09:00'] }, instagram: { perWeek: 3, slots: ['Mon 18:00', 'Wed 18:00', 'Fri 18:00'] } },
};

// ── store ──────────────────────────────────────────────────────────────

const dir = () => join(home(), 'calendar');
const postsFile = () => join(dir(), 'posts.json');
const planFile = () => join(dir(), 'plan.json');

async function writeAtomic(file: string, data: unknown) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1) + '\n');
  await rename(tmp, file);
}

// One writer at a time: the UI, the planner and the publisher can all touch posts.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readAll(): Promise<Post[]> {
  try {
    return JSON.parse(await readFile(postsFile(), 'utf8'));
  } catch {
    return [];
  }
}

export async function listPosts(q: { from?: string; to?: string; status?: PostStatus[]; channel?: string; unscheduled?: boolean } = {}): Promise<Post[]> {
  return (await readAll())
    .filter((p) => (q.unscheduled ? !p.at : true))
    .filter((p) => !q.from || (p.at && p.at >= q.from))
    .filter((p) => !q.to || (p.at && p.at < q.to))
    .filter((p) => !q.status?.length || q.status.includes(p.status))
    .filter((p) => !q.channel || p.channels.some((c) => c.channel === q.channel))
    .sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9') || a.createdAt.localeCompare(b.createdAt));
}

export async function getPost(id: string): Promise<Post | undefined> {
  return (await readAll()).find((p) => p.id === id);
}

const newPostId = () => `p${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

function cleanChannel(c: Partial<PostChannel>): PostChannel | null {
  const info = channel(String(c.channel));
  if (!info) return null;
  const via = info.via.includes(c.via as PublishVia) ? (c.via as PublishVia) : 'manual';
  return {
    channel: info.id,
    ...(c.account ? { account: String(c.account).slice(0, 80) } : {}),
    ...(c.title ? { title: String(c.title).slice(0, 300) } : {}),
    caption: String(c.caption ?? '').slice(0, 100_000),
    ...(c.firstComment ? { firstComment: String(c.firstComment).slice(0, 3000) } : {}),
    hashtags: (Array.isArray(c.hashtags) ? c.hashtags : []).map((h) => String(h).replace(/^#?/, '#').replace(/\s+/g, '')).filter((h) => h.length > 1).slice(0, 30),
    media: (Array.isArray(c.media) ? c.media : []).map(String).slice(0, 20),
    via,
    ...(c.state ? { state: c.state } : {}),
    ...(c.url ? { url: String(c.url) } : {}),
    ...(c.error ? { error: String(c.error).slice(0, 500) } : {}),
    ...(c.sentAt ? { sentAt: c.sentAt } : {}),
  };
}

const STATUSES: PostStatus[] = ['idea', 'draft', 'ready', 'scheduled', 'published', 'failed'];

/** Create or update a post. Unknown channels are dropped; scheduling is checked by `scheduleProblems`. */
export function savePost(input: Partial<Post> & { id?: string }, now = new Date()): Promise<Post> {
  return serial(async () => {
    const all = await readAll();
    const old = input.id ? all.find((p) => p.id === input.id) : undefined;
    if (input.id && !old) throw new Error('post not found');
    const merged = { ...old, ...input } as Partial<Post>;
    const at = merged.at ? new Date(merged.at) : null;
    const p: Post = {
      id: old?.id ?? newPostId(),
      title: String(merged.title ?? '').trim().slice(0, 200) || 'Untitled post',
      status: STATUSES.includes(merged.status as PostStatus) ? (merged.status as PostStatus) : merged.at ? 'draft' : 'idea',
      ...(at && !Number.isNaN(at.getTime()) ? { at: at.toISOString() } : {}),
      tz: String(merged.tz || DEFAULT_PLAN.tz),
      channels: (merged.channels ?? []).map(cleanChannel).filter((c): c is PostChannel => !!c).filter((c, i, a) => a.findIndex((x) => x.channel === c.channel && x.account === c.account) === i),
      ...(merged.format ? { format: String(merged.format) } : {}),
      ...(merged.campaign ? { campaign: String(merged.campaign) } : {}),
      ...(merged.step ? { step: String(merged.step) } : {}),
      ...(merged.pillar ? { pillar: String(merged.pillar).slice(0, 60) } : {}),
      ...(merged.trend ? { trend: String(merged.trend) } : {}),
      notes: String(merged.notes ?? '').slice(0, 4000),
      createdAt: old?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    // An idea that gets a date becomes a draft; a draft that loses its date goes back to the backlog.
    if (p.at && p.status === 'idea') p.status = 'draft';
    if (!p.at && (p.status === 'draft' || p.status === 'ready' || p.status === 'scheduled')) p.status = 'idea';
    await writeAtomic(postsFile(), old ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p]);
    return p;
  });
}

export function deletePost(id: string): Promise<boolean> {
  return serial(async () => {
    const all = await readAll();
    if (!all.some((p) => p.id === id)) return false;
    await writeAtomic(postsFile(), all.filter((p) => p.id !== id));
    return true;
  });
}

/** Update one channel of a post in place (the publisher's bookkeeping). */
export function updateChannel(id: string, ch: ChannelId, patch: Partial<PostChannel>): Promise<Post> {
  return serial(async () => {
    const all = await readAll();
    const p = all.find((x) => x.id === id);
    if (!p) throw new Error('post not found');
    const c = p.channels.find((x) => x.channel === ch);
    if (!c) throw new Error(`post has no ${ch} channel`);
    Object.assign(c, patch);
    // The post is published once every channel is; failed if any failed and none is still going.
    if (p.channels.every((x) => x.state === 'sent')) p.status = 'published';
    else if (p.channels.some((x) => x.state === 'failed') && !p.channels.some((x) => x.state === 'pending' || x.state === 'sending' || x.state === 'due')) p.status = 'failed';
    p.updatedAt = new Date().toISOString();
    await writeAtomic(postsFile(), all);
    return p;
  });
}

export async function readPlan(): Promise<ContentPlan> {
  try {
    return { ...DEFAULT_PLAN, ...JSON.parse(await readFile(planFile(), 'utf8')) };
  } catch {
    return DEFAULT_PLAN;
  }
}
export async function savePlan(p: Partial<ContentPlan>): Promise<ContentPlan> {
  const cur = await readPlan();
  const next: ContentPlan = {
    tz: String(p.tz || cur.tz),
    pillars: (p.pillars ?? cur.pillars).map((x) => ({ name: String(x.name).slice(0, 40), share: Math.max(0, Math.min(100, Math.round(Number(x.share) || 0))), ...(x.about ? { about: String(x.about).slice(0, 200) } : {}) })).filter((x) => x.name).slice(0, 8),
    cadence: Object.fromEntries(
      Object.entries(p.cadence ?? cur.cadence)
        .filter(([k]) => channel(k))
        .map(([k, v]) => [k, { perWeek: Math.max(0, Math.min(21, Math.round(Number(v?.perWeek) || 0))), slots: (v?.slots ?? []).map(String).filter((s) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2}$/.test(s)).slice(0, 21) }]),
    ),
  };
  await writeAtomic(planFile(), next);
  return next;
}

// ── checks ─────────────────────────────────────────────────────────────

/** Problems that would stop a post going out on each channel ([] = good to go). */
export function channelProblems(c: PostChannel): string[] {
  const info = channel(c.channel)!;
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

/** Why a post can't be scheduled ([] = it can). */
export function scheduleProblems(p: Post, now = new Date()): string[] {
  const out: string[] = [];
  if (!p.at) out.push('Pick a date and time.');
  else if (Date.parse(p.at) < now.getTime() - 60_000) out.push('That time has passed — pick a future time.');
  if (!p.channels.length) out.push('Choose at least one channel.');
  for (const c of p.channels) out.push(...channelProblems(c));
  return out;
}

// ── import / export ────────────────────────────────────────────────────

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
const icsTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Long ICS lines are folded at 75 octets per RFC 5545. */
const fold = (l: string) => (l.length <= 74 ? l : l.match(/.{1,74}/g)!.join('\r\n '));

/** A subscribable calendar of dated posts (Google/Apple/Outlook "subscribe by URL"). */
export function toIcs(posts: Post[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shipcast//Content calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Shipcast content'];
  for (const p of posts.filter((x) => x.at)) {
    const start = new Date(p.at!);
    const end = new Date(start.getTime() + 30 * 60_000);
    const chans = p.channels.map((c) => channel(c.channel)?.name ?? c.channel).join(', ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@shipcast`,
      `DTSTAMP:${icsTime(now.toISOString())}`,
      `DTSTART:${icsTime(start.toISOString())}`,
      `DTEND:${icsTime(end.toISOString())}`,
      fold(`SUMMARY:${icsEscape(`${chans ? `[${chans}] ` : ''}${p.title}`)}`),
      fold(`DESCRIPTION:${icsEscape(`${p.status}${p.pillar ? ` · ${p.pillar}` : ''}\n\n${p.channels[0]?.caption.slice(0, 500) ?? ''}`)}`),
      `STATUS:${p.status === 'published' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const CSV_COLS = ['date', 'time', 'tz', 'channels', 'title', 'status', 'pillar', 'format', 'caption', 'hashtags', 'notes'] as const;
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Local wall-clock date and time of an instant in a zone. */
export function localParts(iso: string, tz: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

/** The instant a local wall-clock time in a zone refers to. */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  // Two passes handle the zone's offset (and a DST edge) without a timezone library.
  let t = guess.getTime();
  for (let i = 0; i < 2; i++) {
    const { date: d, time: hm } = localParts(new Date(t).toISOString(), tz);
    const drift = new Date(`${d}T${hm}:00Z`).getTime() - guess.getTime();
    t -= drift;
  }
  return new Date(t).toISOString();
}

export function toCsv(posts: Post[]): string {
  const rows = posts.map((p) => {
    const lp = p.at ? localParts(p.at, p.tz) : { date: '', time: '' };
    const c0 = p.channels[0];
    return [lp.date, lp.time, p.tz, p.channels.map((c) => c.channel).join(' '), p.title, p.status, p.pillar ?? '', p.format ?? '', c0?.caption ?? '', (c0?.hashtags ?? []).join(' '), p.notes].map((v) => csvCell(String(v)));
  });
  return [CSV_COLS.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

/** Posts from a CSV with the export's columns (any order; unknown columns ignored). Returns created posts and row problems. */
export async function importCsv(text: string, fallbackTz = DEFAULT_PLAN.tz): Promise<{ created: Post[]; problems: string[] }> {
  const [head, ...rows] = parseCsv(text);
  if (!head) return { created: [], problems: ['The file is empty.'] };
  const idx = (k: string) => head.findIndex((h) => h.trim().toLowerCase() === k);
  const get = (r: string[], k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
  const created: Post[] = [];
  const problems: string[] = [];
  for (const [n, r] of rows.slice(0, 1000).entries()) {
    const title = get(r, 'title');
    const chans = get(r, 'channels').split(/[\s,;]+/).filter((c) => channel(c.toLowerCase()));
    if (!title && !get(r, 'caption')) {
      problems.push(`Row ${n + 2}: no title or caption — skipped.`);
      continue;
    }
    const tz = get(r, 'tz') || fallbackTz;
    const date = get(r, 'date');
    const at = /^\d{4}-\d{2}-\d{2}$/.test(date) ? zonedToUtc(date, /^\d{1,2}:\d{2}$/.test(get(r, 'time')) ? get(r, 'time').padStart(5, '0') : '09:00', tz) : undefined;
    created.push(
      await savePost({
        title: title || get(r, 'caption').slice(0, 60),
        status: (STATUSES.includes(get(r, 'status') as PostStatus) ? get(r, 'status') : undefined) as PostStatus | undefined,
        at,
        tz,
        pillar: get(r, 'pillar') || undefined,
        format: get(r, 'format') || undefined,
        notes: get(r, 'notes'),
        channels: chans.map((c) => ({ channel: c.toLowerCase() as ChannelId, caption: get(r, 'caption'), hashtags: get(r, 'hashtags').split(/\s+/).filter(Boolean), media: [], via: 'manual' as PublishVia })),
      }),
    );
  }
  return { created, problems };
}
