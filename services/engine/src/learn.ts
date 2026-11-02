import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from './claude.ts';
import { campaignDir, home } from './paths.ts';
import { listCampaigns } from './store.ts';

/**
 * The learning loop. Every campaign already leaves a trail: quality checks that
 * failed, fix rounds, the director's revisions, brand-voice slips, the notes
 * people typed when they asked for a change, and eval scores. This file turns
 * that trail into incidents with a fixed set of categories, counts how often
 * each format hits each category, and keeps a short list of lessons per
 * format that go into its prompt. Lessons are trials: each one is measured on
 * the next runs and kept only if its category actually got rarer.
 */

export type IncidentSource = 'qa' | 'revision' | 'director' | 'brand' | 'eval';

export interface Incident {
  id: string;
  at: string;
  campaign: string;
  step: string;
  pack: string;
  source: IncidentSource;
  category: string;
  text: string;
}

/** Ordered: the first match wins. "infra" problems are counted but never become lessons. */
export const CATEGORIES: { id: string; label: string; test: RegExp }[] = [
  { id: 'infra', label: 'Tool or service failure', test: /DevTools|fetch failed|unknown kind|render failed|timed out|ECONN|isn't reachable|transcript/i },
  { id: 'tiny-screenshot', label: 'Screenshots too small to read', test: /screenshot|UI text lands|shrunk|unreadable|legib/i },
  { id: 'small-text', label: 'Text too small', test: /smallest text|too small|font size|tiny text/i },
  { id: 'caption-collision', label: 'Captions clash with on-screen text', test: /caption.*(overlap|duplicat|collid|cover)|(overlap|duplicat|collid).*caption/i },
  { id: 'hidden-text', label: 'Text hidden or overlapping', test: /hidden beneath|overlap|covers? the|collid/i },
  { id: 'overflow', label: 'Text overflows or runs long', test: /overflow|runs off|off the canvas|too long|shorten|exceeds|over \d+ characters/i },
  { id: 'safe-zone', label: 'Content in platform safe margins', test: /safe (margin|zone|area)|platform UI cover/i },
  { id: 'clipped-crop', label: 'Cropped or clipped visuals', test: /clipped|cropped at|cut off|edge of the|crop(ped)? .*edge/i },
  { id: 'broken-media', label: 'Missing or broken images', test: /didn't load|broken image|missing image|no such file/i },
  { id: 'blank-frame', label: 'Blank or half-built frames', test: /blank|empty frame|black frame|half-wiped|mid-transition|stray/i },
  { id: 'placeholder', label: 'Placeholder or unverified copy', test: /placeholder|\[[A-Z ]+\]|to confirm|lorem|postal address|footer\.address/i },
  { id: 'unsupported-claim', label: 'Unsupported or forbidden claims', test: /Forbidden claim|Check the source|unsourced|superlative|can't verify|invented/i },
  { id: 'voice-wording', label: 'Off-voice wording', test: /Say "[^"]+" instead of|banned word|jargon|exclamation|Shouting|capitals/i },
  { id: 'hashtags', label: 'Too many hashtags', test: /hashtag/i },
  { id: 'weak-hook', label: 'Weak or unclear hook', test: /hook|first (frame|line|slide)|opening/i },
  { id: 'off-brand', label: 'Off-brand look', test: /off-brand|palette|colou?r|font|logo/i },
  { id: 'pacing', label: 'Pacing and length', test: /pacing|drags|too fast|too slow|slow down|speed up|duration/i },
  { id: 'realism', label: 'Looks templated or unreal', test: /templat|generic|stock|realism|real footage|people/i },
];

/** Counted and shown, but never turned into format lessons. */
export const NOT_LESSONS = new Set(['infra', 'other', 'voice-wording', 'hashtags']);

export function classify(text: string): string {
  return CATEGORIES.find((c) => c.test.test(text))?.id ?? 'other';
}

const idOf = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

interface EventLine {
  t: string;
  step: string;
  type: string;
  status?: string;
  text?: string;
}

/** Every incident in campaigns since `since`, plus how many runs each format had. */
export async function collectIncidents(since = new Date(Date.now() - 30 * 86_400_000)): Promise<{ incidents: Incident[]; runs: Record<string, { at: string }[]> }> {
  const incidents: Incident[] = [];
  const runs: Record<string, { at: string }[]> = {};
  for (const c of await listCampaigns()) {
    const packOf = new Map(c.steps.map((s) => [s.id, s.pack ?? s.kind]));
    let lines: EventLine[] = [];
    try {
      lines = (await readFile(join(campaignDir(c.id), 'events.ndjson'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      continue;
    }
    // What Claude last said per step: the director's review explains its changes there.
    const lastText = new Map<string, string>();
    for (const e of lines) {
      if (e.type === 'text' && e.text) lastText.set(e.step, e.text);
      if (!e.t || e.t < since.toISOString()) continue;
      const pack = packOf.get(e.step);
      if (!pack || pack === 'brief') continue;
      const text = e.text ?? '';
      const add = (source: IncidentSource, t: string) => {
        const clean = t.trim().slice(0, 400);
        if (!clean) return;
        incidents.push({ id: idOf(c.id, e.step, e.t, clean), at: e.t, campaign: c.id, step: e.step, pack, source, category: classify(clean), text: clean });
      };
      if (e.type === 'status' && e.status === 'running') (runs[pack] ??= []).push({ at: e.t });
      if (e.type !== 'log') continue;
      let m: RegExpMatchArray | null;
      if ((m = text.match(/^Quality check found \d+ issue\(s\): (.*)$/s))) for (const part of m[1].split(' · ')) add('qa', part);
      else if ((m = text.match(/^Revision queued: (.*)$/s))) add('revision', m[1]);
      else if ((m = text.match(/^Critic review: (.*)$/s))) add('eval', m[1]);
      else if (/^Director's review: revising/.test(text)) add('director', (lastText.get(e.step) ?? '').replace(/\bCHANGED\b\.?/g, '').trim() || "Director's review sent the storyboard back for changes.");
      else if ((m = text.match(/^Brand score \d+% — (.*)$/s))) for (const part of m[1].split(' · ')) add('brand', part);
    }
  }
  // Eval reports saved by tools/eval.ts.
  for (const r of await readEvals(since)) for (const p of r.pieces) for (const [k, v] of Object.entries(p.scores ?? {})) if (Number(v) <= 2) incidents.push({ id: idOf(r.at, p.campaign, p.step, k), at: r.at, campaign: p.campaign, step: p.step, pack: p.pack, source: 'eval', category: classify(`${k} ${p.fix ?? ''}`), text: `${k} scored ${v}/5. ${p.fix ?? ''}`.slice(0, 400) });
  return { incidents, runs };
}

export interface EvalRecord {
  at: string;
  /** From the nightly quality check (same project, rotating formats) rather than a one-off eval. */
  golden?: boolean;
  pieces: { campaign: string; step: string; pack: string; scores: Record<string, number>; avg: number; fix?: string }[];
}
const evalsDir = () => join(home(), 'evals');
export async function saveEval(r: EvalRecord): Promise<void> {
  await mkdir(evalsDir(), { recursive: true });
  await writeFile(join(evalsDir(), `${r.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(r, null, 2));
}
export async function readEvals(since = new Date(0)): Promise<EvalRecord[]> {
  if (!existsSync(evalsDir())) return [];
  const out: EvalRecord[] = [];
  for (const f of (await readdir(evalsDir())).filter((x) => x.endsWith('.json'))) {
    try {
      const r = JSON.parse(await readFile(join(evalsDir(), f), 'utf8')) as EvalRecord;
      if (r.at >= since.toISOString()) out.push(r);
    } catch {}
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Share of a format's runs (in a window) that hit a category at least once. */
export function categoryRate(incidents: Incident[], runs: { at: string }[], pack: string, category: string, from = '', to = '9'): { rate: number; runs: number } {
  const inWin = (t: string) => t >= from && t < to;
  const n = runs.filter((r) => inWin(r.at)).length;
  if (!n) return { rate: 0, runs: 0 };
  // Incidents are tied to runs by step; count distinct (step, run-ish day) hits, capped at runs.
  const hits = new Set(incidents.filter((i) => i.pack === pack && i.category === category && inWin(i.at)).map((i) => `${i.step}@${i.at.slice(0, 13)}`)).size;
  return { rate: Math.min(1, hits / n), runs: n };
}

// ── lessons ────────────────────────────────────────────────────────────

export type LessonStatus = 'trial' | 'kept' | 'retired' | 'off';
export interface Lesson {
  id: string;
  pack: string;
  category: string;
  rule: string;
  evidence: string[];
  createdAt: string;
  status: LessonStatus;
  baseline: { rate: number; runs: number };
  after?: { rate: number; runs: number };
  decidedAt?: string;
}

const lessonsDir = () => join(home(), 'lessons');
const lessonsFile = () => join(lessonsDir(), 'lessons.json');

export async function readLessons(): Promise<Lesson[]> {
  try {
    return JSON.parse(await readFile(lessonsFile(), 'utf8'));
  } catch {
    return [];
  }
}
export async function saveLessons(ls: Lesson[]): Promise<void> {
  await mkdir(lessonsDir(), { recursive: true });
  const tmp = `${lessonsFile()}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(ls, null, 2) + '\n');
  await rename(tmp, lessonsFile());
}
export async function setLessonStatus(id: string, status: 'off' | 'trial'): Promise<Lesson[]> {
  const ls = await readLessons();
  const l = ls.find((x) => x.id === id);
  if (!l) throw new Error('no such lesson');
  l.status = status;
  await saveLessons(ls);
  return ls;
}

export const MAX_LESSONS_PER_PACK = 8;
const active = (l: Lesson) => l.status === 'trial' || l.status === 'kept';

/** The lessons block appended to a format's prompt ('' when there are none). */
export async function lessonsBrief(pack: string): Promise<string> {
  const ls = (await readLessons()).filter((l) => l.pack === pack && active(l)).slice(0, MAX_LESSONS_PER_PACK);
  if (!ls.length) return '';
  return `## Lessons from earlier runs of this format\nThese come from problems Shipcast's checks and its users kept finding. Follow them unless the brief says otherwise.\n${ls.map((l) => `- ${l.rule}`).join('\n')}`;
}

/** Runs before a trial lesson is judged, and how much rarer its category must get to be kept. */
export const TRIAL_RUNS = 10;
export const KEEP_IF_BELOW = 0.7;

/** Keep or retire trial lessons that have enough runs behind them. Returns what changed. */
export function judgeLessons(ls: Lesson[], incidents: Incident[], runs: Record<string, { at: string }[]>, now = new Date()): { kept: Lesson[]; retired: Lesson[] } {
  const kept: Lesson[] = [];
  const retired: Lesson[] = [];
  for (const l of ls) {
    if (l.status !== 'trial') continue;
    const after = categoryRate(incidents, runs[l.pack] ?? [], l.pack, l.category, l.createdAt);
    l.after = after;
    if (after.runs < TRIAL_RUNS) continue;
    const better = after.rate <= l.baseline.rate * KEEP_IF_BELOW || (l.baseline.rate === 0 && after.rate === 0);
    l.status = better ? 'kept' : 'retired';
    l.decidedAt = now.toISOString();
    (better ? kept : retired).push(l);
  }
  return { kept, retired };
}

/** Formats and categories worth a new lesson: repeat, non-infra, and not already covered. */
export function lessonCandidates(ls: Lesson[], incidents: Incident[], min = 3): { pack: string; category: string; incidents: Incident[] }[] {
  const groups = new Map<string, Incident[]>();
  for (const i of incidents) {
    // "other" is too vague to turn into a rule; infra is a tool problem, not the writer's; wording and
    // hashtags belong to each brand's voice profile, so a format-wide lesson would leak one brand into the next.
    if (NOT_LESSONS.has(i.category) || i.pack === 'hook-variants' || i.pack === 'platform-export') continue;
    const k = `${i.pack}\t${i.category}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const covered = new Set(ls.filter((l) => active(l) || l.status === 'off').map((l) => `${l.pack}\t${l.category}`));
  const perPack = (p: string) => ls.filter((l) => l.pack === p && active(l)).length;
  return [...groups.entries()]
    .filter(([k, v]) => !covered.has(k) && (v.length >= min || v.some((i) => i.source === 'revision')))
    .map(([k, v]) => ({ pack: k.split('\t')[0], category: k.split('\t')[1], incidents: v }))
    .filter((g) => perPack(g.pack) < MAX_LESSONS_PER_PACK)
    .sort((a, b) => b.incidents.length - a.incidents.length);
}

const ROLE = "You are the quality editor inside Shipcast, a local marketing studio. You turn recurring problems from its own logs into short rules for the writer of each format. Do not use tools. Reply with JSON only.";
const ARGS = ['--max-turns', '2', '--disallowedTools', 'WebFetch,WebSearch,Bash,Read,Write,Edit,Task', '--setting-sources', 'project', '--strict-mcp-config'];

async function ask(prompt: string, timeoutMs = 180_000): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-learn-'));
  try {
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: [], model: 'sonnet', appendSystemPrompt: ROLE, extraArgs: ARGS, env: { MAX_THINKING_TOKENS: '0' }, onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; else if (e.kind === 'text') text = text || e.text; } });
    const timer = setTimeout(run.kill, timeoutMs);
    const r = await run.done;
    clearTimeout(timer);
    return r.result?.text || text;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

export function synthesisPrompt(groups: { pack: string; category: string; incidents: Incident[] }[], existing: Lesson[]): string {
  const label = (c: string) => CATEGORIES.find((x) => x.id === c)?.label ?? c;
  const body = groups
    .map((g) => {
      const seen = new Set<string>();
      const lines = g.incidents
        .filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)))
        .slice(0, 12)
        .map((i) => `  - [${i.source}] ${i.text}`);
      const have = existing.filter((l) => l.pack === g.pack && active(l)).map((l) => `  - (already) ${l.rule}`);
      return `### ${g.pack} — ${label(g.category)} (${g.incidents.length} times)\n${[...lines, ...have].join('\n')}`;
    })
    .join('\n\n');
  return `Below are recurring problems from Shipcast's quality checks, its creative-director review, brand-voice scoring, eval scores and the notes people typed when they asked for a revision ([revision] lines are the most important: a person cared enough to ask).

For each group, write ONE rule the writer of that format should follow so the problem stops happening. Rules must be:
- concrete and checkable (numbers, sizes, counts, where things go) — never "make it better";
- about the spec the writer controls (copy length, layout choice, crops, scene order, captions), not about tools or bugs;
- under 30 words, imperative, no brand names unless the problem is specific to one;
- different from rules marked (already).

Skip a group if no useful rule follows from it.

${body}

Reply with JSON only: [{"pack": "<pack id>", "category": "<category id as given>", "rule": "<rule>"}]
Category ids: ${groups.map((g) => g.category).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`;
}

export function parseRules(text: string): { pack: string; category: string; rule: string }[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return (JSON.parse(m[0]) as any[])
      .filter((r) => r && typeof r.pack === 'string' && typeof r.category === 'string' && typeof r.rule === 'string')
      .map((r) => ({ pack: r.pack.trim(), category: r.category.trim(), rule: r.rule.trim().replace(/\s+/g, ' ').slice(0, 240) }))
      .filter((r) => r.rule.length >= 12);
  } catch {
    return [];
  }
}

export interface LearnResult {
  incidents: number;
  added: Lesson[];
  kept: Lesson[];
  retired: Lesson[];
  claudeRuns: number;
}

/** One learning pass: judge trials, then (if allowed) write lessons for the worst uncovered patterns. */
export async function learnOnce(opts: { now?: Date; shouldYield?: () => Promise<boolean>; ask?: (p: string) => Promise<string>; maxGroups?: number } = {}): Promise<LearnResult> {
  const now = opts.now ?? new Date();
  const { incidents, runs } = await collectIncidents(new Date(now.getTime() - 30 * 86_400_000));
  const ls = await readLessons();
  const { kept, retired } = judgeLessons(ls, incidents, runs, now);
  const groups = lessonCandidates(ls, incidents).slice(0, opts.maxGroups ?? 6);
  const added: Lesson[] = [];
  let claudeRuns = 0;
  if (groups.length && !(await opts.shouldYield?.())) {
    const known = new Set(groups.map((g) => `${g.pack}\t${g.category}`));
    claudeRuns = 1;
    for (const r of parseRules(await (opts.ask ?? ask)(synthesisPrompt(groups, ls)))) {
      const g = groups.find((x) => x.pack === r.pack && x.category === r.category);
      if (!g || !known.has(`${r.pack}\t${r.category}`)) continue;
      known.delete(`${r.pack}\t${r.category}`);
      const l: Lesson = { id: idOf(r.pack, r.category, r.rule), pack: r.pack, category: r.category, rule: r.rule, evidence: g.incidents.slice(0, 12).map((i) => i.id), createdAt: now.toISOString(), status: 'trial', baseline: categoryRate(incidents, runs[r.pack] ?? [], r.pack, r.category, new Date(now.getTime() - 30 * 86_400_000).toISOString(), now.toISOString()) };
      ls.push(l);
      added.push(l);
    }
  }
  await saveLessons(ls);
  return { incidents: incidents.length, added, kept, retired, claudeRuns };
}
