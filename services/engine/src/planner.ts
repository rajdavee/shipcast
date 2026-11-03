import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { channel, CALENDAR_CHANNELS, listPosts, localParts, readPlan, savePost, zonedToUtc, type ChannelId, type ContentPlan, type Post } from './calendar.ts';
import { runClaude } from './claude.ts';
import { campaignDir, home } from './paths.ts';
import { getPack } from './packs.ts';
import { listCampaigns, readCampaign } from './store.ts';
import { readTrends } from './trends.ts';
import type { Campaign } from './types.ts';

/**
 * Plan my month: code lays out the posting slots from the cadence (so dates,
 * times and counts are exact), one Claude call fills each slot with an idea
 * balanced across the pillars, using the product brief, the brand voice and
 * what's trending. Every result is a draft the user approves.
 *
 * Make it: a post becomes a deliverable in its project; when the piece is
 * rendered its files attach to each channel automatically.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface Slot {
  i: number;
  channel: ChannelId;
  date: string;
  time: string;
  at: string;
}

/** Every slot the cadence asks for between two dates (local to the plan's zone), skipping ones already taken. */
export function planSlots(plan: ContentPlan, from: string, to: string, taken: Post[] = []): Slot[] {
  const out: Slot[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const busy = new Set(taken.filter((p) => p.at).flatMap((p) => p.channels.map((c) => `${c.channel}@${localParts(p.at!, plan.tz).date}`)));
  for (const [ch, cad] of Object.entries(plan.cadence) as [ChannelId, { perWeek: number; slots: string[] }][]) {
    if (!cad?.perWeek) continue;
    // Preferred slots first; if fewer slots than posts a week, spread the rest over weekdays at the first slot's time.
    const slots = cad.slots.length ? cad.slots : ['Tue 09:00'];
    const byDay = new Map(slots.map((s) => [s.slice(0, 3), s.slice(4)]));
    const extra = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].filter((d) => !byDay.has(d));
    while (byDay.size < Math.min(cad.perWeek, 7) && extra.length) byDay.set(extra.shift()!, slots[0].slice(4));
    const days = [...byDay.entries()].slice(0, cad.perWeek);
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const hit = days.find(([day]) => DAYS[d.getUTCDay()] === day);
      if (!hit || busy.has(`${ch}@${date}`)) continue;
      out.push({ i: 0, channel: ch, date, time: hit[1], at: zonedToUtc(date, hit[1], plan.tz) });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.channel.localeCompare(b.channel)).map((s, i) => ({ ...s, i }));
}

/** The project the plan is about: the given one, or the most recent finished product research. */
export async function planProject(id?: string): Promise<Campaign | null> {
  if (id) return readCampaign(id);
  return (await listCampaigns()).find((c) => !c.notes?.includes('[shipcast:golden]') && c.steps.some((s) => s.kind === 'brief' && s.status === 'done')) ?? null;
}

