import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { home } from './paths.ts';

/**
 * Tone & Voice: how a brand sounds, set by the marketer once and applied to
 * every material (posts, decks, PDFs, ads, emails, scripts). A profile turns
 * into prompt rules for Claude and into a brand score for what comes back.
 */

export type Channel = 'linkedin' | 'x' | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'email' | 'web' | 'ads' | 'print' | 'deck';
export const CHANNELS: Channel[] = ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook', 'email', 'web', 'ads', 'print', 'deck'];

export interface ToneSliders {
  /** 0 formal … 100 casual */
  formalCasual: number;
  /** 0 serious … 100 playful */
  seriousPlayful: number;
  /** 0 reserved … 100 bold */
  reservedBold: number;
  /** 0 technical … 100 simple */
  technicalSimple: number;
  /** 0 none … 100 lots */
  humor: number;
}

export interface ToneProfile {
  id: string;
  name: string;
  description: string;
  personality: string[];
  sliders: ToneSliders;
  readingLevel: 'grade6' | 'grade8' | 'grade10' | 'expert';
  person: 'we' | 'I' | 'you';
  audience: { role: string; pains: string[]; desires: string[]; objections: string[] };
  do: string[];
  dont: string[];
  lexicon: { preferred: Record<string, string>; banned: string[] };
  emoji: 'none' | 'sparing' | 'native';
  hashtags: { max: number; style: 'none' | 'niche' | 'broad' | 'branded' };
  cta: 'soft' | 'direct' | 'urgent';
  claims: { allowedStats: string[]; forbidden: string[]; requireSource: boolean };
  locale: string;
  channels: Partial<Record<Channel, Partial<Pick<ToneProfile, 'sliders' | 'emoji' | 'hashtags' | 'cta' | 'readingLevel'>> & { notes?: string }>>;
  aiDisclosure: boolean;
  samples: string[];
  updatedAt?: string;
}

/** Words that make copy read as generic AI marketing. Hard-banned unless a profile removes them. */
export const STOCK_BANNED = ['synergy', 'leverage', 'unlock', 'revolutionize', 'revolutionise', 'game-changer', 'game changer', 'delve', 'elevate', 'seamless', 'cutting-edge', 'next-level', 'in today’s fast-paced world', "in today's fast-paced world", 'supercharge', 'harness the power'];

export const DEFAULT_TONE: ToneProfile = {
  id: 'default',
  name: 'Clear and confident',
  description: 'Plain, specific and confident. Lead with the outcome, show the product, no hype.',
  personality: ['clear', 'confident', 'helpful'],
  sliders: { formalCasual: 60, seriousPlayful: 40, reservedBold: 55, technicalSimple: 65, humor: 20 },
  readingLevel: 'grade8',
  person: 'we',
  audience: { role: '', pains: [], desires: [], objections: [] },
  do: ['Lead with the outcome', 'Use concrete numbers only when they are verified', 'Show the product doing the thing'],
  dont: ['No clickbait', 'No fake urgency', 'No invented customers, ratings or testimonials'],
  lexicon: { preferred: {}, banned: [...STOCK_BANNED] },
  emoji: 'sparing',
  hashtags: { max: 3, style: 'niche' },
  cta: 'direct',
  claims: { allowedStats: [], forbidden: ['#1', 'guaranteed', 'best in the world', 'world-class', 'number one'], requireSource: true },
  locale: 'en-US',
  channels: {
    linkedin: { sliders: { formalCasual: 45 } as ToneSliders, emoji: 'sparing', hashtags: { max: 3, style: 'niche' }, notes: 'Professional, insight first; question or soft CTA; no link in the first line.' },
    tiktok: { sliders: { formalCasual: 85, seriousPlayful: 65 } as ToneSliders, emoji: 'native', notes: 'Spoken, native, hook in the first 1.5 s; creator-style soft CTA.' },
    instagram: { sliders: { formalCasual: 75 } as ToneSliders, emoji: 'native' },
    x: { hashtags: { max: 1, style: 'niche' }, notes: 'Punchy first line; links go in a reply.' },
    email: { emoji: 'none', notes: 'One idea per email, one CTA, subject under 45 characters.' },
    deck: { emoji: 'none', hashtags: { max: 0, style: 'none' }, notes: 'One message per slide; headline states the takeaway.' },
    print: { emoji: 'none', hashtags: { max: 0, style: 'none' } },
  },
  aiDisclosure: true,
  samples: [],
};

