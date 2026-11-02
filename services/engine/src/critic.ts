import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runClaude } from './claude.ts';
import { run } from './exec.ts';

/**
 * The critic: a vision pass that scores a finished piece the way a demanding
 * creative director would. tools/eval.ts uses it for reports; the runner uses
 * it once per piece, while Claude's session is still open, to fix the weakest
 * thing before the user ever sees it.
 */

export const RUBRIC = {
  realism: 'Looks real and professionally made (photos, people, product shots, motion) — not AI-looking or templated',
  fidelity: 'The product is shown accurately (real UI, correct names, no invented features)',
  brand: 'On-brand: colours, type, logo use and the tone of the words',
  hook: 'The first line / first frame makes the intended audience stop and care',
  layout: 'Alignment, hierarchy, spacing; nothing overflowing, cramped or half-empty',
  legibility: 'Every word readable at its real size (phone feed, printed page, slide on a screen)',
  artefacts: 'Free of defects: warped hands/faces/text, morphing, broken images, placeholders, typos',
};
export type Crit = keyof typeof RUBRIC;

/** Criteria a writer can fix by editing the spec (realism needs generated imagery, not a rewrite). */
export const FIXABLE: Crit[] = ['fidelity', 'brand', 'hook', 'layout', 'legibility', 'artefacts'];

export interface Verdict {
  scores: Record<Crit, number>;
  notes: string;
  fix: string;
}

/** The images a reviewer would look at for this step, best first, at most 4. */
export async function previews(dir: string): Promise<string[]> {
  const out = join(dir, 'out');
  const files = (await readdir(out).catch(() => [] as string[])).map((f) => join(out, f));
  const pick = (re: RegExp) => files.filter((f) => re.test(basename(f)));
  const ordered = [
    ...pick(/\.sheet\.(jpg|png)$/),
    ...pick(/^contact-sheet\.jpg$/),
    ...pick(/^(landing|.*)-desktop\.png$/),
    ...pick(/-mobile\.png$/),
    ...pick(/^(video|poster)\.jpg$/),
  ];
  // A video with no preview image: make a frame sheet from the file itself.
  if (!ordered.length) {
    const vid = pick(/\.mp4$/)[0];
    if (vid) {
      const sheet = join(out, 'eval.sheet.jpg');
      await run('ffmpeg', ['-y', '-v', 'error', '-i', vid, '-vf', 'fps=1/3,scale=480:-2,tile=4x3', '-frames:v', '1', sheet]);
      if (existsSync(sheet)) ordered.push(sheet);
    }
  }
  if (!ordered.length) {
    for (const sub of ['slides', 'pages', 'print']) {
      const d = join(out, sub);
      if (existsSync(d)) ordered.push(...(await readdir(d)).filter((f) => /\.png$/.test(f)).sort().slice(0, 3).map((f) => join(d, f)));
    }
  }
  // Sheets shrink everything; add two full-size pages/slides so legibility is judged at real size.
  for (const sub of ['slides', 'pages', 'print']) {
    const d = join(out, sub);
    if (!existsSync(d)) continue;
    const pngs = (await readdir(d)).filter((f) => f.endsWith('.png') && !f.includes('.full.')).sort();
    ordered.splice(1, 0, ...[pngs[0], pngs[Math.min(pngs.length - 1, 2)]].filter(Boolean).map((f) => join(d, f)));
    break;
  }
  return [...new Set(ordered)].slice(0, 4);
}

export async function judge(pack: string, title: string, images: string[]): Promise<Verdict | null> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-eval-'));
  try {
    const local = [];
    for (const [i, f] of images.entries()) {
      const to = join(cwd, `${i + 1}-${basename(f)}`);
      await copyFile(f, to);
      local.push(basename(to));
    }
    const prompt = `You are a demanding creative director reviewing a "${pack}" piece called "${title}". Look at these preview images in the current folder: ${local.join(', ')} (read each one).

Score each criterion 1–5 (5 = would ship to a paying client as is, 3 = fine but forgettable, 1 = embarrassing):
${Object.entries(RUBRIC).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Reply with only JSON: {"scores": {${Object.keys(RUBRIC).map((k) => `"${k}": n`).join(', ')}}, "notes": "the 1–2 biggest strengths and problems", "fix": "the single change that would raise the score most"}`;
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: ['Read'], model: 'sonnet', extraArgs: ['--max-turns', '8', '--setting-sources', 'project', '--strict-mcp-config'], onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; } });
    const timer = setTimeout(run.kill, 180_000);
    const r = await run.done;
    clearTimeout(timer);
    const raw = r.result?.text || text;
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    return null;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}


const avg = (v: Verdict) => {
  const xs = Object.values(v.scores).map(Number).filter(Number.isFinite);
  return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : 0;
};

/** "3.4 avg · lowest legibility 2" for the activity log. */
export function criticSummary(v: Verdict): string {
  const low = Object.entries(v.scores).sort((a, b) => Number(a[1]) - Number(b[1]))[0];
  return `${avg(v)}/5 avg${low ? ` · lowest ${low[0]} ${low[1]}` : ''}`;
}

/** The fixable criterion worth one revision (scored 2 or less), if any. */
export function criticWeakest(v: Verdict, bar = 2): { crit: Crit; score: number } | null {
  const c = FIXABLE.map((k) => ({ crit: k, score: Number(v.scores?.[k]) })).filter((x) => Number.isFinite(x.score) && x.score <= bar).sort((a, b) => a.score - b.score)[0];
  return c ?? null;
}
