import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { campaignDir } from './paths.ts';
import { listCampaigns } from './store.ts';

/**
 * Variety guard. Platforms (YouTube's "inauthentic content" policy) and
 * audiences both punish videos that look stamped from one template. Before a
 * new storyboard renders, compare its scene pattern with recent videos and,
 * if it's a near-copy, ask for a different opening and mix — once.
 */

type Board = { scenes?: { scene?: string; block?: string }[]; chapters?: { scenes: { scene?: string; block?: string }[] }[] };

export function scenePattern(sb: Board): string[] {
  const scenes = sb.chapters ? sb.chapters.flatMap((c) => c.scenes) : (sb.scenes ?? []);
  return scenes.map((s) => s.scene ?? `block:${s.block}`);
}

const bigrams = (p: string[]) => new Set(p.slice(1).map((s, i) => `${p[i]}>${s}`));

/** 0–1: how alike two scene patterns are (same opening counts double). */
export function patternSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;
  const sameOpen = a.slice(0, 3).join() === b.slice(0, 3).join() ? 0.25 : 0;
  return Math.min(1, inter / union + sameOpen);
}

/** Problems to hand back to the writer, or [] when the storyboard is fresh enough. */
export function varietyFeedback(current: string[], recent: { label: string; pattern: string[] }[], threshold = 0.6): string[] {
  const worst = recent.map((r) => ({ ...r, s: patternSimilarity(current, r.pattern) })).sort((x, y) => y.s - x.s)[0];
  if (!worst || worst.s < threshold) return [];
  return [
    `This storyboard's scene pattern is ${Math.round(worst.s * 100)}% the same as a recent video (${worst.label}: ${worst.pattern.slice(0, 6).join(' → ')}…). Repetitive templated videos get demonetised and ignored. Change the opening (a different first scene type and hook device) and vary the middle — different scene types, order and rhythm — while keeping the message.`,
  ];
}

/** Scene patterns of the most recent rendered storyboards across all campaigns. */
export async function recentPatterns(excludeStep: string, limit = 12): Promise<{ label: string; pattern: string[] }[]> {
  const out: { label: string; pattern: string[]; t: string }[] = [];
  for (const c of await listCampaigns()) {
    for (const s of c.steps) {
      if (s.id === excludeStep || s.status !== 'done' || !s.outputs.some((o) => o.endsWith('storyboard.json'))) continue;
      const f = join(campaignDir(c.id), 'deliverables', s.id, s.outputs.find((o) => o.endsWith('storyboard.json'))!);
      if (!existsSync(f)) continue;
      try {
        out.push({ label: `${c.name} · ${s.pack}`, pattern: scenePattern(JSON.parse(await readFile(f, 'utf8'))), t: s.endedAt ?? '' });
      } catch {}
    }
  }
  return out.sort((a, b) => b.t.localeCompare(a.t)).slice(0, limit);
}
