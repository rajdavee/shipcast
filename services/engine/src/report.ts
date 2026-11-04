import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { channel, readPlan, savePlan, savePost, type ChannelId, type Post } from './calendar.ts';
import { runClaude } from './claude.ts';
import { withDirLock } from './filelock.ts';
import { readPlaybook } from './playbook.ts';
import { googleSiteConnected } from './publish.ts';
import { moreLikeThis, remix, suggestedSlots } from './pulse.ts';
import { gatherFacts, KPI_KEYS, periodFor, shiftPeriod, readGoals, readNotes, reportsDir, type Facts, type Goal, type Kpi, type Note, type PeriodKind, type PostFact } from './report-facts.ts';

/**
 * A report: a frozen fact sheet, the words written from it, and three
 * next steps that each do something. Words come from Claude when it's
 * available — checked so that every number in them is one of the facts —
 * and from a template otherwise, so a report is never blocked on a model.
 */

export type Audience = 'boss' | 'client' | 'team';
export const AUDIENCES: Record<Audience, { label: string; style: string; sections: SectionId[] }> = {
  boss: { label: 'Boss', style: 'A busy executive. Lead with outcomes and the decision needed. Short, direct, no jargon, no hedging. Two sentences per section at most.', sections: ['summary', 'results', 'why', 'website', 'goals', 'next'] },
  client: { label: 'Client', style: 'A client paying for the work. Open with the wins, be warm and clear, explain dips honestly with what is being done about them. No internal jargon (no "lift", say "compared with your usual").', sections: ['summary', 'work', 'results', 'why', 'website', 'goals', 'next'] },
  team: { label: 'Team', style: 'The marketing team. Tactical and specific: which posts, which formats, which slots, what to change. Plain and practical.', sections: ['summary', 'work', 'results', 'why', 'website', 'goals', 'notable', 'next', 'coverage'] },
};

