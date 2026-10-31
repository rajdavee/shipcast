import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from './claude.ts';
import type { Source } from './types.ts';

/**
 * The conversation before a campaign: when someone gives us very little,
 * ask the few questions that change the work, then offer a handful of
 * creative directions to pick from. One short, tool-free Claude call per
 * turn, answered as JSON so the UI can render chips instead of prose.
 */

export interface BrainQuestion {
  id: string;
  question: string;
  /** Why this matters, in a few words (shown small under the question). */
  why?: string;
  /** Suggested answers to tap; the user can always type their own. */
  options: string[];
}

export interface BrainDirection {
  id: string;
  title: string;
  /** The first line someone would see or hear. */
  hook: string;
  angle: string;
  tone: string;
}

export interface BrainTurn {
  /** One sentence: what we understood so far. */
  understood: string;
  questions: BrainQuestion[];
  directions: BrainDirection[];
}

export interface BrainInput {
  source: Source;
  formats: string[];
  notes?: string;
  /** question id → answer, once the user has replied. */
  answers?: Record<string, string>;
  /** The questions those answers belong to (so the model sees them in context). */
  asked?: BrainQuestion[];
  model?: string;
}

const MARK = 'shipcast-brainstorm';

function promptFor(i: BrainInput): string {
  const src = i.source.type === 'text' ? `A description from the user: "${i.source.value}"` : `${i.source.type === 'url' ? 'Website' : i.source.type === 'github' ? 'GitHub repo' : 'Local folder'}: ${i.source.value}`;
  const replied = i.answers && Object.keys(i.answers).length;
  const qa = replied ? (i.asked ?? []).map((q) => `- ${q.question} → ${i.answers![q.id] ?? '(skipped)'}`).join('\n') : '';
  return `[${MARK}] You are Shipcast's creative producer, talking with a founder before making their launch content.

What they gave us:
${src}
Formats they picked: ${i.formats.join(', ') || 'not chosen yet'}
Their notes: ${i.notes?.trim() || '(none)'}
${replied ? `\nTheir answers:\n${qa}\n` : ''}
${
  replied
    ? `Now propose 3 distinct creative directions for this campaign (different angles, not three tones of the same idea). Each: a short title, the hook (the first line people would see or hear, specific, ≤ 14 words, no hype words), the angle in one sentence, and the tone in 2–4 words. Ask no more questions.`
    : `Decide what's missing. If you could already make strong, specific work, ask nothing and propose 3 directions. Otherwise ask the 2–4 questions whose answers would change the work most — usually: who it's for, what they should do after watching, the one thing that makes it different, tone, anything that must (or must not) appear. Skip anything the input already answers. Each question is ≤ 12 words with no parenthetical examples (examples belong in the options). Each gets 3–4 short suggested answers tailored to this product (not generic), and a 2–6 word "why".`
}

Reply with ONLY a JSON object, no prose, no code fence:
{"understood":"one sentence","questions":[{"id":"audience","question":"…","why":"…","options":["…","…","…"]}],"directions":[{"id":"d1","title":"…","hook":"…","angle":"…","tone":"…"}]}
Use [] for whichever list is empty.`;
}

/** Pull the first JSON object out of a model reply and keep only well-formed parts. */
export function parseBrainTurn(text: string): BrainTurn {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let j: any = {};
  try {
    j = JSON.parse(text.slice(start, end + 1));
  } catch {
    j = {};
  }
  const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const questions: BrainQuestion[] = (Array.isArray(j.questions) ? j.questions : [])
    .slice(0, 4)
    .map((q: any, k: number) => ({ id: str(q.id, 32).replace(/[^\w-]/g, '') || `q${k + 1}`, question: str(q.question, 160), why: str(q.why, 90) || undefined, options: (Array.isArray(q.options) ? q.options : []).map((o: unknown) => str(o, 80)).filter(Boolean).slice(0, 4) }))
    .filter((q: BrainQuestion) => q.question);
  const directions: BrainDirection[] = (Array.isArray(j.directions) ? j.directions : [])
    .slice(0, 3)
    .map((d: any, k: number) => ({ id: str(d.id, 16).replace(/[^\w-]/g, '') || `d${k + 1}`, title: str(d.title, 60), hook: str(d.hook, 140), angle: str(d.angle, 220), tone: str(d.tone, 60) }))
    .filter((d: BrainDirection) => d.title && d.hook);
  return { understood: str(j.understood, 240), questions, directions };
}

export async function brainstorm(i: BrainInput): Promise<BrainTurn> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-brain-'));
  try {
    let text = '';
    const run = runClaude({
      prompt: promptFor(i),
      cwd,
      allowedTools: [],
      // Questions should feel instant; directions get the default model.
      model: i.model ?? (i.answers ? 'sonnet' : 'haiku'),
      // Skip the user's hooks, plugins and MCP servers: this is a quick chat, not a work session.
      extraArgs: ['--max-turns', '1', '--setting-sources', 'project', '--strict-mcp-config'],
      // No extended thinking: a 25 s pause kills a conversation; answers come back in ~6–8 s.
      env: { MAX_THINKING_TOKENS: '0' },
      onEvent: (e) => {
        if (e.kind === 'result' && e.text) text = e.text;
        if (e.kind === 'text') text = text || e.text;
      },
    });
    const timer = setTimeout(run.kill, 90_000);
    const r = await run.done;
    clearTimeout(timer);
    const turn = parseBrainTurn(r.result?.text || text);
    if (!turn.questions.length && !turn.directions.length) throw new Error(r.result?.text ? 'Could not read the brainstorm reply' : `Claude didn't answer (${r.stderr.trim().split('\n').at(-1) || `exit ${r.code}`})`);
    return turn;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/** Turn the conversation into campaign notes every step will read. */
export function notesFromBrainstorm(asked: BrainQuestion[], answers: Record<string, string>, direction: BrainDirection | undefined, extra = ''): string {
  const lines: string[] = [];
  if (direction) lines.push(`Creative direction — ${direction.title}: ${direction.angle} Hook: "${direction.hook}". Tone: ${direction.tone}.`);
  for (const q of asked) if (answers[q.id]?.trim()) lines.push(`${q.question} ${answers[q.id].trim()}`);
  if (extra.trim()) lines.push(extra.trim());
  return lines.join('\n');
}