export async function planPrompt(slots: Slot[], plan: ContentPlan, project: Campaign | null): Promise<string> {
  const brief = project ? await readFile(join(campaignDir(project.id), 'brief', 'brief.md'), 'utf8').catch(() => '') : '';
  const trends = (await readTrends()).cards.filter((c) => !c.archived).slice(0, 10);
  const packs = new Set(CALENDAR_CHANNELS.flatMap((c) => c.formats));
  const known: string[] = [];
  for (const p of packs) if (await getPack(p)) known.push(p);
  return `You are the content strategist inside Shipcast. Fill a content calendar for ${project?.name ?? 'the user\'s product'}.

## Product brief
${brief.slice(0, 6000) || '(no brief yet — keep ideas general to the audience in the slots)'}

## Content pillars (aim for these shares across the month)
${plan.pillars.map((p) => `- ${p.name} — ${p.share}%${p.about ? `: ${p.about}` : ''}`).join('\n')}

## What's working right now (Trending; use where it fits, cite the key)
${trends.map((t) => `- [${t.key}] ${t.title} (${t.platform}, ${t.strength}) — ${t.recipe.hookPattern}`).join('\n') || '- none yet'}

## Slots to fill (one idea each)
${slots.map((s) => `${s.i}. ${channel(s.channel)!.name} — ${DAYS[new Date(`${s.date}T12:00:00Z`).getUTCDay()]} ${s.date} ${s.time}`).join('\n')}

## Formats per channel (pick one for each slot; best first)
${CALENDAR_CHANNELS.filter((c) => slots.some((s) => s.channel === c.id)).map((c) => `- ${c.name}: ${c.formats.filter((f) => known.includes(f)).join(', ')}`).join('\n')}

Rules: every idea is specific to this product and audience (no generic tips); no two slots on the same day say the same thing — when one idea runs on two channels, adapt it to each; vary formats and hooks across the month; facts only from the brief; captions follow the channel's culture (LinkedIn: a hook line under 200 characters, short paragraphs; Instagram: first line hooks before "more", 3–5 hashtags at the end); never invent customers, numbers or quotes.

Reply with JSON only: [{"slot": <number>, "title": "≤ 70 chars", "pillar": "<pillar name>", "format": "<format id>", "hook": "the first line", "caption": "the full caption for that channel", "hashtags": ["#tag"], "notes": "what to show / how to make it", "trend": "<trend key or empty>"}]`;
}

const ROLE = 'You are the content strategist inside Shipcast, a local marketing studio. Do not use tools. Reply with JSON only.';

