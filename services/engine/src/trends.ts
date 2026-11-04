import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from './claude.ts';
import { loadPacks } from './packs.ts';
import { home, rootHome } from './paths.ts';
import { getSecret } from './voices.ts';

/**
 * Trend radar. Free public sources are read without a model (Hacker News,
 * Reddit's marketing communities, Google Trends' RSS, YouTube when a key is
 * connected); one Claude call per refresh — with web search, on the user's
 * own subscription — clusters them, adds what marketers report is working on
 * each platform this month, and returns trend cards. Cards are merged with
 * history: seen again → more confident; unseen three refreshes → archived.
 * Only links and numbers are kept, never anyone's post or media.
 */

export interface Signal {
  source: 'hn' | 'reddit' | 'google-trends' | 'youtube';
  title: string;
  url: string;
  metric: number;
  metricLabel: string;
  at: string;
  where?: string;
}

export type TrendKind = 'format' | 'hook' | 'topic' | 'tactic' | 'platform-change';

export interface TrendCard {
  key: string;
  kind: TrendKind;
  platform: string;
  title: string;
  what: string;
  evidence: { url: string; metric?: string; date?: string }[];
  strength: 'rising' | 'steady' | 'fading';
  recipe: { pack: string; angle: string; hookPattern: string; structure: string[] };
  firstSeen: string;
  lastSeen: string;
  seen: number;
  missed: number;
  archived?: boolean;
}

type Fetch = typeof fetch;
const UA = { 'user-agent': 'Shipcast trend radar (local app; https://github.com/rajdavee/shipcast)' };

export const REDDIT_SUBS = ['marketing', 'socialmedia', 'content_marketing', 'LinkedInTips', 'SaaS', 'startups', 'Entrepreneur', 'TikTokhelp'];
export const HN_QUERIES = ['marketing', 'launch', 'LinkedIn', 'TikTok', 'newsletter', 'growth'];

