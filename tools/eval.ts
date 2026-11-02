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
import { campaignDir, readCampaign, getPack, saveEval, previews, judge, RUBRIC, type Crit } from '@shipcast/engine';



const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : 'eval-report.md';
const ids = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);
if (!ids.length) {
  console.error('usage: node tools/eval.ts <campaignId> … [--out eval-report.md]');
  process.exit(64);
}

const rows: { campaignId: string; step: string; campaign: string; pack: string; title: string; scores: Record<Crit, number>; avg: number; notes: string; fix: string }[] = [];
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
    rows.push({ campaignId: id, step: s.id, campaign: c.name, pack: pack.id, title, scores: v.scores, avg, notes: v.notes, fix: v.fix });
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
// The learning loop reads these: low criteria become incidents for that format.
if (rows.length) await saveEval({ at: new Date().toISOString(), pieces: rows.map((r) => ({ campaign: r.campaignId, step: r.step, pack: r.pack, scores: r.scores, avg: r.avg, fix: r.fix })) });
console.log(`\n${md.split('\n')[2]}\nReport: ${outFile}`);
