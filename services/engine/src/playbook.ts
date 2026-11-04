import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { channel, listPosts, localParts, type ChannelId, type Post, type PostChannel } from './calendar.ts';
import { runClaude } from './claude.ts';
import { computePerformance, headline, readSnapshots, type Performance } from './metrics.ts';
import { home } from './paths.ts';

/**
 * The Playbook: what works for this brand, learned from its own posts. Each
 * post-channel is described by a fixed set of categorical features; a small
 * ridge regression per channel on log(lift) estimates every level's effect
 * after accounting for the others, a seeded bootstrap gives each effect a
 * band, and the same model forecasts drafts and drives Thompson-sampled
 * experiments. Everything here is deterministic given the same posts.
 */

// ── features ───────────────────────────────────────────────────────────

/** Ordered: when two features split the posts identically, the earlier one is kept. */
export const FEATURE_KEYS = ['mediaKind', 'format', 'pillar', 'weekday', 'hour', 'slides', 'captionLen', 'hashtags', 'firstComment', 'linkInCaption', 'emoji', 'trend', 'cta', 'hook'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, string> & { channel: ChannelId };

export const MEDIA_KINDS = ['pdf-carousel', 'image-carousel', 'single-image', 'video-vertical', 'video-landscape', 'text-only'] as const;
export const HOOK_TYPES = ['question', 'number', 'how-to', 'contrarian', 'story', 'before-after', 'announcement', 'bold-claim', 'curiosity', 'quote', 'other'] as const;
export type HookType = (typeof HOOK_TYPES)[number];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const HOUR_BUCKETS = ['morning', 'midday', 'afternoon', 'evening', 'night'] as const;

export function hourBucket(h: number): (typeof HOUR_BUCKETS)[number] {
  return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 14 ? 'midday' : h >= 14 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
}

export function mediaKind(c: Pick<PostChannel, 'channel' | 'media'>): (typeof MEDIA_KINDS)[number] {
  const m = c.media ?? [];
  if (m.some((f) => /\.pdf$/i.test(f))) return 'pdf-carousel';
  const video = m.find((f) => /\.(mp4|mov|webm|m4v)$/i.test(f));
  if (video) {
    if (/vertical|reel|9x16|tiktok|shorts?\b|story|portrait/i.test(video)) return 'video-vertical';
    if (/landscape|16x9|wide/i.test(video)) return 'video-landscape';
    // Where the path doesn't say, the channel does: these only take vertical video.
    return ['tiktok', 'instagram'].includes(c.channel) ? 'video-vertical' : 'video-landscape';
  }
  const images = m.filter((f) => /\.(png|jpe?g|gif|webp|avif)$/i.test(f));
  return images.length > 1 ? 'image-carousel' : images.length === 1 ? 'single-image' : 'text-only';
}

const bucket = (n: number, edges: [number, string][], last: string) => edges.find(([max]) => n <= max)?.[1] ?? last;
const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|dev|ai|app|co|org|net)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** The first line people see — the hook. */
export const firstLine = (c: Pick<PostChannel, 'caption' | 'title'>, title = '') => (c.caption ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? c.title ?? title;

/** Deterministic hook rules; null when no rule places the line. Order matters: the first match wins. */
export function hookByRules(line: string): HookType | null {
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

export function ctaOf(text: string): 'question' | 'comment-prompt' | 'link' | 'save-share' | 'none' {
  const tail = text.trim().slice(-400);
  if (/\b(comment|tell me|let me know|drop (a|an|your)|reply with|in the comments|below 👇|type ["“]?\w+["”]?)\b/i.test(tail)) return 'comment-prompt';
  if (/\b(save (this|it|for later)|share (this|it|with)|repost|bookmark|send (this|it) to|tag (a|someone))\b/i.test(tail)) return 'save-share';
  if (/\b(link in|link below|first comment|sign up|try it|book a|check (it )?out|read more|download|get (it|started))\b/i.test(tail) || URL_RE.test(tail)) return 'link';
  if (/\?\s*$/.test(tail.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '')) return 'question';
  return 'none';
}

/** Everything the model knows about one post on one channel. `hook` and `slides` override what the post alone can tell. */
export function featuresOf(p: Post, ch: ChannelId, opts: { hook?: string; slides?: number } = {}): Features | null {
  const c = p.channels.find((x) => x.channel === ch);
  if (!c) return null;
  const at = c.sentAt ?? p.at;
  const lp = at ? localParts(at, p.tz || 'UTC') : null;
  const kind = mediaKind(c);
  const slides = opts.slides ?? (kind === 'image-carousel' ? c.media.filter((f) => /\.(png|jpe?g|gif|webp|avif)$/i.test(f)).length : undefined);
  const caption = c.caption ?? '';
  return {
    channel: ch,
    mediaKind: kind,
    format: p.format || 'none',
    pillar: p.pillar || 'none',
    weekday: lp ? DAYS[new Date(`${lp.date}T12:00:00Z`).getUTCDay()] : 'unknown',
    hour: lp ? hourBucket(Number(lp.time.slice(0, 2))) : 'unknown',
    slides: !['pdf-carousel', 'image-carousel'].includes(kind) ? 'none' : slides === undefined ? 'unknown' : bucket(slides, [[1, '1'], [5, '2-5'], [10, '6-10']], '11+'),
    captionLen: bucket(caption.length, [[149, 'short'], [599, 'medium'], [1299, 'long']], 'very-long'),
    hashtags: bucket(c.hashtags.length, [[0, '0'], [3, '1-3'], [6, '4-6']], '7+'),
    firstComment: !c.firstComment?.trim() ? 'none' : URL_RE.test(c.firstComment) ? 'link' : 'text',
    linkInCaption: URL_RE.test(caption) ? 'yes' : 'no',
    emoji: bucket((caption.match(EMOJI_RE) ?? []).length, [[0, '0'], [2, '1-2']], '3+'),
    trend: p.trend ? 'yes' : 'no',
    cta: ctaOf(caption),
    hook: opts.hook ?? hookByRules(firstLine(c, p.title)) ?? 'other',
  };
}

// ── hook labels for lines the rules can't place ───────────────────────

const metricsDir = () => join(home(), 'metrics');
const hooksFile = () => join(metricsDir(), 'hooks.json');
const lineKey = (l: string) => createHash('sha1').update(l.trim().toLowerCase()).digest('hex').slice(0, 16);

async function readJsonFile<T>(f: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJsonFile(f: string, data: unknown) {
  await mkdir(metricsDir(), { recursive: true });
  const tmp = `${f}.${process.pid}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data) + '\n');
  await rename(tmp, f);
}

export function hookPrompt(lines: string[]): string {
  return `Label the hook type of each opening line of a social post. Allowed labels: ${HOOK_TYPES.join(', ')}.
- bold-claim: a strong statement of fact or opinion; curiosity: withholds something to make you read on; quote: someone's words; other: none fit.

${lines.map((l, i) => `${i + 1}. ${l.slice(0, 300)}`).join('\n')}

Reply with JSON only: [{"i": <number>, "type": "<label>"}]`;
}

/** Hook type per line: rules first, then the cache, then one batched call for the rest. Lines that still get no valid label are "other" (and not cached, so a later pass can try again). */
export async function labelHooks(lines: string[], ask: (p: string) => Promise<string> = askClaude): Promise<Map<string, HookType>> {
  const out = new Map<string, HookType>();
  const cache = await readJsonFile<Record<string, HookType>>(hooksFile(), {});
  const todo: string[] = [];
  for (const l of new Set(lines.map((x) => x.trim()).filter(Boolean))) {
    const r = hookByRules(l) ?? cache[lineKey(l)];
    if (r) out.set(l, r);
    else todo.push(l);
  }
  if (todo.length) {
    const batch = todo.slice(0, 200);
    let reply: unknown = [];
    try {
      reply = JSON.parse((await ask(hookPrompt(batch))).replace(/^[^[]*/s, '').replace(/[^\]]*$/s, ''));
    } catch {}
    let fresh = 0;
    for (const r of Array.isArray(reply) ? reply : []) {
      const l = batch[Number(r?.i) - 1];
      if (l && (HOOK_TYPES as readonly string[]).includes(r?.type)) {
        out.set(l, r.type);
        cache[lineKey(l)] = r.type;
        fresh++;
      }
    }
    if (fresh) await writeJsonFile(hooksFile(), cache);
  }
  for (const l of todo) if (!out.has(l)) out.set(l, 'other');
  return out;
}

// ── ridge regression ───────────────────────────────────────────────────

/** Small seeded PRNG (mulberry32) so bootstraps and samplers are repeatable. */
export function seededRng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

/** Cholesky factor of a symmetric positive-definite matrix (lower triangle). */
function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const l = a.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k];
      l[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / l[j][j];
    }
  return l;
}
function cholSolve(l: number[][], b: number[]): number[] {
  const n = l.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i][k] * y[k];
    y[i] = s / l[i][i];
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k][i] * x[k];
    x[i] = s / l[i][i];
  }
  return x;
}

/** Ridge on sparse one-hot rows: `rows[i]` lists the active columns (column 0 is the unpenalised intercept). */
function ridge(rows: number[][], y: number[], p: number, lambda: number, wantHat = false): { beta: number[]; hat?: number[] } {
  const a = Array.from({ length: p }, (_, i) => new Array<number>(p).fill(0).map((_, j) => (i === j && i > 0 ? lambda : 0)));
  const b = new Array<number>(p).fill(0);
  for (const [r, cols] of rows.entries()) {
    for (const i of cols) {
      b[i] += y[r];
      for (const j of cols) a[i][j] += 1;
    }
  }
  const l = cholesky(a);
  const beta = cholSolve(l, b);
  if (!wantHat) return { beta };
  // h_ii = x_iᵀ A⁻¹ x_i, for leave-one-out errors and the residual degrees of freedom.
  const inv = Array.from({ length: p }, (_, i) => cholSolve(l, Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))));
  return { beta, hat: rows.map((cols) => cols.reduce((s, i) => s + cols.reduce((t, j) => t + inv[i][j], 0), 0)) };
}

export interface TrainingRow {
  post: string;
  channel: ChannelId;
  features: Features;
  /** The post's headline lift on this channel (× your usual). */
  lift: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Effect {
  feature: FeatureKey;
  level: string;
  /** Multiplicative: 2.1 means 2.1× your usual, everything else equal. */
  effect: number;
  /** 80 % bootstrap band. */
  lo: number;
  hi: number;
  n: number;
  confidence: Confidence;
  posts: string[];
}

export interface ChannelModel {
  channel: ChannelId;
  n: number;
  lambda: number;
  intercept: number;
  /** Residual spread in log-lift: how much posts vary beyond what the features explain. */
  sigma: number;
  columns: { feature: FeatureKey; level: string }[];
  coef: number[];
  /** Bootstrap draws of [intercept, ...coef], for bands and sampling. */
  boot: number[][];
  effects: Effect[];
}

export const MIN_POSTS = 6;
export const MIN_LEVEL_N = 3;
const BOOT = 200;
const PRIOR_TAU = 0.5;
const Z80 = 1.2816;
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};

/** High needs enough posts, a band that stays on one side of "usual", and an effect big enough to act on (≥ ~10 %). */
export function confidenceOf(n: number, effect: number, lo: number, hi: number): Confidence {
  const width = Math.log(hi) - Math.log(lo);
  const clear = lo > 1 || hi < 1;
  if (n >= 8 && clear && width < 1.2 && Math.abs(Math.log(effect)) >= 0.1) return 'high';
  if (n >= MIN_LEVEL_N + 1 && (clear || width < 0.8)) return 'medium';
  return 'low';
}

/** Features that only mean something for some posts (slide count: carousels). They're fitted on what the main model leaves unexplained, among the posts they apply to, so they refine an effect rather than split its credit. */
const REFINES: Partial<Record<FeatureKey, string[]>> = { slides: ['none', 'unknown'] };

/** True when `f` only relabels `g` on these rows (e.g. format "document" ⇔ PDF): keeping both would split the credit between them. */
function aliasOf(rows: TrainingRow[], g: FeatureKey, f: FeatureKey): boolean {
  const fwd = new Map<string, string>();
  const back = new Map<string, string>();
  return rows.every((r) => {
    const a = r.features[g], b = r.features[f];
    if ((fwd.get(a) ?? b) !== b || (back.get(b) ?? a) !== a) return false;
    fwd.set(a, b);
    back.set(b, a);
    return true;
  });
}

/**
 * One channel's model. Every observed level gets a column (no dropped
 * baseline): ridge keeps that identifiable, and after the fit each feature's
 * effects are re-centred on the post-weighted mean, so an effect reads as
 * "× your usual" rather than "× whichever level happened to be commonest".
 */
export function fitChannel(rows: TrainingRow[], opts: { seed?: number; lambda?: number } = {}): ChannelModel | null {
  const data = rows.filter((r) => r.lift > 0 && Number.isFinite(r.lift));
  if (data.length < MIN_POSTS) return null;
  const n = data.length;
  const y = data.map((r) => Math.log(r.lift));
  const applies = (f: FeatureKey, r: TrainingRow) => !REFINES[f]?.includes(r.features[f]);
  const keep: FeatureKey[] = [];
  const refine: FeatureKey[] = [];
  for (const f of FEATURE_KEYS) {
    const rs = data.filter((r) => applies(f, r));
    if (new Set(rs.map((r) => r.features[f])).size < 2 || (REFINES[f] && rs.length < MIN_POSTS)) continue;
    if (!keep.some((g) => aliasOf(rs, g, f))) (REFINES[f] ? refine : keep).push(f);
  }
  const all = [...keep, ...refine];
  const columns: { feature: FeatureKey; level: string }[] = [];
  for (const f of all) for (const lv of [...new Set(data.filter((r) => applies(f, r)).map((r) => r.features[f]))].sort()) columns.push({ feature: f, level: lv });
  const colOf = new Map(columns.map((c, i) => [`${c.feature}\t${c.level}`, i + 1]));
  const p = columns.length + 1;
  const active = (r: TrainingRow, fs: FeatureKey[]) => [0, ...fs.filter((f) => applies(f, r)).map((f) => colOf.get(`${f}\t${r.features[f]}`)!)];
  const x1 = data.map((r) => active(r, keep));
  const x = data.map((r) => active(r, all));
  const counts = columns.map((c) => data.filter((r) => r.features[c.feature] === c.level).length);
  const groups = all.map((f) => ({ f, idx: columns.flatMap((c, i) => (c.feature === f ? [i] : [])) }));
  const centre = (beta: number[]) => {
    const b = [...beta];
    for (const { f, idx } of groups) {
      const tot = idx.reduce((s, i) => s + counts[i], 0);
      const m = idx.reduce((s, i) => s + (counts[i] / tot) * b[i + 1], 0);
      for (const i of idx) b[i + 1] -= m;
      if (keep.includes(f)) b[0] += m;
    }
    return b;
  };
  const dot = (cols: number[], b: number[]) => cols.reduce((t, j) => t + b[j], 0);
  const fitRows = (rowIdx: number[], lambda: number, wantHat = false) => {
    const s1 = ridge(rowIdx.map((i) => x1[i]), rowIdx.map((i) => y[i]), p, lambda, wantHat);
    const beta = [...s1.beta];
    for (const { f, idx } of groups.filter((g) => refine.includes(g.f))) {
      const app = rowIdx.filter((i) => applies(f, data[i]));
      if (!app.length) continue;
      const local = new Map(idx.map((ci, k) => [ci + 1, k + 1]));
      const b2 = ridge(app.map((i) => [0, local.get(colOf.get(`${f}\t${data[i].features[f]}`)!)!]), app.map((i) => y[i] - dot(x1[i], s1.beta)), idx.length + 1, lambda).beta;
      for (const [ci, k] of local) beta[ci] = b2[k];
    }
    return { beta: centre(beta), hat: s1.hat };
  };

  // λ is σ²/τ²: the posts' own noise over a prior that most effects sit within about ×0.6–×1.6 (τ = 0.5 in log).
  // Noisy channels get shrunk harder; clean ones are trusted sooner. σ comes from a first fit at λ = 1.
  let lambda = opts.lambda ?? 1;
  if (opts.lambda === undefined) {
    const { beta, hat } = ridge(x1, y, p, 1, true);
    const s2 = x1.reduce((s, cols, i) => s + (y[i] - dot(cols, beta)) ** 2, 0) / Math.max(1, n - hat!.reduce((s, h) => s + h, 0));
    lambda = round(Math.min(10, Math.max(0.1, s2 / PRIOR_TAU ** 2)), 3);
  }
  const fit = fitRows(data.map((_, i) => i), lambda, true);
  const beta = fit.beta;
  const rss = x.reduce((s, cols, i) => s + (y[i] - dot(cols, beta)) ** 2, 0);
  const df = fit.hat!.reduce((s, h) => s + h, 0) + groups.filter((g) => refine.includes(g.f)).reduce((s, g) => s + g.idx.length - 1, 0);
  const sigma = Math.sqrt(rss / Math.max(1, n - df));

  const rng = seededRng(opts.seed ?? 7);
  const boot: number[][] = [];
  for (let b = 0; b < BOOT; b++) boot.push(fitRows(Array.from({ length: n }, () => Math.floor(rng() * n)), lambda).beta.map((v) => round(v)));

  const effects: Effect[] = columns.map((c, i) => {
    const draws = boot.map((d) => d[i + 1]);
    const lo = Math.exp(pct(draws, 0.1));
    const hi = Math.exp(pct(draws, 0.9));
    return {
      feature: c.feature,
      level: c.level,
      effect: round(Math.exp(beta[i + 1]), 3),
      lo: round(lo, 3),
      hi: round(hi, 3),
      n: counts[i],
      confidence: confidenceOf(counts[i], Math.exp(beta[i + 1]), lo, hi),
      posts: data.filter((r) => r.features[c.feature] === c.level).map((r) => r.post),
    };
  });
  return { channel: data[0].channel, n, lambda, intercept: round(beta[0]), sigma: round(sigma), columns, coef: beta.slice(1).map((v) => round(v)), boot, effects };
}

// ── playbook ───────────────────────────────────────────────────────────

const LEVEL_NAMES: Record<string, string> = {
  'pdf-carousel': 'PDF carousel', 'image-carousel': 'Image carousel', 'single-image': 'Single image', 'video-vertical': 'Vertical video', 'video-landscape': 'Landscape video', 'text-only': 'Text only',
  morning: 'Mornings (5–11)', midday: 'Midday (11–14)', afternoon: 'Afternoons (14–17)', evening: 'Evenings (17–21)', night: 'Nights (21–5)',
  Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays', Sun: 'Sundays',
};

export function levelLabel(f: FeatureKey, level: string): string {
  switch (f) {
    case 'mediaKind': case 'weekday': case 'hour': return LEVEL_NAMES[level] ?? level;
    case 'format': return `Format: ${level}`;
    case 'pillar': return `Pillar: ${level}`;
    case 'slides': return level === 'none' ? 'No slides' : `${level} slides`;
    case 'captionLen': return `${level[0].toUpperCase()}${level.slice(1)} captions`;
    case 'hashtags': return `${level} hashtags`;
    case 'firstComment': return level === 'none' ? 'No first comment' : level === 'link' ? 'Link in first comment' : 'Text first comment';
    case 'linkInCaption': return level === 'yes' ? 'Link in caption' : 'No link in caption';
    case 'emoji': return `${level} emoji`;
    case 'trend': return level === 'yes' ? 'Trend-linked' : 'Not trend-linked';
    case 'cta': return level === 'none' ? 'No call to action' : `CTA: ${level}`;
    case 'hook': return `${level[0].toUpperCase()}${level.slice(1)} hooks`;
  }
}

const fx = (x: number) => (x >= 10 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')) + '×';

export interface PlaybookFinding extends Effect {
  label: string;
}
export interface HeatCell {
  weekday: string;
  hour: string;
  /** Geometric mean lift of the posts in this cell. */
  lift: number;
  n: number;
  posts: string[];
}
export interface ChannelPlaybook {
  channel: ChannelId;
  n: number;
  ready: boolean;
  /** Why nothing is shown yet, when it isn't. */
  message?: string;
  wins: PlaybookFinding[];
  losses: PlaybookFinding[];
  heat: HeatCell[];
  bestSlots: HeatCell[];
  narrative?: string[];
  model?: ChannelModel;
}
export interface Playbook {
  computedAt: string;
  channels: ChannelPlaybook[];
}

const CONF_W: Record<Confidence, number> = { high: 1, medium: 0.6, low: 0.3 };

export function heatCells(rows: TrainingRow[]): HeatCell[] {
  const cells = new Map<string, TrainingRow[]>();
  for (const r of rows) if (r.features.weekday !== 'unknown') cells.set(`${r.features.weekday}\t${r.features.hour}`, [...(cells.get(`${r.features.weekday}\t${r.features.hour}`) ?? []), r]);
  return [...cells.entries()]
    .map(([k, rs]) => ({ weekday: k.split('\t')[0], hour: k.split('\t')[1], lift: round(Math.exp(rs.reduce((s, r) => s + Math.log(r.lift), 0) / rs.length), 2), n: rs.length, posts: rs.map((r) => r.post) }))
    .sort((a, b) => DAYS.indexOf(a.weekday) - DAYS.indexOf(b.weekday) || HOUR_BUCKETS.indexOf(a.hour as never) - HOUR_BUCKETS.indexOf(b.hour as never));
}

export function channelPlaybook(ch: ChannelId, rows: TrainingRow[], opts: { seed?: number } = {}): ChannelPlaybook {
  const mine = rows.filter((r) => r.channel === ch && r.lift > 0);
  const heat = heatCells(mine);
  const bestSlots = heat.filter((c) => c.n >= 2).sort((a, b) => b.lift - a.lift || b.n - a.n).slice(0, 3);
  const model = mine.length >= MIN_POSTS ? fitChannel(mine, opts) : null;
  if (!model) return { channel: ch, n: mine.length, ready: false, message: `Not enough data yet — ${mine.length} of ${MIN_POSTS} posts with numbers on ${channel(ch)?.name ?? ch}.`, wins: [], losses: [], heat, bestSlots };
  const name = channel(ch)?.name ?? ch;
  const usable = model.effects.filter((e) => e.n >= MIN_LEVEL_N && Math.abs(Math.log(e.effect)) >= 0.05);
  const finding = (e: Effect): PlaybookFinding => ({ ...e, label: `${name} · ${levelLabel(e.feature, e.level)}: ${fx(e.effect)} your usual (${e.n} posts, ${e.confidence} confidence)` });
  const score = (e: Effect) => Math.abs(Math.log(e.effect)) * CONF_W[e.confidence];
  const wins = usable.filter((e) => e.effect > 1).sort((a, b) => score(b) - score(a)).slice(0, 5).map(finding);
  const losses = usable.filter((e) => e.effect < 1).sort((a, b) => score(b) - score(a)).slice(0, 5).map(finding);
  return { channel: ch, n: mine.length, ready: true, ...(wins.length || losses.length ? {} : { message: 'No clear patterns yet — nothing stands out from your usual with enough posts behind it.' }), wins, losses, heat, bestSlots, model };
}

export function buildPlaybook(rows: TrainingRow[], now = new Date(), opts: { seed?: number } = {}): Playbook {
  const chans = [...new Set(rows.map((r) => r.channel))].sort();
  return { computedAt: now.toISOString(), channels: chans.map((ch) => channelPlaybook(ch, rows, opts)) };
}

/** Count a PDF's pages without a parser: every page object says "/Type /Page". */
async function pdfPages(file: string): Promise<number | undefined> {
  try {
    const n = ((await readFile(isAbsolute(file) ? file : join(home(), file), 'latin1')).match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    return n || undefined;
  } catch {
    return undefined;
  }
}

/** Training rows from published posts that have a headline lift. */
export async function trainingRows(opts: { posts?: Post[]; perf?: Performance[]; ask?: (p: string) => Promise<string> } = {}): Promise<TrainingRow[]> {
  const posts = opts.posts ?? (await listPosts());
  const perf = opts.perf ?? computePerformance(await readSnapshots());
  const pairs: { p: Post; c: PostChannel; lift: number }[] = [];
  for (const p of posts)
    for (const c of p.channels) {
      const h = headline(perf, p.id, c.channel);
      if (h?.lift && h.lift > 0) pairs.push({ p, c, lift: h.lift });
    }
  const hooks = await labelHooks(pairs.map(({ p, c }) => firstLine(c, p.title)), opts.ask);
  const rows: TrainingRow[] = [];
  for (const { p, c, lift } of pairs) {
    const pdf = c.media.find((f) => /\.pdf$/i.test(f));
    const f = featuresOf(p, c.channel, { hook: hooks.get(firstLine(c, p.title).trim()), ...(pdf ? { slides: await pdfPages(pdf) } : {}) });
    if (f) rows.push({ post: p.id, channel: c.channel, features: f, lift });
  }
  return rows;
}

const playbookFile = () => join(metricsDir(), 'playbook.json');

export async function readPlaybook(): Promise<Playbook | null> {
  return readJsonFile<Playbook | null>(playbookFile(), null);
}

/** The playbook without the bootstrap draws (what the UI needs). */
export function publicPlaybook(pb: Playbook | null): Playbook | { computedAt: null; channels: [] } {
  if (!pb) return { computedAt: null, channels: [] };
  return { ...pb, channels: pb.channels.map(({ model, ...c }) => ({ ...c, ...(model ? { model: { ...model, boot: [] } } : {}) })) };
}

/** Recompute from every post with numbers, write the "why" sentences, and cache it. */
export async function refreshPlaybook(opts: { now?: Date; ask?: (p: string) => Promise<string>; narrative?: boolean; posts?: Post[]; perf?: Performance[] } = {}): Promise<Playbook> {
  const pb = buildPlaybook(await trainingRows(opts), opts.now);
  if (opts.narrative !== false && pb.channels.some((c) => c.wins.length || c.losses.length)) {
    const why = await playbookNarrative(pb, opts.ask).catch(() => ({}) as Record<string, string[]>);
    for (const c of pb.channels) if (why[c.channel]?.length) c.narrative = why[c.channel];
  }
  await writeJsonFile(playbookFile(), pb);
  return pb;
}

// ── narrative ──────────────────────────────────────────────────────────

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')));

/** Keep only sentences whose every number appears in the input the sentences were written from. */
export function validateNarrative(sentences: string[], input: string): string[] {
  const allowed = new Set(numbersIn(input));
  return sentences.map((s) => String(s).trim()).filter((s) => s && s.length <= 300 && numbersIn(s).every((n) => allowed.has(n)));
}

export function narrativeInput(pb: Playbook): string {
  return pb.channels
    .filter((c) => c.wins.length || c.losses.length)
    .map((c) => [`[${c.channel}] ${c.n} posts with numbers`, ...c.wins.map((f) => `+ ${f.label}`), ...c.losses.map((f) => `- ${f.label}`), ...c.bestSlots.map((s) => `slot ${LEVEL_NAMES[s.weekday]} ${LEVEL_NAMES[s.hour]}: ${fx(s.lift)} your usual (${s.n} posts)`)].join('\n'))
    .join('\n\n');
}

export function narrativePrompt(input: string): string {
  return `Here is what one brand's own post history says works for it, per channel (effects are × that brand's usual result on that channel, after accounting for the other features):

${input}

For each channel, write 2–4 short plain-English sentences that explain the pattern and what to do next. Use only the numbers above — never introduce a new number, percentage or count. Say "your usual", not "average". Mention low confidence where it applies.

Reply with JSON only: {"<channel id>": ["sentence", ...]}`;
}

export async function playbookNarrative(pb: Playbook, ask: (p: string) => Promise<string> = askClaude): Promise<Record<string, string[]>> {
  const input = narrativeInput(pb);
  if (!input) return {};
  let reply: Record<string, unknown> = {};
  try {
    reply = JSON.parse((await ask(narrativePrompt(input))).replace(/^[^{]*/s, '').replace(/[^}]*$/s, ''));
  } catch {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const c of pb.channels) {
    const ss = reply?.[c.channel];
    if (!Array.isArray(ss)) continue;
    const ok = validateNarrative(ss.map(String), input).slice(0, 4);
    if (ok.length) out[c.channel] = ok;
  }
  return out;
}

// ── forecast ───────────────────────────────────────────────────────────

export interface Forecast {
  channel: ChannelId;
  lift: number;
  lo: number;
  hi: number;
  label: string;
  /** Features the model has never seen at this level, so they add nothing. */
  unseen: FeatureKey[];
}

/** Predicted lift for a draft's features: point from the fit, an 80 % band from the bootstrap plus the posts' own spread. */
export function forecastFeatures(model: ChannelModel, f: Features): Forecast {
  const idx: number[] = [];
  const unseen = new Set<FeatureKey>();
  const modelled = new Set(model.columns.map((c) => c.feature));
  for (const [i, c] of model.columns.entries()) if (f[c.feature] === c.level) idx.push(i);
  for (const k of modelled) if (!model.columns.some((c) => c.feature === k && c.level === f[k])) unseen.add(k);
  const mu = model.intercept + idx.reduce((s, i) => s + model.coef[i], 0);
  const draws = model.boot.map((d) => d[0] + idx.reduce((s, i) => s + d[i + 1], 0));
  const m = draws.reduce((s, v) => s + v, 0) / (draws.length || 1);
  const v = draws.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, draws.length - 1);
  const sd = Math.sqrt(v + model.sigma ** 2);
  const lo = Math.exp(mu - Z80 * sd), hi = Math.exp(mu + Z80 * sd);
  return { channel: model.channel, lift: round(Math.exp(mu), 2), lo: round(lo, 2), hi: round(hi, 2), label: `likely ${lo.toFixed(1)}–${hi.toFixed(1)}× your usual`, unseen: [...unseen] };
}

/** Forecast for one draft channel, or null while that channel's model isn't ready. */
export async function forecastPost(p: Post, ch: ChannelId, pb?: Playbook | null): Promise<Forecast | null> {
  const model = (pb === undefined ? await readPlaybook() : pb)?.channels.find((c) => c.channel === ch)?.model;
  if (!model) return null;
  const c = p.channels.find((x) => x.channel === ch);
  if (!c) return null;
  // Rules and the cache only: a forecast shouldn't spend a model call.
  const cache = await readJsonFile<Record<string, HookType>>(hooksFile(), {});
  const line = firstLine(c, p.title);
  const f = featuresOf(p, ch, { hook: hookByRules(line) ?? cache[lineKey(line)] ?? 'other' });
  return f && forecastFeatures(model, f);
}

export interface StoredForecast {
  post: string;
  channel: ChannelId;
  at: string;
  lift: number;
  lo: number;
  hi: number;
}
const forecastsFile = () => join(metricsDir(), 'forecasts.json');
export const readForecasts = () => readJsonFile<StoredForecast[]>(forecastsFile(), []);

/** Remember what the model expected when a post was scheduled, to score it once the numbers come in. */
export async function recordForecast(p: Post, now = new Date()): Promise<StoredForecast[]> {
  const pb = await readPlaybook();
  const fresh: StoredForecast[] = [];
  for (const c of p.channels) {
    const f = await forecastPost(p, c.channel, pb);
    if (f) fresh.push({ post: p.id, channel: c.channel, at: now.toISOString(), lift: f.lift, lo: f.lo, hi: f.hi });
  }
  if (fresh.length) await writeJsonFile(forecastsFile(), [...(await readForecasts()).filter((x) => !(x.post === p.id && fresh.some((f) => f.channel === x.channel))), ...fresh]);
  return fresh;
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ra = ranks(a), rb = ranks(b);
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length, mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? round(num / Math.sqrt(da * db), 3) : null;
}

export interface Calibration {
  n: number;
  /** Share of actual lifts that landed inside the forecast band (aim: about 0.8). */
  inside: number | null;
  /** Rank correlation between forecast and actual: does a higher forecast mean a better post? */
  rank: number | null;
  rows: (StoredForecast & { actual: number; inBand: boolean })[];
}

export function scoreForecasts(forecasts: StoredForecast[], actual: (post: string, ch: ChannelId) => number | undefined): Calibration {
  const rows = forecasts.flatMap((f) => {
    const a = actual(f.post, f.channel);
    return a !== undefined && a > 0 ? [{ ...f, actual: a, inBand: a >= f.lo && a <= f.hi }] : [];
  });
  return { n: rows.length, inside: rows.length ? round(rows.filter((r) => r.inBand).length / rows.length, 3) : null, rank: spearman(rows.map((r) => r.lift), rows.map((r) => r.actual)), rows };
}

export async function forecastCalibration(): Promise<Calibration> {
  const perf = computePerformance(await readSnapshots());
  return scoreForecasts(await readForecasts(), (post, ch) => headline(perf, post, ch)?.lift);
}

// ── experiments ────────────────────────────────────────────────────────

/** The media a format usually makes on a channel, so a format choice can draw on the media-kind effects too. */
export function formatMedia(format: string, ch: ChannelId): string | undefined {
  if ((MEDIA_KINDS as readonly string[]).includes(format)) return format;
  if (/^(carousel|document|case-study|pptx)$/.test(format)) return ch === 'linkedin' ? 'pdf-carousel' : 'image-carousel';
  if (/photo-carousel|quote-cards/.test(format)) return 'image-carousel';
  if (/social-post|infographic|pins|thumbnail/.test(format)) return 'single-image';
  if (/reel|shorts|social-short|ugc-ad|tiktok/.test(format)) return 'video-vertical';
  if (/youtube-video|explainer|product-tour|demo|audiogram|longform/.test(format)) return ch === 'youtube' ? 'video-landscape' : 'video-vertical';
  if (/newsletter|blog|copy-kit|email/.test(format)) return 'text-only';
  return undefined;
}

export interface SlotChoice {
  format?: string;
  hookType?: string;
  experiment: boolean;
  reason?: string;
}

interface Arm {
  value: string;
  cols: number[];
  n: number;
}

/**
 * Thompson sampling: draw each candidate's lift from its posterior (lognormal
 * around the fitted effect, spread from the bootstrap) and take the best draw.
 * With probability `explore` the slot instead tests the least-tried candidate
 * of one dimension and says so. `explore = 0` turns experiments off entirely.
 */
export async function chooseForSlot(opts: { channel: ChannelId; candidates: { formats?: string[]; hookTypes?: string[] }; explore?: number; rng?: () => number; model?: ChannelModel | null }): Promise<SlotChoice> {
  const rng = opts.rng ?? Math.random;
  const explore = Math.max(0, Math.min(1, opts.explore ?? 0.2));
  const model = opts.model !== undefined ? opts.model : ((await readPlaybook())?.channels.find((c) => c.channel === opts.channel)?.model ?? null);
  const name = channel(opts.channel)?.name ?? opts.channel;
  const colsFor = (f: FeatureKey, lv: string | undefined) => (model && lv !== undefined ? model.columns.flatMap((c, i) => (c.feature === f && c.level === lv ? [i] : [])) : []);
  const nOf = (cols: number[]) => (cols.length && model ? Math.max(...cols.map((i) => model.effects[i].n)) : 0);
  const arms = {
    format: (opts.candidates.formats ?? []).map((v): Arm => {
      const own = colsFor('format', v);
      const cols = [...own, ...colsFor('mediaKind', formatMedia(v, opts.channel))];
      // Untested as a format even when its media kind is well known: the format itself is what the experiment learns about.
      return { value: v, cols, n: nOf(own) };
    }),
    hook: (opts.candidates.hookTypes ?? []).map((v): Arm => {
      const cols = colsFor('hook', v);
      return { value: v, cols, n: nOf(cols) };
    }),
  };
  const sample = (a: Arm) => {
    if (!model || !a.cols.length) return 0.5 * gauss(rng);
    const mu = a.cols.reduce((s, i) => s + model.coef[i], 0);
    const draws = model.boot.map((d) => a.cols.reduce((s, i) => s + d[i + 1], 0));
    const m = draws.reduce((s, v) => s + v, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, draws.length - 1));
    return mu + Math.max(sd, 0.05) * gauss(rng);
  };
  const exploit = (as: Arm[]) => {
    // With experiments off, untried options don't get a turn by luck of a wide prior.
    const pool = explore === 0 && as.some((a) => a.n >= MIN_LEVEL_N) ? as.filter((a) => a.n >= MIN_LEVEL_N) : as;
    let best: Arm | undefined, top = -Infinity;
    for (const a of pool) {
      const s = sample(a);
      if (s > top) (top = s), (best = a);
    }
    return best;
  };
  const pick = { format: exploit(arms.format), hook: exploit(arms.hook) };
  const out = (experiment: boolean, reason?: string): SlotChoice => ({ ...(pick.format ? { format: pick.format.value } : {}), ...(pick.hook ? { hookType: pick.hook.value } : {}), experiment, ...(reason ? { reason } : {}) });
  if (!(explore > 0 && rng() < explore)) return out(false);
  // Test the dimension whose least-tried alternative has the fewest posts behind it.
  const alt = (k: 'format' | 'hook') => {
    const rest = arms[k].filter((a) => a !== pick[k]);
    const min = Math.min(...rest.map((a) => a.n));
    const least = rest.filter((a) => a.n === min);
    return least.length ? least[Math.floor(rng() * least.length)] : undefined;
  };
  const cands = (['format', 'hook'] as const).map((k) => ({ k, a: alt(k) })).filter((x): x is { k: 'format' | 'hook'; a: Arm } => !!x.a);
  if (!cands.length) return out(false);
  const minN = Math.min(...cands.map((c) => c.a.n));
  const tied = cands.filter((c) => c.a.n === minN);
  const { k, a } = tied[Math.floor(rng() * tied.length)];
  pick[k] = a;
  const what = k === 'format' ? `the ${a.value} format` : `${a.value} hooks`;
  return out(true, a.n === 0 ? `Experiment: ${what} — never tried on ${name} yet.` : `Experiment: ${what} — only ${a.n} ${name} post${a.n === 1 ? '' : 's'} so far.`);
}

// ── the model call ─────────────────────────────────────────────────────

const ROLE = 'You are the analyst inside Shipcast, a local marketing studio. You label and explain numbers you are given; you never invent numbers. Do not use tools. Reply with JSON only.';

async function askClaude(prompt: string, timeoutMs = 180_000): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-playbook-'));
  try {
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: [], noTools: true, model: 'sonnet', appendSystemPrompt: ROLE, extraArgs: ['--max-turns', '2', '--disallowedTools', 'WebFetch,WebSearch,Bash,Read,Write,Edit,Task', '--setting-sources', 'project', '--strict-mcp-config'], env: { MAX_THINKING_TOKENS: '0' }, onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; else if (e.kind === 'text') text = text || e.text; } });
    const timer = setTimeout(run.kill, timeoutMs);
    const r = await run.done;
    clearTimeout(timer);
    return r.result?.text || text;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
