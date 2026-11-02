#!/usr/bin/env node
/**
 * Golden eval: score finished campaigns the way a creative director would.
 *
 *   SHIPCAST_HOME=… node tools/eval.ts <campaignId> [<campaignId> …] [--out eval-report.md]
 *
 * For every finished step it gathers the previews (contact sheets, page and
 * slide sheets, ad sheets, email/landing previews, video sheets), asks Claude
 * (vision, no other tools) to score a fixed rubric 1–5, and writes a report.
 * Release bar (docs/sprint-v5.md): average ≥ 4.0 and no criterion scored 1.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { campaignDir, readCampaign, runClaude, getPack, run } from '@shipcast/engine';

const RUBRIC = {
  realism: 'Looks real and professionally made (photos, people, product shots, motion) — not AI-looking or templated',
  fidelity: 'The product is shown accurately (real UI, correct names, no invented features)',
  brand: 'On-brand: colours, type, logo use and the tone of the words',
  hook: 'The first line / first frame makes the intended audience stop and care',
  layout: 'Alignment, hierarchy, spacing; nothing overflowing, cramped or half-empty',
  legibility: 'Every word readable at its real size (phone feed, printed page, slide on a screen)',
  artefacts: 'Free of defects: warped hands/faces/text, morphing, broken images, placeholders, typos',
};
type Crit = keyof typeof RUBRIC;

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : 'eval-report.md';
const ids = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);
if (!ids.length) {
  console.error('usage: node tools/eval.ts <campaignId> … [--out eval-report.md]');
  process.exit(64);
}

/** The images a reviewer would look at for this step, best first, at most 4. */
async function previews(dir: string): Promise<string[]> {
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

async function judge(pack: string, title: string, images: string[]): Promise<{ scores: Record<Crit, number>; notes: string; fix: string } | null> {
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

const rows: { campaign: string; pack: string; title: string; scores: Record<Crit, number>; avg: number; notes: string; fix: string }[] = [];
for (const id of ids) {
  const c = await readCampaign(id);
  if (!c) {
    console.error(`no campaign ${id}`);
    continue;
  }
  for (const s of c.steps) {
    if (s.kind !== 'pack' || s.status !== 'done' || !s.pack) continue;
    const pack = await getPack(s.pack);
    if (!pack || ['campaign-hub', 'campaign-plan', 'app-run', 'app-capture'].includes(pack.id)) continue;
    const imgs = await previews(join(campaignDir(id), 'deliverables', s.id));
    if (!imgs.length) continue;
    const title = s.options._title ?? pack.name;
    process.stdout.write(`judging ${c.name} · ${title}… `);
    const v = await judge(pack.id, title, imgs);
    if (!v) {
      console.log('no verdict');
      continue;
    }
    const vals = Object.keys(RUBRIC).map((k) => Number(v.scores[k as Crit]) || 0);
    const avg = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    console.log(avg);
    rows.push({ campaign: c.name, pack: pack.id, title, scores: v.scores, avg, notes: v.notes, fix: v.fix });
  }
}

const overall = rows.length ? +(rows.reduce((a, r) => a + r.avg, 0) / rows.length).toFixed(2) : 0;
const ones = rows.filter((r) => Object.values(r.scores).some((x) => Number(x) <= 1));
const pass = rows.length > 0 && overall >= 4 && !ones.length;
const md = [
  `# Shipcast eval — ${new Date().toISOString().slice(0, 10)}`,
  '',
  `**Overall ${overall} / 5 across ${rows.length} pieces — ${pass ? 'PASS' : 'NOT YET'}** (bar: average ≥ 4.0, no criterion at 1)`,
  '',
  `| Piece | Format | ${Object.keys(RUBRIC).join(' | ')} | Avg |`,
  `|---|---|${Object.keys(RUBRIC).map(() => '---').join('|')}|---|`,
  ...rows.map((r) => `| ${r.title} | ${r.pack} | ${Object.keys(RUBRIC).map((k) => r.scores[k as Crit] ?? '–').join(' | ')} | **${r.avg}** |`),
  '',
  '## Notes and the one fix per piece',
  ...rows.map((r) => `- **${r.title}** (${r.pack}, ${r.avg}): ${r.notes} → *${r.fix}*`),
  '',
].join('\n');
await writeFile(outFile, md);
console.log(`\n${md.split('\n')[2]}\nReport: ${outFile}`);