async function ask(prompt: string, timeoutMs = 420_000): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'shipcast-plan-'));
  try {
    let text = '';
    const run = runClaude({ prompt, cwd, allowedTools: [], model: 'sonnet', appendSystemPrompt: ROLE, extraArgs: ['--max-turns', '2', '--disallowedTools', 'WebFetch,WebSearch,Bash,Read,Write,Edit,Task', '--setting-sources', 'project', '--strict-mcp-config'], onEvent: (e) => { if (e.kind === 'result' && e.text) text = e.text; else if (e.kind === 'text') text = text || e.text; } });
    const timer = setTimeout(run.kill, timeoutMs);
    const r = await run.done;
    clearTimeout(timer);
    return r.result?.text || text;
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fill a date range with drafts. Returns the created posts and how many slots got nothing usable. */
export async function planMonth(opts: { from: string; to: string; project?: string; ask?: (p: string) => Promise<string> }): Promise<{ created: Post[]; skipped: number; slots: number }> {
  const plan = await readPlan();
  const existing = await listPosts({ from: zonedToUtc(opts.from, '00:00', plan.tz), to: zonedToUtc(opts.to, '00:00', plan.tz) });
  const slots = planSlots(plan, opts.from, opts.to, existing);
  if (!slots.length) return { created: [], skipped: 0, slots: 0 };
  if (slots.length > 60) throw new Error(`${slots.length} slots is too many for one plan — plan up to a month at a time.`);
  const project = await planProject(opts.project);
  const text = await (opts.ask ?? ask)(await planPrompt(slots, plan, project));
  const m = text.match(/\[[\s\S]*\]/);
  let items: any[] = [];
  try {
    items = m ? JSON.parse(m[0]) : [];
  } catch {}
  const created: Post[] = [];
  const seen = new Set<number>();
  for (const it of items) {
    const s = slots[Number(it?.slot)];
    if (!s || seen.has(s.i) || typeof it.title !== 'string') continue;
    seen.add(s.i);
    const info = channel(s.channel)!;
    const fmt = info.formats.includes(it.format) ? it.format : info.formats[0];
    created.push(
      await savePost({
        title: it.title,
        status: 'draft',
        at: s.at,
        tz: plan.tz,
        pillar: plan.pillars.some((p) => p.name === it.pillar) ? it.pillar : undefined,
        format: fmt,
        ...(project ? { campaign: project.id } : {}),
        ...(typeof it.trend === 'string' && it.trend ? { trend: it.trend } : {}),
        notes: [it.hook && `Hook: ${it.hook}`, it.notes].filter(Boolean).join('\n'),
        channels: [{ channel: s.channel, caption: String(it.caption ?? it.hook ?? ''), hashtags: Array.isArray(it.hashtags) ? it.hashtags.slice(0, info.hashtagsMax) : [], media: [], via: 'manual' }],
      }),
    );
  }
  return { created, skipped: slots.length - created.length, slots: slots.length };
}

// ── make it: post ↔ deliverable ────────────────────────────────────────

/** Media in a finished deliverable that suits a channel, as paths relative to the Shipcast home. */
export async function mediaFor(stepDir: string, ch: ChannelId): Promise<string[]> {
  const out = join(stepDir, 'out');
  if (!existsSync(out)) return [];
  const files: string[] = [];
  const walk = async (d: string, depth: number) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (['work', 'project', 'variants', '.gen-work'].includes(e.name)) continue;
      const f = join(d, e.name);
      if (e.isDirectory() && depth < 2) await walk(f, depth + 1);
      else if (/\.(png|jpe?g|mp4|pdf|gif)$/i.test(e.name) && !/sheet|brand-score|\.full\.|-desktop|-mobile/.test(e.name)) files.push(f);
    }
  };
  await walk(out, 0);
  files.sort();
  const of = (re: RegExp) => files.filter((f) => re.test(f));
  const video = of(/\.mp4$/i).filter((f) => !/carousel\.mp4$/.test(f));
  const vertical = video.find((f) => /tiktok|vertical|reel|9x16|story/i.test(f)) ?? video[0];
  const images = of(/\.(png|jpe?g)$/i).filter((f) => !/poster|thumb|video\.jpg$/.test(f));
  const pdf = of(/\.pdf$/i)[0];
  const portrait = images.filter((f) => /portrait|instagram|4x5|feed|slides\//.test(f));
  const pick: Record<ChannelId, () => string[]> = {
    linkedin: () => (pdf ? [pdf] : images.length ? images.slice(0, 20) : video.slice(0, 1)),
    instagram: () => (portrait.length ? portrait : images).slice(0, 10).concat(images.length ? [] : vertical ? [vertical] : []),
    youtube: () => [video.find((f) => !/square|vertical|tiktok/i.test(f)) ?? video[0]].filter(Boolean),
    x: () => (images.length ? images.slice(0, 4) : video.slice(0, 1)),
    tiktok: () => (vertical ? [vertical] : of(/tiktok/i).slice(0, 35)),
    threads: () => images.slice(0, 20),
    facebook: () => (images.length ? images.slice(0, 10) : video.slice(0, 1)),
    pinterest: () => of(/pins?\//i).slice(0, 1).concat(of(/pins?\//i).length ? [] : images.slice(0, 1)),
    newsletter: () => [],
    blog: () => images.filter((f) => /hero/.test(f)).slice(0, 1),
  };
  return (pick[ch]?.() ?? []).map((f) => relative(home(), f));
}

/** Attach rendered files to posts whose deliverable has finished; returns how many posts changed. */
export async function syncMadePosts(): Promise<number> {
  let changed = 0;
  for (const p of await listPosts()) {
    if (!p.campaign || !p.step || p.status === 'published') continue;
    const c = await readCampaign(p.campaign);
    const s = c?.steps.find((x) => x.id === p.step);
    if (!s || s.status !== 'done') continue;
    const dir = join(campaignDir(p.campaign), 'deliverables', p.step);
    const done = await stat(join(dir, 'out')).catch(() => null);
    if (!done) continue;
    let touched = false;
    const channels = [];
    for (const ch of p.channels) {
      if (ch.media.length) {
        channels.push(ch);
        continue;
      }
      const media = await mediaFor(dir, ch.channel);
      if (media.length) touched = true;
      channels.push({ ...ch, media });
    }
    if (touched) {
      await savePost({ id: p.id, channels, status: p.status === 'draft' ? 'ready' : p.status });
      changed++;
    }
  }
  return changed;
}