export async function fromHN(f: Fetch = fetch, now = new Date(), queries = HN_QUERIES): Promise<Signal[]> {
  const since = Math.floor(now.getTime() / 1000) - 14 * 86_400;
  const out: Signal[] = [];
  for (const q of queries) {
    const r = await f(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>40&hitsPerPage=10`, { headers: UA, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!r?.ok) continue;
    const j = (await r.json().catch(() => ({}))) as { hits?: any[] };
    for (const h of j.hits ?? []) out.push({ source: 'hn', title: String(h.title ?? ''), url: `https://news.ycombinator.com/item?id=${h.objectID}`, metric: Number(h.points) || 0, metricLabel: 'points', at: String(h.created_at ?? '').slice(0, 10), where: q });
  }
  return out;
}

/** Reddit's public Atom feed of a community's top posts this week (its JSON API needs OAuth now). Rank stands in for votes. */
export function parseRedditAtom(xml: string, sub: string): Signal[] {
  const out: Signal[] = [];
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? [];
  entries.forEach((e, i) => {
    const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    const url = e.match(/<link href="([^"]+)"/)?.[1] ?? '';
    if (!title || !/^https:\/\/www\.reddit\.com\/r\//.test(url)) return;
    out.push({ source: 'reddit', title, url, metric: entries.length - i, metricLabel: `#${i + 1} this week`, at: (e.match(/<(?:published|updated)>([^<]+)</)?.[1] ?? '').slice(0, 10), where: `r/${sub}` });
  });
  return out;
}

export async function fromReddit(f: Fetch = fetch, subs = REDDIT_SUBS, gapMs = 2000): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const [i, sub] of subs.entries()) {
    // Reddit rate-limits anonymous feeds hard: space requests out and stop at the first "slow down".
    if (i && gapMs) await new Promise((r) => setTimeout(r, gapMs));
    const r = await f(`https://www.reddit.com/r/${sub}/top/.rss?t=week&limit=15`, { headers: UA, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (r?.status === 429) break;
    if (r?.ok) out.push(...parseRedditAtom(await r.text(), sub));
  }
  return out;
}

/** Google Trends' public "trending now" RSS: what people search for today in one country. */
export function parseTrendsRss(xml: string, geo: string): Signal[] {
  const out: Signal[] = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const tag = (t: string) => item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() ?? '';
    const title = tag('title');
    if (!title) continue;
    const traffic = tag('ht:approx_traffic');
    const date = Date.parse(tag('pubDate'));
    out.push({ source: 'google-trends', title, url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}&geo=${geo}`, metric: Number(traffic.replace(/[^\d]/g, '')) || 0, metricLabel: 'searches', at: Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : '', where: geo });
  }
  return out;
}

export async function fromGoogleTrends(f: Fetch = fetch, geos = ['US', 'GB', 'IN']): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const geo of geos) {
    const r = await f(`https://trends.google.com/trending/rss?geo=${geo}`, { headers: UA, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (r?.ok) out.push(...parseTrendsRss(await r.text(), geo));
  }
  return out;
}

export async function fromYouTube(f: Fetch = fetch, now = new Date(), queries = ['marketing tips', 'linkedin carousel', 'tiktok marketing', 'product launch']): Promise<Signal[]> {
  const key = await getSecret('youtube');
  if (!key) return [];
  const after = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const out: Signal[] = [];
  for (const q of queries) {
    const s = await f(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=8&publishedAfter=${after}&q=${encodeURIComponent(q)}&key=${key}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!s?.ok) continue;
    const items = (((await s.json().catch(() => ({}))) as any).items ?? []) as any[];
    const ids = items.map((i) => i.id?.videoId).filter(Boolean).join(',');
    const v = ids ? ((await f(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${key}`).then((r) => r.json()).catch(() => ({ items: [] }))) as any) : { items: [] };
    const views = new Map<string, number>((v.items ?? []).map((x: any) => [x.id, Number(x.statistics?.viewCount) || 0]));
    for (const i of items) out.push({ source: 'youtube', title: String(i.snippet?.title ?? ''), url: `https://www.youtube.com/watch?v=${i.id.videoId}`, metric: views.get(i.id.videoId) ?? 0, metricLabel: 'views', at: String(i.snippet?.publishedAt ?? '').slice(0, 10), where: q });
  }
  return out;
}

/** Everything from every source, de-duplicated, strongest first per source. */
export async function collectSignals(f: Fetch = fetch, now = new Date()): Promise<{ signals: Signal[]; sources: Record<string, number> }> {
  const [hn, reddit, gt, yt] = await Promise.all([fromHN(f, now), fromReddit(f, REDDIT_SUBS, f === fetch ? 2000 : 0), fromGoogleTrends(f), fromYouTube(f, now)]);
  const seen = new Set<string>();
  const signals = [...hn, ...reddit, ...gt, ...yt].filter((s) => s.title && !seen.has(s.url) && (seen.add(s.url), true));
  signals.sort((a, b) => a.source.localeCompare(b.source) || b.metric - a.metric);
  return { signals, sources: { hn: hn.length, reddit: reddit.length, 'google-trends': gt.length, youtube: yt.length } };
}

// ── cards ──────────────────────────────────────────────────────────────

const dir = () => join(rootHome(), 'trends');
const cardsFile = () => join(dir(), 'cards.json');

export interface TrendFeed {
  refreshedAt?: string;
  sources?: Record<string, number>;
  cards: TrendCard[];
}

export async function readTrends(): Promise<TrendFeed> {
  try {
    return JSON.parse(await readFile(cardsFile(), 'utf8'));
  } catch {
    return { cards: [] };
  }
}
async function saveTrends(feed: TrendFeed) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${cardsFile()}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(feed, null, 2) + '\n');
  await rename(tmp, cardsFile());
}

export const slugKey = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const KINDS: TrendKind[] = ['format', 'hook', 'topic', 'tactic', 'platform-change'];

/** Clean a card the model wrote; null when it has no evidence or no usable recipe. */
export function cleanCard(raw: any, packs: Set<string>): Omit<TrendCard, 'firstSeen' | 'lastSeen' | 'seen' | 'missed'> | null {
  if (!raw || typeof raw.title !== 'string' || typeof raw.what !== 'string') return null;
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .filter((e: any) => e && typeof e.url === 'string' && /^https:\/\/[^\s]+$/.test(e.url))
    .slice(0, 6)
    .map((e: any) => ({ url: e.url, metric: e.metric ? String(e.metric).slice(0, 80) : undefined, date: e.date ? String(e.date).slice(0, 10) : undefined }));
  if (!evidence.length) return null;
  const r = raw.recipe ?? {};
  return {
    key: slugKey(raw.key || raw.title),
    kind: KINDS.includes(raw.kind) ? raw.kind : 'tactic',
    platform: String(raw.platform ?? 'any').toLowerCase().slice(0, 30),
    title: raw.title.trim().slice(0, 90),
    what: raw.what.trim().slice(0, 500),
    evidence,
    strength: raw.strength === 'rising' || raw.strength === 'fading' ? raw.strength : 'steady',
    recipe: {
      pack: packs.has(r.pack) ? r.pack : 'social-post',
      angle: String(r.angle ?? '').slice(0, 300),
      hookPattern: String(r.hookPattern ?? '').slice(0, 200),
      structure: (Array.isArray(r.structure) ? r.structure : []).map(String).slice(0, 10).map((x: string) => x.slice(0, 160)),
    },
  };
}

/** Fold a refresh into the history. */
export function mergeCards(prev: TrendCard[], fresh: ReturnType<typeof cleanCard>[], now: Date): TrendCard[] {
  const at = now.toISOString();
  const byKey = new Map(prev.map((c) => [c.key, { ...c }]));
  const hit = new Set<string>();
  for (const f of fresh) {
    if (!f || hit.has(f.key)) continue;
    hit.add(f.key);
    const old = byKey.get(f.key);
    if (old) {
      byKey.set(f.key, { ...old, ...f, evidence: [...f.evidence, ...old.evidence.filter((e) => !f.evidence.some((n) => n.url === e.url))].slice(0, 8), firstSeen: old.firstSeen, lastSeen: at, seen: old.seen + 1, missed: 0, archived: false });
    } else byKey.set(f.key, { ...f, firstSeen: at, lastSeen: at, seen: 1, missed: 0 });
  }
  for (const c of byKey.values())
    if (!hit.has(c.key) && !c.archived) {
      c.missed += 1;
      if (c.missed >= 2 && c.strength === 'rising') c.strength = 'steady';
      if (c.missed >= 3) c.archived = true;
    }
  return [...byKey.values()];
}

/** Order for the page: live first, rising first, then how often and how recently seen. */
export function rankCards(cards: TrendCard[]): TrendCard[] {
  const s = { rising: 0, steady: 1, fading: 2 };
  return [...cards].sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || s[a.strength] - s[b.strength] || b.seen - a.seen || b.lastSeen.localeCompare(a.lastSeen));
}

export function trendsPrompt(signals: Signal[], existing: TrendCard[], packs: { id: string; name: string }[], now: Date): string {
  const per: Record<string, number> = {};
  const list = signals
    .filter((s) => (per[s.source] = (per[s.source] ?? 0) + 1) <= 25)
    .map((s) => `- [${s.source}${s.where ? ` ${s.where}` : ''}] ${s.title} — ${s.metric} ${s.metricLabel}, ${s.at} — ${s.url}`)
    .join('\n');
  const live = existing.filter((c) => !c.archived).map((c) => `- ${c.key}: ${c.title} (${c.platform}, ${c.strength})`).join('\n') || '- none yet';
  return `Today is ${now.toISOString().slice(0, 10)}. You are the trend researcher inside Shipcast, a marketing studio for small teams. Find what is working in marketing content RIGHT NOW so the user can make something like it.

1. Read the signals below (fresh from Hacker News, Reddit marketing communities, Google Trends and YouTube).
2. Use web search (8–12 searches) for what marketers report is working this month: formats and hooks gaining reach on LinkedIn, Instagram, TikTok, YouTube Shorts, X and newsletters; platform feature or algorithm changes; benchmark reports published in the last 60 days. Prefer primary sources (platform announcements, benchmark studies with numbers).
3. Write 8–14 trend cards. Each must be actionable for a small team and backed by at least one https link you actually saw, with a number or date when there is one. Describe the pattern; never copy anyone's post.

Signals:
${list || '- (none collected — rely on web search)'}

Cards you already know (reuse the same key if a trend continues; you may leave them out if they no longer show up):
${live}

Shipcast formats a recipe may use (pack ids): ${packs.map((p) => `${p.id} (${p.name})`).join(', ')}

Reply with JSON only, no prose:
[{"key": "short-kebab-key", "kind": "format|hook|topic|tactic|platform-change", "platform": "linkedin|instagram|tiktok|youtube|x|newsletter|web|any", "title": "≤ 80 chars", "what": "2–3 sentences: what it is, why it works now, who it suits", "strength": "rising|steady|fading", "evidence": [{"url": "https://…", "metric": "e.g. 6.6% avg engagement", "date": "YYYY-MM-DD"}], "recipe": {"pack": "<pack id>", "angle": "how to use it for a product", "hookPattern": "a fill-in-the-blank hook", "structure": ["slide/scene/section 1", "…"]}}]`;
}

const ROLE = 'You are the trend researcher inside Shipcast, a local marketing studio the user runs on their own machine. Use web search to check facts. Reply with JSON only.';

async function ask(prompt: string, timeoutMs = 600_000): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-trends-'));
  try {
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: ['WebSearch'], model: 'sonnet', appendSystemPrompt: ROLE, extraArgs: ['--max-turns', '24', '--disallowedTools', 'Bash,Read,Write,Edit,Task,WebFetch', '--setting-sources', 'project', '--strict-mcp-config'], onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; else if (e.kind === 'text') text = e.text || text; } });
    const timer = setTimeout(run.kill, timeoutMs);
    const r = await run.done;
    clearTimeout(timer);
    return r.result?.text || text;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

