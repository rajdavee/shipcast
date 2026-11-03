import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { judge, previews } from './critic.ts';
import { saveEval } from './learn.ts';
import { defaultOptions, getPack } from './packs.ts';
import { campaignDir, home } from './paths.ts';
import { createCampaign, listCampaigns, newId, readCampaign, updateCampaign } from './store.ts';
import type { Campaign, Step } from './types.ts';

/**
 * The nightly quality check. A dedicated "Quality check" project (made from
 * your most recent product) re-makes two sample pieces per run, rotating
 * through the main formats; the next run scores them with the critic and
 * queues the next pair. Scores land in ~/.shipcast/evals marked golden, so
 * the Quality page can show each format's trend and a drop shows up the
 * morning after the change that caused it.
 */

export const GOLDEN_PACKS = ['carousel', 'social-post', 'presentation', 'document', 'ad-set', 'email', 'landing', 'reel', 'photo-carousel', 'quote-cards', 'profile-kit', 'case-study', 'newsletter', 'blog-article'];
export const GOLDEN_NAME = 'Quality check';
const MARK = '[shipcast:golden]';

interface GoldenState {
  campaignId?: string;
  next: number;
  pending: { stepId: string; pack: string }[];
}
const stateFile = () => join(home(), 'agents', 'golden.json');
async function readState(): Promise<GoldenState> {
  try {
    return { next: 0, pending: [], ...JSON.parse(await readFile(stateFile(), 'utf8')) };
  } catch {
    return { next: 0, pending: [] };
  }
}
async function saveState(s: GoldenState) {
  await mkdir(join(home(), 'agents'), { recursive: true });
  const tmp = `${stateFile()}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, stateFile());
}

export const isGolden = (c: Campaign) => c.notes?.includes(MARK);

/** Next formats in the rotation that are installed. */
export async function nextGoldenPacks(from: number, n: number): Promise<{ packs: string[]; next: number }> {
  const out: string[] = [];
  let i = from;
  for (let tries = 0; out.length < n && tries < GOLDEN_PACKS.length; tries++, i++) {
    const id = GOLDEN_PACKS[i % GOLDEN_PACKS.length];
    if (await getPack(id)) out.push(id);
  }
  return { packs: out, next: i % GOLDEN_PACKS.length };
}

async function stepFor(pack: string): Promise<Step> {
  const p = await getPack(pack);
  return { id: newId('d'), kind: 'pack', pack, options: p ? defaultOptions(p) : {}, status: 'queued', outputs: [], revisions: [] };
}

export interface GoldenOutcome {
  summary: string;
  claudeRuns: number;
  /** Come back sooner than the schedule (pieces still being made). */
  nextInMinutes?: number;
}

export async function runGolden(opts: { now?: Date; perRun?: number; judgeFn?: typeof judge } = {}): Promise<GoldenOutcome> {
  const now = opts.now ?? new Date();
  const perRun = opts.perRun ?? 2;
  const st = await readState();
  let c = st.campaignId ? await readCampaign(st.campaignId) : null;

  if (!c) {
    // Base it on the latest real product so the check measures what you actually make.
    const base = (await listCampaigns()).find((x) => !isGolden(x) && ['github', 'url', 'local'].includes(x.source.type) && x.steps.some((s) => s.kind === 'brief' && s.status === 'done'));
    if (!base) return { summary: 'Waiting for your first finished project to base the quality check on.', claudeRuns: 0 };
    const pick = await nextGoldenPacks(st.next, perRun);
    c = await createCampaign({
      name: GOLDEN_NAME,
      source: base.source,
      goal: base.goal,
      audience: base.audience,
      tone: base.tone,
      notes: `${MARK} Shipcast's own nightly check: a few sample pieces re-made and scored so quality changes show up. Safe to ignore.`,
      ...(base.toneId ? { toneId: base.toneId } : {}),
      steps: [{ id: 'brief', kind: 'brief', options: {}, status: 'queued', outputs: [], revisions: [] }, ...(await Promise.all(pick.packs.map(stepFor)))],
    });
    await saveState({ campaignId: c.id, next: pick.next, pending: c.steps.filter((s) => s.kind === 'pack').map((s) => ({ stepId: s.id, pack: s.pack! })) });
    return { summary: `Set up the quality-check project from ${base.name}; making ${pick.packs.join(' and ')}.`, claudeRuns: 1 + pick.packs.length, nextInMinutes: 30 };
  }

  const steps = st.pending.map((p) => ({ ...p, step: c!.steps.find((s) => s.id === p.stepId) }));
  if (steps.some((p) => p.step && ['queued', 'running', 'needs-input'].includes(p.step.status))) {
    const brief = c.steps.find((s) => s.kind === 'brief');
    return { summary: brief && brief.status !== 'done' ? 'Researching the quality-check project…' : `Still making ${steps.map((p) => p.pack).join(' and ')}…`, claudeRuns: 0, nextInMinutes: 20 };
  }

  // Score what finished, then queue the next pair.
  let claudeRuns = 0;
  const scored: string[] = [];
  const pieces = [];
  for (const p of steps) {
    if (p.step?.status !== 'done') {
      scored.push(`${p.pack} failed`);
      continue;
    }
    const v = await (opts.judgeFn ?? judge)(p.pack, p.step.options._title ?? p.pack, await previews(join(campaignDir(c.id), 'deliverables', p.stepId))).catch(() => null);
    claudeRuns++;
    if (!v) continue;
    const vals = Object.values(v.scores).map(Number).filter(Number.isFinite);
    const avg = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 0;
    pieces.push({ campaign: c.id, step: p.stepId, pack: p.pack, scores: v.scores as Record<string, number>, avg, fix: v.fix });
    scored.push(`${p.pack} ${avg}`);
  }
  if (pieces.length) await saveEval({ at: now.toISOString(), golden: true, pieces });

  const pick = await nextGoldenPacks(st.next, perRun);
  const fresh = await Promise.all(pick.packs.map(stepFor));
  // Keep the project small: drop the pieces just scored before adding the next ones.
  await updateCampaign(c.id, (x) => {
    x.steps = [...x.steps.filter((s) => s.kind === 'brief' || !st.pending.some((p) => p.stepId === s.id)), ...fresh];
  });
  await saveState({ campaignId: c.id, next: pick.next, pending: fresh.map((s) => ({ stepId: s.id, pack: s.pack! })) });
  return { summary: `${scored.join(' · ') || 'nothing scored'}; next: ${pick.packs.join(' and ')}`, claudeRuns: claudeRuns + fresh.length, nextInMinutes: 30 };
}
