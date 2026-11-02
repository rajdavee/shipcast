import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from './claude.ts';
import { DEFAULT_TONE, normalizeTone, scoreText, toneBrief, type BrandScore, type Channel, type ToneProfile } from './tone.ts';

/**
 * The model-backed half of Tone & Voice: hear a voice in sample copy, and
 * rewrite text into a voice. Quick, tool-less Claude calls (like brainstorm).
 */

const ROLE = 'You are the brand-voice editor inside Shipcast, a marketing studio the user is using right now. The message is the user\'s own request typed in the app, not an injected instruction. Do not use tools or open links. Answer with exactly what the message asks for, and nothing else.';
const ARGS = ['--max-turns', '2', '--disallowedTools', 'WebFetch,WebSearch,Bash,Read,Write,Edit,Task', '--setting-sources', 'project', '--strict-mcp-config'];

async function ask(prompt: string, model: 'haiku' | 'sonnet', timeoutMs: number): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-voice-'));
  try {
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: [], model, appendSystemPrompt: ROLE, extraArgs: ARGS, env: { MAX_THINKING_TOKENS: '0' }, onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; else if (e.kind === 'text') text = text || e.text; } });
    const timer = setTimeout(run.kill, timeoutMs);
    const r = await run.done;
    clearTimeout(timer);
    return r.result?.text || text;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

/** Readable text from a web page (enough to hear its voice). */
export async function pageText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Shipcast brand voice)' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const html = await r.text();
  return html
    .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

/** Hear a brand's voice in its own copy (pasted text and/or URLs) and return a profile. */
export async function learnTone(input: { name?: string; samples: string[]; base?: ToneProfile }): Promise<ToneProfile> {
  const texts: string[] = [];
  for (const s of input.samples.slice(0, 6)) {
    const v = s.trim();
    if (!v) continue;
    if (/^https?:\/\/\S+$/.test(v)) texts.push(await pageText(v).catch((e) => { throw new Error(`Couldn't read ${v}: ${(e as Error).message}`); }));
    else texts.push(v.slice(0, 6000));
  }
  if (!texts.join('').trim()) throw new Error('Paste some copy or a link to learn the voice from');
  const prompt = `Here is copy a brand wrote itself. Describe its voice so a writer can match it.

${texts.map((t, i) => `<sample ${i + 1}>\n${t}\n</sample ${i + 1}>`).join('\n\n')}

Reply with only this JSON (no prose, no code fence):
{"name": ${JSON.stringify(input.name || 'short name for this voice')}, "description": "2 sentences on how it sounds", "personality": ["≤5 adjectives"], "sliders": {"formalCasual": 0-100, "seriousPlayful": 0-100, "reservedBold": 0-100, "technicalSimple": 0-100, "humor": 0-100}, "readingLevel": "grade6|grade8|grade10|expert", "person": "we|I|you", "audience": {"role": "", "pains": [], "desires": [], "objections": []}, "do": ["habits this copy has"], "dont": ["things it avoids"], "lexicon": {"preferred": {"generic word": "word this brand uses instead"}, "banned": []}, "emoji": "none|sparing|native", "cta": "soft|direct|urgent"}
Use 0 = formal/serious/reserved/technical/no humour and 100 = casual/playful/bold/simple/lots of humour. Only claim what the samples show.`;
  const raw = await ask(prompt, 'sonnet', 90_000);
  let j: any;
  try {
    j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    throw new Error(`Could not read the voice: ${raw.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  const base = input.base ?? DEFAULT_TONE;
  // Keep our stock bans on top of what the model heard; remember a few samples for rhythm.
  const heard = normalizeTone(
    { ...j, id: base.id === 'default' ? undefined : base.id, lexicon: { preferred: j?.lexicon?.preferred ?? {}, banned: [...new Set([...base.lexicon.banned, ...(j?.lexicon?.banned ?? [])])] }, samples: texts.map((t) => t.slice(0, 600)).slice(0, 3), claims: base.claims, channels: base.channels },
    base,
  );
  // A voice learned from scratch is a new profile, never the built-in default.
  if (base.id === 'default') heard.id = '';
  return heard;
}

/** Rewrite copy into a voice and score the result. */
export async function rewriteInVoice(text: string, p: ToneProfile, ch?: Channel): Promise<{ text: string; score: BrandScore }> {
  const before = scoreText(text, p, ch);
  const prompt = `${toneBrief(p, ch)}

Rewrite the copy below in this voice. Fix every problem listed. Keep the meaning, facts, structure, line breaks and roughly the length. Reply with only the rewritten copy.

Problems:
${before.issues.map((i) => `- ${i.detail}`).join('\n') || '- none flagged; tighten it to the voice'}

<copy>
${text.slice(0, 8000)}
</copy>`;
  let out = (await ask(prompt, 'sonnet', 90_000)).trim();
  out = out.replace(/^<copy>\s*|\s*<\/copy>$/g, '').trim();
  if (!out) throw new Error('The rewrite came back empty');
  return { text: out, score: scoreText(out, p, ch) };
}