const clamp = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d);
const strs = (v: unknown, max = 40, len = 200): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim().slice(0, len)).slice(0, max) : []);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/** Accept anything (user input, a model's JSON) and return a complete, safe profile. */
export function normalizeTone(raw: unknown, base: ToneProfile = DEFAULT_TONE): ToneProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const s = (r.sliders ?? {}) as Record<string, unknown>;
  const lex = (r.lexicon ?? {}) as Record<string, any>;
  const preferred: Record<string, string> = {};
  for (const [k, v] of Object.entries(lex.preferred ?? base.lexicon.preferred)) if (typeof v === 'string' && k.trim()) preferred[k.trim().slice(0, 60)] = v.slice(0, 60);
  const channels: ToneProfile['channels'] = {};
  for (const ch of CHANNELS) {
    const c = (r.channels ?? base.channels)?.[ch];
    if (!c || typeof c !== 'object') continue;
    const o: NonNullable<ToneProfile['channels'][Channel]> = {};
    if (c.sliders && typeof c.sliders === 'object') {
      const cs: Record<string, number> = {};
      for (const k of Object.keys(DEFAULT_TONE.sliders)) if (typeof c.sliders[k] === 'number') cs[k] = clamp(c.sliders[k], 50);
      o.sliders = cs as unknown as ToneSliders;
    }
    if (c.emoji) o.emoji = pick(c.emoji, ['none', 'sparing', 'native'] as const, 'sparing');
    if (c.cta) o.cta = pick(c.cta, ['soft', 'direct', 'urgent'] as const, 'direct');
    if (c.readingLevel) o.readingLevel = pick(c.readingLevel, ['grade6', 'grade8', 'grade10', 'expert'] as const, 'grade8');
    if (c.hashtags && typeof c.hashtags === 'object') o.hashtags = { max: Math.max(0, Math.min(30, Number(c.hashtags.max) || 0)), style: pick(c.hashtags.style, ['none', 'niche', 'broad', 'branded'] as const, 'niche') };
    if (typeof c.notes === 'string') o.notes = c.notes.slice(0, 400);
    channels[ch] = o;
  }
  const aud = (r.audience ?? {}) as Record<string, unknown>;
  const claims = (r.claims ?? {}) as Record<string, unknown>;
  const hashtags = (r.hashtags ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' && /^[a-z0-9-]{1,48}$/.test(r.id) ? r.id : base.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : base.name,
    description: typeof r.description === 'string' ? r.description.slice(0, 600) : base.description,
    personality: r.personality ? strs(r.personality, 6, 30) : base.personality,
    sliders: {
      formalCasual: clamp(s.formalCasual, base.sliders.formalCasual),
      seriousPlayful: clamp(s.seriousPlayful, base.sliders.seriousPlayful),
      reservedBold: clamp(s.reservedBold, base.sliders.reservedBold),
      technicalSimple: clamp(s.technicalSimple, base.sliders.technicalSimple),
      humor: clamp(s.humor, base.sliders.humor),
    },
    readingLevel: pick(r.readingLevel, ['grade6', 'grade8', 'grade10', 'expert'] as const, base.readingLevel),
    person: pick(r.person, ['we', 'I', 'you'] as const, base.person),
    audience: {
      role: typeof aud.role === 'string' ? aud.role.slice(0, 120) : base.audience.role,
      pains: aud.pains ? strs(aud.pains, 8) : base.audience.pains,
      desires: aud.desires ? strs(aud.desires, 8) : base.audience.desires,
      objections: aud.objections ? strs(aud.objections, 8) : base.audience.objections,
    },
    do: r.do ? strs(r.do, 12) : base.do,
    dont: r.dont ? strs(r.dont, 12) : base.dont,
    lexicon: { preferred, banned: lex.banned ? strs(lex.banned, 80, 60) : base.lexicon.banned },
    emoji: pick(r.emoji, ['none', 'sparing', 'native'] as const, base.emoji),
    hashtags: { max: hashtags.max !== undefined ? Math.max(0, Math.min(30, Number(hashtags.max) || 0)) : base.hashtags.max, style: pick(hashtags.style, ['none', 'niche', 'broad', 'branded'] as const, base.hashtags.style) },
    cta: pick(r.cta, ['soft', 'direct', 'urgent'] as const, base.cta),
    claims: {
      allowedStats: claims.allowedStats ? strs(claims.allowedStats, 30) : base.claims.allowedStats,
      forbidden: claims.forbidden ? strs(claims.forbidden, 30, 80) : base.claims.forbidden,
      requireSource: typeof claims.requireSource === 'boolean' ? claims.requireSource : base.claims.requireSource,
    },
    locale: typeof r.locale === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(r.locale) ? r.locale : base.locale,
    channels: r.channels ? channels : base.channels,
    aiDisclosure: typeof r.aiDisclosure === 'boolean' ? r.aiDisclosure : base.aiDisclosure,
    samples: r.samples ? strs(r.samples, 10, 4000) : base.samples,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : base.updatedAt,
  };
}