export const SECTION_IDS = ['summary', 'work', 'results', 'why', 'website', 'goals', 'notable', 'next', 'coverage'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_TITLES: Record<SectionId, string> = {
  summary: 'In short',
  work: 'What we shipped',
  results: 'How it did',
  why: 'Why',
  website: 'Website and search',
  goals: 'Goals',
  notable: 'Worth knowing',
  next: 'Next week',
  coverage: 'What this report can’t see',
};

export interface Section {
  id: SectionId;
  title: string;
  lines: string[];
  hidden?: boolean;
  /** Changed by a person since it was written. */
  edited?: boolean;
}

export type RecKind = 'more-like-this' | 'remix' | 'slots' | 'double-down' | 'numbers' | 'pace' | 'plan';
export interface Recommendation {
  id: string;
  kind: RecKind;
  text: string;
  why: string;
  /** What the button does. */
  action: { label: string; post?: string; channel?: ChannelId; to?: ChannelId[]; slots?: string[]; format?: string; pillar?: string; navigate?: string };
  done?: { at: string; result: string };
}

export interface Report {
  id: string;
  title: string;
  headline: string;
  audience: Audience;
  kind: PeriodKind;
  facts: Facts;
  sections: Section[];
  recommendations: Recommendation[];
  writer: 'claude' | 'template' | 'mixed';
  createdAt: string;
  updatedAt: string;
  by?: string;
  status: 'draft' | 'ready' | 'sent';
  sentAt?: string;
  /** The person's own words added at the top. */
  intro?: string;
  version: number;
}

// ── formatting ─────────────────────────────────────────────────────────

export const num = (x: number) => Math.round(x).toLocaleString('en-US');
export const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
export const times = (x: number) => `${x >= 10 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')}×`;
const plural = (n: number, w: string, many = `${w}s`) => `${num(n)} ${n === 1 ? w : many}`;
const chName = (ch: ChannelId) => channel(ch)?.name ?? ch;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const quote = (t: string) => `“${t.replace(/^Sample · /, '').slice(0, 70)}${t.length > 70 ? '…' : ''}”`;
/** "PDF carousel" from "LinkedIn · PDF carousel: 2.1× your usual (12 posts, high confidence)". */
const winName = (label: string) => label.replace(/^[^·]+· /, '').replace(/:.*$/, '');
const during = (f: Facts) => ({ last7: 'this week', last30: 'in the last 30 days', lastMonth: `in ${f.period.label}`, lastQuarter: `in ${f.period.label}`, custom: `between ${f.period.label}` })[f.period.kind];
const kpi = (f: Facts, k: Kpi['key']) => f.kpis.find((x) => x.key === k);
const movement = (k: Kpi | undefined) => (k?.change === undefined ? undefined : Math.abs(k.change) < 0.03 ? 'held steady' : k.change > 0 ? `up ${pct(k.change)}` : `down ${pct(k.change)}`);

// ── recommendations ────────────────────────────────────────────────────

/** Up to three next steps, each tied to something Shipcast can do in one click. */
export function recommend(f: Facts, opts: { cadence?: Partial<Record<ChannelId, { slots: string[] }>>; suggested?: Partial<Record<ChannelId, { slots: string[]; why: string[] }>> } = {}): Recommendation[] {
  const out: Recommendation[] = [];
  const add = (r: Omit<Recommendation, 'id'>) => out.push({ id: `r${out.length + 1}`, ...r });

  const best = f.top[0];
  if (best?.lift !== undefined && best.lift >= 1.3)
    add({ kind: 'more-like-this', text: `Follow up ${quote(best.title)} with a post in the same format and angle.`, why: `It did ${times(best.lift)} your usual on ${chName(best.channel)}${best.why[0] ? `, and it had what usually wins for you (${winName(best.why[0])})` : ''}.`, action: { label: 'Make a follow-up idea', post: best.post } });

  const goal = f.goals.find((g) => g.onTrack === false && g.needPerWeek);
  if (goal) add({ kind: 'pace', text: `Close the gap on “${goal.label}”: ${num(goal.needPerWeek!)} a week from here.`, why: `At this pace it ends near ${num(goal.projected ?? goal.actual)} against a target of ${num(goal.target)}.`, action: { label: 'Plan the posts', navigate: '/calendar?plan=1' } });

  // A clear win this period's posts mostly didn't use.
  for (const c of f.playbook) {
    const win = c.wins[0];
    if (!win || out.some((r) => r.kind === 'double-down')) continue;
    const name = winName(win);
    const used = f.work.posts.filter((p) => p.channel === c.channel && p.why.includes(win)).length;
    const total = f.work.posts.filter((p) => p.channel === c.channel).length;
    if (total >= 3 && used / total < 0.5) add({ kind: 'double-down', text: `Lean on ${name.toLowerCase()} on ${chName(c.channel)}: only ${used} of ${plural(total, 'post')} used it this time.`, why: `${win.replace(/^[^·]+· /, '')}.`, action: { label: 'Add an idea', channel: c.channel, format: f.work.posts.find((p) => p.channel === c.channel && p.why.includes(win))?.format } });
  }

  for (const [ch, s] of Object.entries(opts.suggested ?? {}) as [ChannelId, { slots: string[]; why: string[] }][]) {
    if (out.some((r) => r.kind === 'slots')) break;
    const have = opts.cadence?.[ch]?.slots ?? [];
    const fresh = s.slots.filter((x) => !have.includes(x));
    if (fresh.length && f.channels.some((c) => c.channel === ch)) add({ kind: 'slots', text: `Post on ${chName(ch)} at ${list(fresh.slice(0, 2))}.`, why: s.why[0] ? `${s.why[0]}.` : '', action: { label: 'Use these times', channel: ch, slots: [...new Set([...fresh, ...have])].slice(0, 7) } });
  }

  if (best?.lift !== undefined && best.lift >= 1.5 && f.channels.length > 1) {
    const others = f.channels.map((c) => c.channel).filter((c) => c !== best.channel);
    add({ kind: 'remix', text: `Remix ${quote(best.title)} for ${list(others.map(chName))}.`, why: `A proven idea is the cheapest good post: it worked on ${chName(best.channel)}.`, action: { label: 'Make remix ideas', post: best.post, to: others } });
  }
  if (f.coverage.missing.length) add({ kind: 'numbers', text: `Add numbers for ${plural(f.coverage.missing.length, 'post')} so next week’s report sees everything.`, why: 'Posts without numbers count as published but not as reached.', action: { label: 'Add numbers', navigate: '/insights?tab=numbers' } });
  if (f.work.upcoming === 0) add({ kind: 'plan', text: 'Nothing is scheduled for next week yet — plan it.', why: 'An empty week is the easiest way to lose momentum.', action: { label: 'Plan my week', navigate: '/calendar?plan=1' } });

  const order: RecKind[] = ['pace', 'more-like-this', 'double-down', 'plan', 'slots', 'remix', 'numbers'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 3).map((r, i) => ({ ...r, id: `r${i + 1}` }));
}

// ── template writer ────────────────────────────────────────────────────

export function templateHeadline(f: Facts): string {
  const a = kpi(f, 'audience');
  const lead = f.waterfall[0];
  if (!f.totals.posts) return `No posts went out in ${f.period.label}`;
  if (!a || a.change === undefined) return `${plural(f.totals.posts, 'post')} out, reaching ${num(f.totals.audience)} people`;
  const m = movement(a)!;
  const by = lead && Math.abs(a.change) >= 0.03 && Math.sign(lead.delta) === Math.sign(a.change) ? (a.change > 0 ? `, led by ${lead.name}` : `, mostly ${lead.name}`) : '';
  return `People reached ${m}${m === 'held steady' ? ` at ${num(a.value)}` : ` to ${num(a.value)}`}${by}`;
}

function postLine(p: PostFact): string {
  const bits = [p.lift !== undefined ? `${times(p.lift)} your usual` : p.audience !== undefined ? `${num(p.audience)} reached` : '', p.visits ? `${plural(p.visits, 'site visit')}${p.keyEvents ? `, ${plural(p.keyEvents, 'key event')}` : ''}` : ''].filter(Boolean);
  return `${quote(p.title)} on ${chName(p.channel)}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
}

export function templateSections(f: Facts, recs: Recommendation[], audience: Audience): Section[] {
  const s: Partial<Record<SectionId, string[]>> = {};
  const a = kpi(f, 'audience'), e = kpi(f, 'engagement'), r = kpi(f, 'rate');

  // In short
  const sum: string[] = [];
  if (f.totals.posts) sum.push(`${plural(f.totals.posts, 'post')} went out ${during(f)} and reached ${num(f.totals.audience)} people${a?.change !== undefined ? ` (${movement(a)} on the period before)` : ''}.`);
  else sum.push(`Nothing was published ${during(f)}.`);
  if (f.top[0]) sum.push(`Best post: ${postLine(f.top[0])}.`);
  const g = f.goals[0];
  if (g) sum.push(g.done ? `“${g.label}” is hit: ${num(g.actual)} of ${num(g.target)}.` : g.projected !== undefined ? `“${g.label}” is ${g.onTrack ? 'on track' : 'behind'}: ${num(g.actual)} so far, heading for about ${num(g.projected)} of ${num(g.target)}.` : `“${g.label}”: ${num(g.actual)} of ${num(g.target)} so far.`);
  s.summary = sum;

  // What we shipped
  const work: string[] = [];
  const by = Object.entries(f.work.byChannel).map(([ch, n]) => `${num(n!)} on ${chName(ch as ChannelId)}`);
  if (f.work.published) work.push(`Published ${plural(f.work.published, 'post')}${by.length > 1 ? `: ${list(by)}` : by.length ? ` ${by[0].replace(/^\d[\d,]* /, '')}` : ''}.`);
  if (f.work.pieces) work.push(`Made ${plural(f.work.pieces, 'piece')} in ${list(f.work.campaigns.filter((c) => c.pieces).map((c) => `“${c.name}”`))}.`);
  for (const c of f.work.campaigns.filter((c) => c.created && !c.pieces)) work.push(`Started the “${c.name}” project.`);
  if (f.work.experiments.length) work.push(`Tried ${plural(f.work.experiments.length, 'experiment')}: ${f.work.experiments.map((x) => `${x.experiment.replace(/^Experiment:\s*/i, '').replace(/[.—–-]+\s*$/, '')}${x.lift !== undefined ? ` (${times(x.lift)} your usual)` : ''}`).join('; ')}.`);
  if (f.work.upcoming) work.push(`${plural(f.work.upcoming, 'post')} ${f.work.upcoming === 1 ? 'is' : 'are'} scheduled for the next seven days.`);
  s.work = work;

  // How it did
  const res: string[] = [];
  if (a) res.push(`People reached: ${num(a.value)}${a.prev !== undefined ? ` (was ${num(a.prev)})` : ''}.`);
  if (e && e.value) res.push(`Engagement: ${num(e.value)}${e.prev !== undefined ? ` (was ${num(e.prev)})` : ''}${r ? `, ${r.value}% of people reached` : ''}.`);
  const changes = f.waterfall.slice(0, 3).map((w) => `${w.name} ${w.delta > 0 ? '+' : '−'}${num(Math.abs(w.delta))}`);
  if (changes.length && a?.prev !== undefined) res.push(`Change in reach by channel: ${list(changes)}.`);
  for (const k of ['clicks', 'follows'] as const) {
    const x = kpi(f, k);
    if (x?.value) res.push(`${x.label}: ${num(x.value)}${x.prev !== undefined ? ` (was ${num(x.prev)})` : ''}.`);
  }
  s.results = res;

  // Why
  const why: string[] = [];
  if (f.split && f.prev.measured) {
    const { volume, quality, perPost, prevPerPost } = f.split;
    const v = volume >= 0 ? `more posts added ${num(volume)}` : `fewer posts cost ${num(-volume)}`;
    const q = quality >= 0 ? `each post reached more people (${num(perPost)} against ${num(prevPerPost)}), adding ${num(quality)}` : `each post reached fewer people (${num(perPost)} against ${num(prevPerPost)}), costing ${num(-quality)}`;
    why.push(`Of the change in reach, ${v}, and ${q}.`);
  }
  for (const p of f.top.slice(0, 2)) if (p.why.length) why.push(`${quote(p.title)} had what usually wins for you: ${list(p.why.map(winName))}.`);
  for (const p of f.bottom.slice(0, 1)) why.push(`${quote(p.title)} did ${times(p.lift!)} your usual on ${chName(p.channel)} — worth a look at its format and timing.`);
  if (!why.length) for (const c of f.playbook.slice(0, 2)) if (c.wins[0]) why.push(`What wins for you on ${chName(c.channel)}: ${c.wins[0].replace(/^[^·]+· /, '')}.`);
  for (const n of f.notes.slice(0, 3)) why.push(`Note from the team (${n.date}): ${n.text}`);
  s.why = why;

  // Website
  if (f.site) {
    const w = f.site;
    const web: string[] = [`Website visits: ${num(w.sessions)}${w.prev.sessions ? ` (was ${num(w.prev.sessions)})` : ''}, with ${plural(w.keyEvents, 'key event')}${w.prev.keyEvents ? ` (was ${num(w.prev.keyEvents)})` : ''}.`];
    if (w.social.length) web.push(`From social: ${list(w.social.slice(0, 3).map((x) => `${chName(x.channel)} ${num(x.sessions)} visits${x.keyEvents ? ` and ${plural(x.keyEvents, 'key event')}` : ''}`))}.`);
    const tagged = f.work.posts.filter((p) => p.visits).sort((a, b) => b.visits! - a.visits!);
    if (tagged[0]) web.push(`Top post for the site: ${quote(tagged[0].title)} sent ${plural(tagged[0].visits!, 'visit')}${tagged[0].keyEvents ? ` and ${plural(tagged[0].keyEvents, 'key event')}` : ''}.`);
    if (w.search) web.push(`Search: ${num(w.search.clicks)} clicks from ${num(w.search.impressions)} impressions${w.search.position !== undefined ? `, average position ${w.search.position}` : ''}${w.search.prev.clicks ? ` (clicks were ${num(w.search.prev.clicks)})` : ''}.`);
    if (w.topQueries[0]) web.push(`Top searches: ${list(w.topQueries.slice(0, 3).map((q) => `“${q.query}”`))}.`);
    s.website = web;
  }

  // Goals
  s.goals = f.goals.map((g) => `${g.label}, ${g.window.label}: ${num(g.actual)} of ${num(g.target)}${g.done ? ' — done.' : g.projected !== undefined ? ` — heading for about ${num(g.projected)} (forecast)${g.needPerWeek ? `; needs ${num(g.needPerWeek)} a week` : ''}.` : '.'}`);

  s.notable = f.notable.map((n) => `${n.text}.`);
  s.next = recs.map((x) => `${x.text} ${x.why}`.trim());
  s.coverage = f.coverage.messages;

  // A client hears the good news first.
  if (audience === 'client' && f.top[0] && s.summary.length > 1) s.summary = [s.summary[1], s.summary[0], ...s.summary.slice(2)];
  return assemble(s, audience);
}

function assemble(s: Partial<Record<SectionId, string[]>>, audience: Audience): Section[] {
  const shown = AUDIENCES[audience].sections;
  return SECTION_IDS.filter((id) => s[id]?.length).map((id) => ({ id, title: SECTION_TITLES[id], lines: s[id]!, ...(shown.includes(id) ? {} : { hidden: true }) }));
}

// ── checking numbers ───────────────────────────────────────────────────

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
export const numbersIn = (s: string) => (s.match(NUM_RE) ?? []).map((x) => Number(x.replace(/,/g, ''))).filter(Number.isFinite);

/** Every number a sentence may use: the facts' numbers in all the ways they get written (rounded, as %, in thousands), and the numbers in their text. */
export function allowedNumbers(f: Facts, recs: Recommendation[] = []): Set<number> {
  const out = new Set<number>();
  const addVariants = (v: number) => {
    for (const x of [v, Math.abs(v)]) {
      out.add(x);
      for (const d of [0, 1, 2]) out.add(Math.round(x * 10 ** d) / 10 ** d);
      if (Math.abs(x) < 10) for (const d of [0, 1]) out.add(Math.round(x * 100 * 10 ** d) / 10 ** d);
      if (Math.abs(x) >= 1000) for (const d of [0, 1]) out.add(Math.round((x / 1000) * 10 ** d) / 10 ** d);
      if (Math.abs(x) >= 1_000_000) for (const d of [0, 1]) out.add(Math.round((x / 1_000_000) * 10 ** d) / 10 ** d);
    }
  };
  const walk = (x: unknown) => {
    if (typeof x === 'number' && Number.isFinite(x)) addVariants(x);
    else if (typeof x === 'string') for (const n of numbersIn(x)) out.add(n);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(f);
  walk(recs);
  // Differences people naturally say ("up 2,700").
  for (const k of f.kpis) if (k.prev !== undefined) addVariants(k.value - k.prev);
  for (const c of f.channels) addVariants(c.audience - c.prev.audience);
  // Small counting words ("three things", "top 3") are fine.
  for (const n of [0, 1, 2, 3]) out.add(n);
  return out;
}

export function checkLine(line: string, allowed: Set<number>): boolean {
  return line.length > 0 && line.length <= 400 && numbersIn(line).every((n) => allowed.has(n));
}

// ── Claude writer ──────────────────────────────────────────────────────

/** What the writer sees: the facts without bulky or private bits. */
export function writerInput(f: Facts, recs: Recommendation[]): string {
  const p = (x: PostFact) => ({ title: x.title.replace(/^Sample · /, ''), channel: x.channel, ...(x.lift !== undefined ? { timesUsual: x.lift } : {}), ...(x.audience !== undefined ? { reached: x.audience } : {}), ...(x.visits ? { siteVisits: x.visits, keyEvents: x.keyEvents } : {}), ...(x.why.length ? { hadWhatWins: x.why } : {}), ...(x.experiment ? { experiment: x.experiment } : {}) });
  return JSON.stringify({
    period: f.period.label,
    previousPeriod: f.prevPeriod.label,
    kpis: f.kpis.map((k) => ({ name: k.label, value: k.value, previous: k.prev, changePercent: k.change === undefined ? undefined : Math.round(k.change * 100), ...(k.unit ? { unit: '%' } : {}) })),
    reachChangeByChannel: f.waterfall.map((w) => ({ channel: w.name, change: w.delta })),
    reachSplit: f.split && { fromPostCount: f.split.volume, fromReachPerPost: f.split.quality, reachPerPostNow: f.split.perPost, reachPerPostBefore: f.split.prevPerPost },
    bestPosts: f.top.map(p),
    weakestPosts: f.bottom.map(p),
    work: { published: f.work.published, byChannel: f.work.byChannel, piecesMade: f.work.pieces, projects: f.work.campaigns.map((c) => c.name), experiments: f.work.experiments, scheduledNextWeek: f.work.upcoming },
    goals: f.goals.map((g) => ({ goal: g.label, window: g.window.label, actual: g.actual, target: g.target, forecastAtEnd: g.projected, onTrack: g.onTrack, neededPerWeek: g.needPerWeek, done: g.done })),
    website: f.site && { visits: f.site.sessions, previousVisits: f.site.prev.sessions, keyEvents: f.site.keyEvents, previousKeyEvents: f.site.prev.keyEvents, fromSocial: f.site.social, search: f.site.search, topSearches: f.site.topQueries },
    notable: f.notable.map((n) => n.text),
    whatWinsForThisBrand: f.playbook,
    teamNotes: f.notes.map((n) => `${n.date}: ${n.text}`),
    nextSteps: recs.map((r) => ({ id: r.id, text: r.text, why: r.why })),
    cannotSee: f.coverage.messages,
  });
}

export function writerPrompt(f: Facts, recs: Recommendation[], audience: Audience): string {
  const want = AUDIENCES[audience].sections.filter((s) => s !== 'coverage');
  return `Write a marketing report for ${f.period.label} from these facts (JSON). The reader: ${AUDIENCES[audience].style}

FACTS
${writerInput(f, recs)}

Rules:
- Use only numbers that appear in the facts (you may round them, write them as a percentage when the fact is a change, or write thousands as "8.8k"). Never compute a new number, total or percentage. Never guess.
- Every section explains what happened, why (using bestPosts.hadWhatWins, reachSplit, reachChangeByChannel, teamNotes), and what it means. No filler, no hype, no emoji.
- "next" restates the nextSteps in this reader's voice, one line each, same order.
- Say "your usual" for timesUsual. Forecasts must be called forecasts.
- Skip a section (empty list) when the facts have nothing for it.

Reply with JSON only:
{"headline": "one line, under 90 characters", ${want.map((s) => `"${s}": ["sentence", ...]`).join(', ')}}`;
}

const WRITER_ROLE = 'You are the analyst inside Shipcast, a local marketing studio. You write clear reports from facts you are given; you never invent numbers. Do not use tools. Reply with JSON only.';

export async function askWriter(prompt: string, timeoutMs = 240_000): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-report-'));
  try {
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: [], model: 'sonnet', appendSystemPrompt: WRITER_ROLE, extraArgs: ['--max-turns', '2', '--disallowedTools', 'WebFetch,WebSearch,Bash,Read,Write,Edit,Task', '--setting-sources', 'project', '--strict-mcp-config'], env: { MAX_THINKING_TOKENS: '0' }, onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; else if (e.kind === 'text') text = text || e.text; } });
    const timer = setTimeout(run.kill, timeoutMs);
    const r = await run.done;
    clearTimeout(timer);
    return r.result?.text || text;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

/** Claude's words, line by line, kept only where every number checks out; anything lost falls back to the template. */
export async function writeReport(f: Facts, recs: Recommendation[], audience: Audience, ask?: (p: string) => Promise<string> | null): Promise<{ headline: string; sections: Section[]; writer: Report['writer'] }> {
  const template = templateSections(f, recs, audience);
  const fallback = { headline: templateHeadline(f), sections: template, writer: 'template' as const };
  if (!ask || !f.totals.posts) return fallback;
  let reply: Record<string, unknown>;
  try {
    reply = JSON.parse(((await ask(writerPrompt(f, recs, audience))) ?? '').replace(/^[^{]*/s, '').replace(/[^}]*$/s, ''));
  } catch {
    return fallback;
  }
  const allowed = allowedNumbers(f, recs);
  let used = 0, dropped = 0;
  const sections = template.map((t) => {
    const raw = reply[t.id];
    if (!Array.isArray(raw) || t.id === 'coverage') return t;
    const lines = raw.map((x) => String(x).trim()).filter(Boolean);
    const ok = lines.filter((l) => checkLine(l, allowed));
    dropped += lines.length - ok.length;
    if (!ok.length) return t;
    used++;
    return { ...t, lines: ok.slice(0, 6) };
  });
  const h = typeof reply.headline === 'string' ? reply.headline.trim() : '';
  const headline = h && h.length <= 120 && checkLine(h, allowed) ? h : fallback.headline;
  if (!used) return fallback;
  return { headline, sections, writer: dropped || used < template.filter((t) => t.id !== 'coverage').length ? 'mixed' : 'claude' };
}

// ── store ──────────────────────────────────────────────────────────────

const file = (id: string) => join(reportsDir(), `${id}.json`);
const versionsFile = (id: string) => join(reportsDir(), `${id}.versions.json`);
export const isReportId = (id: string) => /^rep[a-z0-9]{6,32}$/.test(id);

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = async () => {
    await mkdir(reportsDir(), { recursive: true });
    return withDirLock(reportsDir(), fn);
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
};

async function writeJson(f: string, data: unknown) {
  const tmp = `${f}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, f);
}