export function parseCards(text: string): any[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export interface RefreshResult {
  signals: number;
  sources: Record<string, number>;
  fresh: number;
  live: number;
  claudeRuns: number;
}

/** One refresh: collect, synthesize (unless told to yield), merge, save. */
export async function refreshTrends(opts: { now?: Date; fetch?: Fetch; ask?: (p: string) => Promise<string>; shouldYield?: () => Promise<boolean> } = {}): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const { signals, sources } = await collectSignals(opts.fetch ?? fetch, now);
  const feed = await readTrends();
  if (await opts.shouldYield?.()) return { signals: signals.length, sources, fresh: 0, live: feed.cards.filter((c) => !c.archived).length, claudeRuns: 0 };
  const packs = (await loadPacks()).filter((p) => !(p as { hidden?: boolean }).hidden && !['campaign-hub', 'campaign-plan', 'app-run', 'app-capture', 'discovery-journey', 'hook-variants', 'platform-export'].includes(p.id));
  const ids = new Set(packs.map((p) => p.id));
  const raw = parseCards(await (opts.ask ?? ask)(trendsPrompt(signals, feed.cards, packs.map((p) => ({ id: p.id, name: p.name })), now)));
  const fresh = raw.map((r) => cleanCard(r, ids)).filter(Boolean);
  if (!fresh.length) throw new Error(`The trend refresh returned no usable cards (${signals.length} signals collected).`);
  const cards = mergeCards(feed.cards, fresh, now);
  await saveTrends({ refreshedAt: now.toISOString(), sources, cards });
  return { signals: signals.length, sources, fresh: fresh.length, live: cards.filter((c) => !c.archived).length, claudeRuns: 1 };
}