/** The profile as it applies to one channel (channel overrides merged in). */
export function forChannel(p: ToneProfile, ch?: Channel) {
  const o = ch ? p.channels[ch] : undefined;
  return {
    sliders: { ...p.sliders, ...(o?.sliders ?? {}) },
    emoji: o?.emoji ?? p.emoji,
    hashtags: o?.hashtags ?? p.hashtags,
    cta: o?.cta ?? p.cta,
    readingLevel: o?.readingLevel ?? p.readingLevel,
    notes: o?.notes,
  };
}

const scale = (v: number, lo: string, hi: string) => (v <= 20 ? `very ${lo}` : v <= 40 ? lo : v < 60 ? `balanced between ${lo} and ${hi}` : v < 80 ? hi : `very ${hi}`);
const GRADE: Record<ToneProfile['readingLevel'], [string, number]> = { grade6: ['easy (US grade 6)', 6], grade8: ['plain (US grade 8)', 8], grade10: ['considered (US grade 10)', 10], expert: ['expert — technical terms are fine', 14] };

/** Prompt rules for Claude: how to write for this brand (optionally for one channel). */
export function toneBrief(p: ToneProfile, ch?: Channel): string {
  const c = forChannel(p, ch);
  const s = c.sliders;
  const lines = [
    `## Brand voice: ${p.name}${ch ? ` (for ${ch})` : ''}`,
    p.description ? p.description : '',
    `- Sound: ${p.personality.join(', ') || 'clear'}. ${scale(s.formalCasual, 'formal', 'casual')}, ${scale(s.seriousPlayful, 'serious', 'playful')}, ${scale(s.reservedBold, 'reserved', 'bold')}, ${scale(s.technicalSimple, 'technical', 'simple')}; humour ${s.humor <= 15 ? 'none' : s.humor < 50 ? 'light' : 'welcome'}.`,
    `- Reading level: ${GRADE[c.readingLevel][0]}. Write as "${p.person}"${p.person === 'you' ? ' (speak to the reader)' : ''}. Locale ${p.locale}${p.locale.startsWith('en-GB') ? ' (British spelling)' : ''}.`,
    `- Emoji: ${c.emoji === 'none' ? 'none' : c.emoji === 'sparing' ? 'at most one, only where it adds meaning' : 'native to the platform, still purposeful'}. Hashtags: ${c.hashtags.max === 0 || c.hashtags.style === 'none' ? 'none' : `up to ${c.hashtags.max}, ${c.hashtags.style}`}. CTA: ${c.cta === 'soft' ? 'soft (invite, ask a question)' : c.cta === 'urgent' ? 'urgent but honest (a real deadline only)' : 'direct and specific'}.`,
    p.audience.role ? `- Audience: ${p.audience.role}${p.audience.pains.length ? `; pains: ${p.audience.pains.join('; ')}` : ''}${p.audience.desires.length ? `; wants: ${p.audience.desires.join('; ')}` : ''}${p.audience.objections.length ? `; objections to answer: ${p.audience.objections.join('; ')}` : ''}.` : '',
    p.do.length ? `- Do: ${p.do.join('; ')}.` : '',
    p.dont.length ? `- Don't: ${p.dont.join('; ')}.` : '',
    p.lexicon.banned.length ? `- Never use these words or phrases: ${p.lexicon.banned.map((w) => `"${w}"`).join(', ')}.` : '',
    Object.keys(p.lexicon.preferred).length ? `- Always say: ${Object.entries(p.lexicon.preferred).map(([a, b]) => `"${b}" not "${a}"`).join(', ')}.` : '',
    `- Claims: ${p.claims.requireSource ? 'every number or comparison must come from the brief or a cited source' : 'keep numbers honest'}${p.claims.allowedStats.length ? `; approved stats: ${p.claims.allowedStats.join('; ')}` : ''}${p.claims.forbidden.length ? `; never claim: ${p.claims.forbidden.join(', ')}` : ''}.`,
    c.notes ? `- ${ch} note: ${c.notes}` : '',
    p.samples.length ? `- Match the rhythm of these samples (don't copy them):\n${p.samples.slice(0, 3).map((x) => `  > ${x.replace(/\s+/g, ' ').slice(0, 280)}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

// ── brand score ──────────────────────────────────────────────────────────

export interface ScoreIssue {
  rule: 'banned' | 'preferred' | 'claim' | 'unsourced' | 'reading' | 'emoji' | 'hashtags' | 'exclaim' | 'caps' | 'person';
  severity: 'error' | 'warn';
  detail: string;
  /** Text to find, when the issue points at a span. */
  match?: string;
  /** Suggested replacement, when there is an obvious one. */
  fix?: string;
}

export interface BrandScore {
  score: number;
  issues: ScoreIssue[];
  stats: { words: number; sentences: number; grade: number; emojis: number; hashtags: number; exclamations: number };
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(w)})(?=$|[^\\p{L}\\p{N}])`, 'giu');

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m?.length ?? 1);
}

/** Flesch–Kincaid grade level. */
export function readingGrade(text: string): { grade: number; words: number; sentences: number } {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)|\n{2,}/g) ?? []).length);
  if (!words.length) return { grade: 0, words: 0, sentences };
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
  return { grade: Math.round(Math.max(0, grade) * 10) / 10, words: words.length, sentences };
}

/** Score copy against a profile: 100 is fully on-brand. Deterministic; no model call. */
export function scoreText(text: string, p: ToneProfile, ch?: Channel): BrandScore {
  const c = forChannel(p, ch);
  const issues: ScoreIssue[] = [];
  for (const w of p.lexicon.banned) {
    const m = text.match(wordRe(w));
    if (m) issues.push({ rule: 'banned', severity: 'error', detail: `Banned: "${w}" (${m.length}×)`, match: w });
  }
  for (const [from, to] of Object.entries(p.lexicon.preferred)) {
    if (wordRe(from).test(text)) issues.push({ rule: 'preferred', severity: 'warn', detail: `Say "${to}" instead of "${from}"`, match: from, fix: to });
  }
  for (const f of p.claims.forbidden) {
    if (wordRe(f).test(text) || (f.startsWith('#') && text.includes(f))) issues.push({ rule: 'claim', severity: 'error', detail: `Forbidden claim: "${f}"`, match: f });
  }
  if (p.claims.requireSource) {
    const allowed = p.claims.allowedStats.join(' ').toLowerCase();
    for (const m of text.matchAll(/(\d+(?:[.,]\d+)?\s?(?:%|x\b|×|percent|times (?:faster|more|less)))/gi)) {
      if (!allowed.includes(m[1].toLowerCase().replace(/\s/g, ''))) issues.push({ rule: 'unsourced', severity: 'warn', detail: `Check the source for "${m[1].trim()}"`, match: m[1].trim() });
    }
    for (const m of text.matchAll(/\b(the (?:best|fastest|only|leading|first) \w+|best-in-class|industry-leading|unmatched|unbeatable)\b/gi)) issues.push({ rule: 'claim', severity: 'warn', detail: `Superlative needs proof: "${m[1]}"`, match: m[1] });
  }
  const rg = readingGrade(text);
  const target = GRADE[c.readingLevel][1];
  if (rg.words >= 40 && rg.grade > target + 3) issues.push({ rule: 'reading', severity: 'warn', detail: `Reads at grade ${rg.grade}; target ${target}. Shorter sentences, plainer words.` });
  const emojis = (text.match(EMOJI) ?? []).length;
  const paras = Math.max(1, text.split(/\n{2,}/).length);
  if (c.emoji === 'none' && emojis > 0) issues.push({ rule: 'emoji', severity: 'warn', detail: `${emojis} emoji; this voice uses none here` });
  const emojiMax = Math.max(1, Math.ceil(paras / 3));
  if (c.emoji === 'sparing' && emojis > emojiMax) issues.push({ rule: 'emoji', severity: 'warn', detail: `${emojis} emoji; keep it to ${emojiMax === 1 ? 'one' : emojiMax}` });
  // "#1" is a claim, not a hashtag.
  const tags = (text.match(/(^|\s)#[\p{L}_][\p{L}\p{N}_]*/gu) ?? []).length;
  const maxTags = c.hashtags.style === 'none' ? 0 : c.hashtags.max;
  if (tags > maxTags) issues.push({ rule: 'hashtags', severity: 'warn', detail: `${tags} hashtags; max ${maxTags}` });
  const ex = (text.match(/!/g) ?? []).length;
  if (ex > Math.max(2, Math.ceil(rg.sentences / 5)) && c.sliders.reservedBold < 80) issues.push({ rule: 'exclaim', severity: 'warn', detail: `${ex} exclamation marks — calmer copy reads more confident` });
  const shouty = (text.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !/^(HTTP|HTML|JSON|SaaS|API|PDF|CRM|ROI|KPI|B2B|B2C|USA|NASA|AI)$/.test(w));
  if (shouty.length > 2) issues.push({ rule: 'caps', severity: 'warn', detail: `ALL-CAPS words: ${[...new Set(shouty)].slice(0, 5).join(', ')}` });
  if (p.person === 'we' && /\bI\b/.test(text) && !/\bwe\b/i.test(text) && rg.words > 30) issues.push({ rule: 'person', severity: 'warn', detail: 'Written as "I"; this brand speaks as "we"' });
  const penalty = issues.reduce((a, i) => a + (i.severity === 'error' ? 12 : 4), 0);
  return { score: Math.max(0, 100 - penalty), issues, stats: { words: rg.words, sentences: rg.sentences, grade: rg.grade, emojis, hashtags: tags, exclamations: ex } };
}

/** Mechanical fixes that need no model: preferred terms swapped in. */
export function applyLexicon(text: string, p: ToneProfile): string {
  let out = text;
  for (const [from, to] of Object.entries(p.lexicon.preferred)) out = out.replace(wordRe(from), (_m, pre) => `${pre}${to}`);
  return out;
}

// ── storage: ~/.shipcast/tone/<id>.json ─────────────────────────────────

const toneDir = () => join(home(), 'tone');
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'voice';

export async function listTones(): Promise<ToneProfile[]> {
  const out: ToneProfile[] = [];
  for (const f of await readdir(toneDir()).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(normalizeTone(JSON.parse(await readFile(join(toneDir(), f), 'utf8'))));
    } catch {}
  }
  if (!out.some((t) => t.id === 'default')) out.unshift(DEFAULT_TONE);
  return out.sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.name.localeCompare(b.name)));
}

export async function getTone(id: string | undefined): Promise<ToneProfile | null> {
  if (!id) return null;
  if (!/^[a-z0-9-]{1,48}$/.test(id)) return null;
  const f = join(toneDir(), `${id}.json`);
  if (!existsSync(f)) return id === 'default' ? DEFAULT_TONE : null;
  try {
    return normalizeTone(JSON.parse(await readFile(f, 'utf8')));
  } catch {
    return null;
  }
}

export async function saveTone(raw: unknown): Promise<ToneProfile> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const existing = typeof r.id === 'string' ? await getTone(r.id) : null;
  const p = normalizeTone(r, existing ?? DEFAULT_TONE);
  if (!existing && (!r.id || r.id === 'default') && p.name !== DEFAULT_TONE.name) p.id = slugify(p.name);
  p.updatedAt = new Date().toISOString();
  await mkdir(toneDir(), { recursive: true });
  await writeFile(join(toneDir(), `${p.id}.json`), JSON.stringify(p, null, 2));
  return p;
}

export async function deleteTone(id: string): Promise<void> {
  if (!/^[a-z0-9-]{1,48}$/.test(id) || id === 'default') return;
  await rm(join(toneDir(), `${id}.json`), { force: true });
}

// ── campaign wiring ─────────────────────────────────────────────────────

/** Which channel a format mostly speaks on (for channel overrides). */
export const PACK_CHANNEL: Record<string, Channel> = {
  carousel: 'linkedin',
  'social-post': 'linkedin',
  reel: 'tiktok',
  'social-short': 'tiktok',
  shorts: 'tiktok',
  'youtube-video': 'youtube',
  'product-tour': 'youtube',
  'launch-film': 'youtube',
  email: 'email',
  presentation: 'deck',
  document: 'print',
  print: 'print',
  landing: 'web',
  'ad-set': 'ads',
  infographic: 'linkedin',
  thumbnails: 'youtube',
};

const SKIP_KEYS = /^(image|images|file|files|src|url|href|path|layout|theme|scene|transition|preset|font|fonts|color|colours?|icon|icons|id|kind|type|look|style|aspect|size|focus|logo|music|voice|mood|engine|model|query|seed|duration|fps|width|height|at|start|end|captions|crop|motion|shape|layoutId|cue)$/i;

function strings(v: unknown, key = '', out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (!SKIP_KEYS.test(key) && /\s/.test(v.trim()) && !/^(https?:|\.?\/|assets\/|data:)/.test(v)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) strings(x, key, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.test(k)) strings(x, k, out);
  return out;
}

/** The words a step produced (copy, captions, slide and scene text) — what the audience will read or hear. */
export async function outputText(outDir: string): Promise<string> {
  const parts: string[] = [];
  for (const f of await readdir(outDir).catch(() => [] as string[])) {
    if (/^(NOTES\.md|credits\.txt|qa\.json|brand-score\.json|app\.json|setup\.md|screens\.json)$/i.test(f)) continue;
    const p = join(outDir, f);
    try {
      if (/\.(md|txt)$/i.test(f)) parts.push(await readFile(p, 'utf8'));
      else if (/\.json$/i.test(f)) parts.push(strings(JSON.parse(await readFile(p, 'utf8'))).join('\n\n'));
    } catch {}
  }
  return parts.join('\n\n').slice(0, 200_000);
}
