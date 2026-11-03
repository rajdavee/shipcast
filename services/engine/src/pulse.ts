import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CALENDAR_CHANNELS, channel, getPost, listPosts, readPlan, savePost, type ChannelId, type Post } from './calendar.ts';
import { computePerformance, headline, readSnapshots } from './metrics.ts';
import { campaignDir } from './paths.ts';
import { formatMedia, spearman, type Playbook } from './playbook.ts';
import type { TrendCard } from './trends.ts';

/**
 * Pulse feeds back: the learned playbook turns into suggested posting slots,
 * a "fits you" score on trend cards, follow-ups to winners, and a check on
 * whether the critic's taste predicts what the audience actually rewards.
 */

/** A representative clock time for each hour bucket the playbook uses. */
const BUCKET_TIME: Record<string, string> = { morning: '09:00', midday: '12:00', afternoon: '15:00', evening: '18:00', night: '21:00' };
const DAY: Record<string, string> = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun' };

/** Best-performing weekday × time cells as cadence slots ("Tue 09:00"), per channel with enough data. */
export function suggestedSlots(pb: Playbook | null): Partial<Record<ChannelId, { slots: string[]; why: string[] }>> {
  const out: Partial<Record<ChannelId, { slots: string[]; why: string[] }>> = {};
  for (const c of pb?.channels ?? []) {
    const cells = c.bestSlots.filter((x) => x.lift > 1.05 && DAY[x.weekday] && BUCKET_TIME[x.hour]);
    if (!cells.length) continue;
    out[c.channel] = { slots: cells.map((x) => `${DAY[x.weekday]} ${BUCKET_TIME[x.hour]}`), why: cells.map((x) => `${x.weekday} ${x.hour}: ${x.lift}× your usual over ${x.n} posts`) };
  }
  return out;
}

/** How well a trend's recipe matches what wins for you: the learned effect of its format (or its media) on the trend's channel. */
export function trendFit(card: Pick<TrendCard, 'platform' | 'recipe'>, pb: Playbook | null): { fit: number; why: string } | null {
  const ch = (CALENDAR_CHANNELS.find((c) => c.id === card.platform)?.id ?? 'linkedin') as ChannelId;
  const cp = pb?.channels.find((c) => c.channel === ch && c.ready && c.model);
  if (!cp?.model) return null;
  const pick = (feature: string, level?: string) => (level ? cp.model!.effects.find((e) => e.feature === feature && e.level === level && e.n >= 3) : undefined);
  const e = pick('format', card.recipe.pack) ?? pick('mediaKind', formatMedia(card.recipe.pack, ch));
  if (!e) return null;
  return { fit: Math.round(e.effect * 100) / 100, why: `${e.feature === 'format' ? card.recipe.pack : formatMedia(card.recipe.pack, ch)} posts do ${e.effect.toFixed(1)}× your usual on ${channel(ch)!.name} (${e.n} posts)` };
}

/** Rank trend cards for this brand: cards whose recipe you win with first, keeping the radar's order otherwise. */
export function rankForYou<T extends TrendCard>(cards: T[], pb: Playbook | null): (T & { fit?: number; fitWhy?: string })[] {
  return cards
    .map((c, i) => ({ c, i, f: trendFit(c, pb) }))
    .sort((a, b) => (b.f?.fit ?? 1) - (a.f?.fit ?? 1) || a.i - b.i)
    .map(({ c, f }) => ({ ...c, ...(f ? { fit: f.fit, fitWhy: f.why } : {}) }));
}

/** A follow-up idea to a post that did well: same format, pillar and hook pattern, new angle. */
export async function moreLikeThis(id: string): Promise<Post> {
  const p = await getPost(id);
  if (!p) throw new Error('post not found');
  const perf = computePerformance(await readSnapshots());
  const best = p.channels.map((c) => ({ c, h: headline(perf, p.id, c.channel) })).sort((a, b) => (b.h?.lift ?? 0) - (a.h?.lift ?? 0))[0];
  const hook = best?.c.caption.split('\n').find((l) => l.trim()) ?? '';
  return savePost({
    title: `Follow-up: ${p.title}`.slice(0, 120),
    status: 'idea',
    format: p.format,
    pillar: p.pillar,
    notes: [`A follow-up to "${p.title}"${best?.h?.lift ? `, which did ${best.h.lift}× your usual on ${channel(best.c.channel)!.name}` : ''}.`, 'Keep what worked — the format, the pillar and the shape of the hook — and take a new angle: the next question its readers would ask, a deeper example, or the counter-case.', hook && `Its hook: "${hook.slice(0, 200)}"`].filter(Boolean).join('\n'),
    channels: (best ? [best.c] : p.channels).map((c) => ({ channel: c.channel, caption: '', hashtags: c.hashtags, media: [], via: c.via })),
  });
}

/** One idea per other channel that remixes a post for that channel's best format. */
export async function remix(id: string, to?: ChannelId[]): Promise<Post[]> {
  const p = await getPost(id);
  if (!p) throw new Error('post not found');
  const plan = await readPlan();
  const have = new Set(p.channels.map((c) => c.channel));
  const targets = (to?.length ? to : (Object.keys(plan.cadence) as ChannelId[])).filter((c) => !have.has(c) && channel(c));
  const out: Post[] = [];
  for (const ch of targets) {
    const info = channel(ch)!;
    out.push(
      await savePost({
        title: `${p.title} — for ${info.name}`.slice(0, 120),
        status: 'idea',
        format: info.formats[0],
        pillar: p.pillar,
        notes: `Remix of "${p.title}" for ${info.name}: same idea, rebuilt as ${info.media.split(',')[0]} in the way ${info.name} reads — not a copy-paste.\n\nOriginal caption:\n${p.channels[0]?.caption.slice(0, 600) ?? ''}`,
        channels: [{ channel: ch, caption: '', hashtags: [], media: [], via: 'manual' }],
      }),
    );
  }
  return out;
}

/** Does the critic's score before posting predict lift after? (rank correlation over posts made by Shipcast that have numbers) */
export async function criticCalibration(): Promise<{ n: number; rank: number | null; rows: { post: string; critic: number; lift: number }[] }> {
  const perf = computePerformance(await readSnapshots());
  const rows: { post: string; critic: number; lift: number }[] = [];
  for (const p of await listPosts()) {
    if (!p.campaign || !p.step) continue;
    const f = join(campaignDir(p.campaign), 'deliverables', p.step, 'out', 'critic.json');
    if (!existsSync(f)) continue;
    const lift = Math.max(0, ...p.channels.map((c) => headline(perf, p.id, c.channel)?.lift ?? 0));
    if (!lift) continue;
    try {
      const v = JSON.parse(await readFile(f, 'utf8')) as { scores: Record<string, number> };
      const xs = Object.values(v.scores ?? {}).map(Number).filter(Number.isFinite);
      if (xs.length) rows.push({ post: p.id, critic: xs.reduce((a, b) => a + b, 0) / xs.length, lift });
    } catch {}
  }
  return { n: rows.length, rank: rows.length >= 5 ? spearman(rows.map((r) => r.critic), rows.map((r) => r.lift)) : null, rows };
}