export async function getReport(id: string): Promise<Report | null> {
  if (!isReportId(id)) return null;
  try {
    return JSON.parse(await readFile(file(id), 'utf8'));
  } catch {
    return null;
  }
}

export interface ReportSummary {
  id: string;
  title: string;
  headline: string;
  audience: Audience;
  kind: PeriodKind;
  period: string;
  createdAt: string;
  status: Report['status'];
  sentAt?: string;
  kpis: Pick<Kpi, 'key' | 'label' | 'value' | 'change' | 'unit'>[];
}

export async function listReports(): Promise<ReportSummary[]> {
  let names: string[] = [];
  try {
    names = (await readdir(reportsDir())).filter((n) => /^rep[a-z0-9]+\.json$/.test(n));
  } catch {
    return [];
  }
  const out: ReportSummary[] = [];
  for (const n of names) {
    const r = await getReport(n.replace(/\.json$/, ''));
    if (r) out.push({ id: r.id, title: r.title, headline: r.headline, audience: r.audience, kind: r.kind, period: r.facts.period.label, createdAt: r.createdAt, status: r.status, ...(r.sentAt ? { sentAt: r.sentAt } : {}), kpis: r.facts.kpis.slice(0, 4).map(({ key, label, value, change, unit }) => ({ key, label, value, ...(change !== undefined ? { change } : {}), ...(unit ? { unit } : {}) })) });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const titleFor = (kind: PeriodKind, label: string) => `${kind === 'last7' ? 'Weekly report' : kind === 'last30' ? '30-day report' : kind === 'lastMonth' ? 'Monthly report' : kind === 'lastQuarter' ? 'Quarterly report' : 'Report'} · ${label}`;

export interface CreateReportOptions {
  kind?: PeriodKind;
  audience?: Audience;
  custom?: { start: string; end: string };
  asOf?: Date;
  by?: string;
  tz?: string;
  /** null: template only. */
  ask?: ((p: string) => Promise<string>) | null;
  siteConnected?: boolean;
}

export async function createReport(o: CreateReportOptions = {}): Promise<Report> {
  const asOf = o.asOf ?? new Date();
  const tz = o.tz ?? (await readPlan()).tz;
  const kind = o.kind ?? 'last7';
  const audience = o.audience && AUDIENCES[o.audience] ? o.audience : 'team';
  const facts = await gatherFacts(periodFor(kind, asOf, tz, o.custom), asOf, { siteConnected: o.siteConnected ?? (await googleSiteConnected().catch(() => false)) });
  const plan = await readPlan();
  const recs = recommend(facts, { cadence: plan.cadence, suggested: suggestedSlots(await readPlaybook()) });
  const words = await writeReport(facts, recs, audience, o.ask === undefined ? askWriter : o.ask ?? undefined);
  const now = new Date().toISOString();
  const r: Report = { id: `rep${randomBytes(6).toString('hex')}`, title: titleFor(kind, facts.period.label), headline: words.headline, audience, kind, facts, sections: words.sections, recommendations: recs, writer: words.writer, createdAt: now, updatedAt: now, ...(o.by ? { by: o.by } : {}), status: 'ready', version: 1 };
  await serial(() => writeJson(file(r.id), r));
  return r;
}

/** Rewrite the words (new audience, or Claude again) from the same frozen facts; keeps a version. */
export async function rewriteReport(id: string, o: { audience?: Audience; ask?: ((p: string) => Promise<string>) | null } = {}): Promise<Report> {
  const cur = await getReport(id);
  if (!cur) throw Object.assign(new Error('report not found'), { status: 404 });
  const audience = o.audience && AUDIENCES[o.audience] ? o.audience : cur.audience;
  const words = await writeReport(cur.facts, cur.recommendations, audience, o.ask === undefined ? askWriter : o.ask ?? undefined);
  return patchReport(id, () => ({ audience, headline: words.headline, sections: words.sections, writer: words.writer }));
}

export interface ReportEdit {
  title?: string;
  headline?: string;
  intro?: string;
  sections?: { id: SectionId; lines?: string[]; hidden?: boolean }[];
  status?: Report['status'];
}

export function editReport(id: string, e: ReportEdit): Promise<Report> {
  return patchReport(id, (cur) => {
    const out: Partial<Report> = {};
    if (typeof e.title === 'string' && e.title.trim()) out.title = e.title.trim().slice(0, 140);
    if (typeof e.headline === 'string' && e.headline.trim()) out.headline = e.headline.trim().slice(0, 200);
    if (typeof e.intro === 'string') out.intro = e.intro.slice(0, 2000);
    if (e.status && ['draft', 'ready', 'sent'].includes(e.status)) out.status = e.status;
    if (Array.isArray(e.sections))
      out.sections = cur.sections.map((s) => {
        const ch = e.sections!.find((x) => x.id === s.id);
        if (!ch) return s;
        const lines = Array.isArray(ch.lines) ? ch.lines.map((l) => String(l).trim().slice(0, 600)).filter(Boolean).slice(0, 20) : undefined;
        return { ...s, ...(lines ? { lines, edited: true } : {}), ...(typeof ch.hidden === 'boolean' ? { hidden: ch.hidden } : {}) };
      });
    return out;
  });
}

function patchReport(id: string, fn: (cur: Report) => Partial<Report>): Promise<Report> {
  return serial(async () => {
    const cur = await getReport(id);
    if (!cur) throw Object.assign(new Error('report not found'), { status: 404 });
    const patch = fn(cur);
    const next: Report = { ...cur, ...patch, version: cur.version + 1, updatedAt: new Date().toISOString() };
    let versions: Pick<Report, 'version' | 'headline' | 'sections' | 'audience' | 'updatedAt' | 'intro'>[] = [];
    try {
      versions = JSON.parse(await readFile(versionsFile(id), 'utf8'));
    } catch {}
    versions.push({ version: cur.version, headline: cur.headline, sections: cur.sections, audience: cur.audience, updatedAt: cur.updatedAt, ...(cur.intro ? { intro: cur.intro } : {}) });
    await writeJson(versionsFile(id), versions.slice(-20));
    await writeJson(file(id), next);
    return next;
  });
}

/** Sent: a status, not an edit (no new version). */
export function markReportSent(id: string, at = new Date()): Promise<void> {
  return serial(async () => {
    const cur = await getReport(id);
    if (cur) await writeJson(file(id), { ...cur, status: 'sent', sentAt: at.toISOString() });
  });
}

export async function reportVersions(id: string): Promise<{ version: number; updatedAt: string; headline: string }[]> {
  if (!isReportId(id)) return [];
  try {
    return (JSON.parse(await readFile(versionsFile(id), 'utf8')) as Report[]).map((v) => ({ version: v.version, updatedAt: v.updatedAt, headline: v.headline }));
  } catch {
    return [];
  }
}

/** Put an earlier version's words back (the current ones become a version too). */
export async function restoreVersion(id: string, version: number): Promise<Report> {
  let versions: Report[] = [];
  try {
    versions = JSON.parse(await readFile(versionsFile(id), 'utf8'));
  } catch {}
  const v = versions.find((x) => x.version === version);
  if (!v) throw Object.assign(new Error('version not found'), { status: 404 });
  return patchReport(id, () => ({ headline: v.headline, sections: v.sections, audience: v.audience, intro: v.intro }));
}

export async function deleteReport(id: string): Promise<boolean> {
  if (!isReportId(id)) return false;
  return serial(async () => {
    const had = !!(await getReport(id));
    await rm(file(id), { force: true });
    await rm(versionsFile(id), { force: true });
    return had;
  });
}

/** Do what a next step's button says. */
export async function runRecommendation(id: string, recId: string): Promise<{ report: Report; created?: Post[]; navigate?: string; result: string }> {
  const r = await getReport(id);
  if (!r) throw Object.assign(new Error('report not found'), { status: 404 });
  const rec = r.recommendations.find((x) => x.id === recId);
  if (!rec) throw Object.assign(new Error('next step not found'), { status: 404 });
  let created: Post[] = [], result = '', navigate: string | undefined;
  switch (rec.kind) {
    case 'more-like-this':
      created = [await moreLikeThis(rec.action.post!)];
      result = 'Follow-up idea added to the calendar';
      break;
    case 'remix':
      created = await remix(rec.action.post!, rec.action.to);
      result = `${created.length} remix idea${created.length === 1 ? '' : 's'} added`;
      break;
    case 'slots': {
      const plan = await readPlan();
      const ch = rec.action.channel!;
      await savePlan({ cadence: { ...plan.cadence, [ch]: { perWeek: plan.cadence[ch]?.perWeek ?? 2, slots: rec.action.slots ?? [] } } });
      result = `${chName(ch)} times updated`;
      break;
    }
    case 'double-down':
      created = [await savePost({ title: `More ${rec.text.replace(/^Lean on /, '').replace(/ on .*$/, '')}`.slice(0, 120), status: 'idea', ...(rec.action.format ? { format: rec.action.format } : {}), notes: `From the report “${r.title}”: ${rec.why}`, channels: [{ channel: rec.action.channel!, caption: '', hashtags: [], media: [], via: 'manual' }] })];
      result = 'Idea added to the calendar';
      break;
    default:
      navigate = rec.action.navigate;
      result = 'Opened';
  }
  const report = await patchReport(id, (cur) => ({ recommendations: cur.recommendations.map((x) => (x.id === recId ? { ...x, done: { at: new Date().toISOString(), result } } : x)) }));
  return { report, created, ...(navigate ? { navigate } : {}), result };
}


// ── goals and notes ────────────────────────────────────────────────────

/** Replace the workspace's goals (at most 8), cleaned. */
export function saveGoals(input: unknown): Promise<Goal[]> {
  const goals: Goal[] = (Array.isArray(input) ? input : [])
    .map((g: any) => ({
      id: typeof g?.id === 'string' && /^[\w-]{1,24}$/.test(g.id) ? g.id : `g${randomBytes(4).toString('hex')}`,
      metric: g?.metric,
      target: Number(g?.target),
      per: g?.per,
      ...(g?.channel && channel(g.channel) ? { channel: g.channel as ChannelId } : {}),
      ...(typeof g?.label === 'string' && g.label.trim() ? { label: g.label.trim().slice(0, 80) } : {}),
    }))
    .filter((g) => (KPI_KEYS as readonly string[]).includes(g.metric) && Number.isFinite(g.target) && g.target > 0 && ['week', 'month', 'quarter'].includes(g.per))
    .slice(0, 8);
  return serial(async () => {
    await writeJson(join(reportsDir(), 'goals.json'), goals);
    return goals;
  });
}

export function addNote(n: { date?: string; text?: string }, by?: string): Promise<Note> {
  const date = String(n.date ?? '');
  const text = String(n.text ?? '').trim().slice(0, 280);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) throw Object.assign(new Error('A note needs a date (YYYY-MM-DD) and some text.'), { status: 400 });
  const note: Note = { id: `n${randomBytes(4).toString('hex')}`, date, text, ...(by ? { by } : {}) };
  return serial(async () => {
    const all = await readNotes();
    await writeJson(join(reportsDir(), 'notes.json'), [...all, note].sort((a, b) => a.date.localeCompare(b.date)).slice(-500));
    return note;
  });
}

export function deleteNote(id: string): Promise<boolean> {
  return serial(async () => {
    const all = await readNotes();
    const rest = all.filter((x) => x.id !== id);
    await writeJson(join(reportsDir(), 'notes.json'), rest);
    return rest.length !== all.length;
  });
}


// ── ask the report ─────────────────────────────────────────────────────

export interface AskChart {
  title: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}
export interface AskAnswer {
  answer: string[];
  chart?: AskChart;
  /** 'claude': written and checked; 'facts': answered from the facts without a model. */
  by: 'claude' | 'facts';
}

/** Labels for each KPI series point (oldest first, ending with this period). */
export function seriesLabels(f: Facts): string[] {
  const n = f.kpis[0]?.series.length ?? 0;
  return Array.from({ length: n }, (_, i) => shiftPeriod(f.period, i - (n - 1)).label);
}

/** Charts the facts can always draw, by question shape. */
export function factsAnswer(f: Facts, q: string, recs: Recommendation[]): AskAnswer {
  const s = q.toLowerCase();
  const labels = seriesLabels(f);
  const kpiChart = (k: Kpi): AskChart => ({ title: `${k.label} by period`, labels, series: [{ name: k.label, values: k.series }] });
  const aud = kpi(f, 'audience');
  if (/channel|platform|linkedin|instagram|youtube|where/.test(s) && f.channels.length) {
    const best = [...f.waterfall].sort((a, b) => b.delta - a.delta)[0];
    return { by: 'facts', answer: [best ? `${best.name} changed most: ${best.delta >= 0 ? '+' : '−'}${num(Math.abs(best.delta))} people reached.` : 'No channel changed.', ...f.channels.map((c) => `${c.name}: ${num(c.audience)} reached from ${plural(c.posts, 'post')} (was ${num(c.prev.audience)}).`)], chart: { title: 'People reached by channel', labels: f.channels.map((c) => c.name), series: [{ name: f.prevPeriod.label, values: f.channels.map((c) => c.prev.audience) }, { name: f.period.label, values: f.channels.map((c) => c.audience) }] } };
  }
  if (/next|should|do |plan|idea/.test(s) && recs.length) return { by: 'facts', answer: recs.map((r) => `${r.text} ${r.why}`) };
  if (/site|web|visit|signup|key event|search/.test(s) && f.site) return { by: 'facts', answer: templateSections(f, recs, 'team').find((x) => x.id === 'website')?.lines ?? [], ...(kpi(f, 'sessions') ? { chart: kpiChart(kpi(f, 'sessions')!) } : {}) };
  if (/goal|target|pace/.test(s) && f.goals.length) return { by: 'facts', answer: templateSections(f, recs, 'team').find((x) => x.id === 'goals')?.lines ?? [] };
  if (/best|top|work|win/.test(s) && f.top.length) return { by: 'facts', answer: [...f.top.map((p) => `${postLine(p)}.`), ...(templateSections(f, recs, 'team').find((x) => x.id === 'why')?.lines.slice(0, 2) ?? [])] };
  return { by: 'facts', answer: [templateHeadline(f) + '.', ...(templateSections(f, recs, 'team').find((x) => x.id === 'why')?.lines ?? [])].slice(0, 5), ...(aud ? { chart: kpiChart(aud) } : {}) };
}

export function askPrompt(r: Report, question: string): string {
  return `A marketer asks about their report for ${r.facts.period.label}: "${question.replace(/"/g, "'")}"

FACTS (JSON)
${writerInput(r.facts, r.recommendations)}
HISTORY (one value per period, oldest first; periods: ${JSON.stringify(seriesLabels(r.facts))})
${JSON.stringify(Object.fromEntries(r.facts.kpis.map((k) => [k.label, k.series])))}
POSTS THIS PERIOD
${JSON.stringify(r.facts.work.posts.map((p) => ({ title: p.title.replace(/^Sample · /, ''), channel: p.channel, date: p.at.slice(0, 10), reached: p.audience, engagement: p.engagement, timesUsual: p.lift, format: p.format, pillar: p.pillar, siteVisits: p.visits })))}

Answer in 1–4 short plain sentences, using only numbers from the data above (you may round them or show a change as a percentage). If the data can't answer, say what's missing. Optionally add one small chart built only from values above.

Reply with JSON only: {"answer": ["sentence", ...], "chart": {"title": "...", "labels": ["..."], "series": [{"name": "...", "values": [numbers]}]} }  (omit "chart" if it doesn't help)`;
}

/** Answer a question about a report: Claude, checked against the data; the facts alone when that fails. */
export async function askReport(id: string, question: string, ask: ((p: string) => Promise<string>) | null = askWriter): Promise<AskAnswer> {
  const r = await getReport(id);
  if (!r) throw Object.assign(new Error('report not found'), { status: 404 });
  const q = String(question ?? '').trim().slice(0, 300);
  if (!q) throw Object.assign(new Error('Ask a question.'), { status: 400 });
  const fallback = factsAnswer(r.facts, q, r.recommendations);
  if (!ask) return fallback;
  let reply: { answer?: unknown; chart?: AskChart };
  try {
    reply = JSON.parse((await ask(askPrompt(r, q))).replace(/^[^{]*/s, '').replace(/[^}]*$/s, ''));
  } catch {
    return fallback;
  }
  const allowed = allowedNumbers(r.facts, r.recommendations);
  for (const k of r.facts.kpis) for (const v of k.series) allowed.add(Math.round(v * 100) / 100), allowed.add(Math.round(v));
  const lines = (Array.isArray(reply.answer) ? reply.answer : []).map((x) => String(x).trim()).filter((l) => checkLine(l, allowed)).slice(0, 5);
  if (!lines.length) return fallback;
  const c = reply.chart;
  const chartOk = c && typeof c.title === 'string' && Array.isArray(c.labels) && Array.isArray(c.series) && c.labels.length <= 24 && c.series.length <= 4 && c.series.every((x) => Array.isArray(x.values) && x.values.length === c.labels.length && x.values.every((v) => typeof v === 'number' && allowed.has(Math.round(v * 100) / 100)));
  return { by: 'claude', answer: lines, ...(chartOk ? { chart: { title: c!.title.slice(0, 80), labels: c!.labels.map((l) => String(l).slice(0, 30)), series: c!.series.map((x) => ({ name: String(x.name).slice(0, 40), values: x.values })) } } : fallback.chart ? { chart: fallback.chart } : {}) };
}

// ── time saved ─────────────────────────────────────────────────────────

/** Hours a person would spend assembling this report by hand (an estimate, from the research in the sprint plan). */
export const HOURS_SAVED: Record<PeriodKind, number> = { last7: 2.5, last30: 4, lastMonth: 4, lastQuarter: 6, custom: 3 };
