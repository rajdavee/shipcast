#!/usr/bin/env node
/**
 * Sample Pulse history for screenshots, demos and the showcase.
 *
 *   node tools/seed-pulse.ts --home <dir> [--days 90] [--force]
 *
 * Writes ~70 published posts over the last N days on LinkedIn and Instagram
 * (plus a few YouTube videos) into that SHIPCAST_HOME, every title starting
 * "Sample · ", with readings at 1, 3, 7 and 30 days generated from planted effects
 * plus noise, then fits the real playbook on them. Also a few upcoming drafts
 * (some experiments) so forecasts show. The numbers are made up — that's
 * what the "Sample" label says — so it refuses to touch ~/.shipcast unless
 * --force. Re-running replaces the earlier sample.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { addSnapshot, addNote, campaignDir, computePerformance, deleteNote, deletePost, deleteSnapshot, headline, listPosts, localParts, readNotes, saveGoals, siteDir, readPlan, readSnapshots, recordForecast, refreshPlaybook, runMetrics, savePlan, savePost, seededRng, zonedToUtc, type ChannelId, type MetricSource, type Post } from '@shipcast/engine';

export const SAMPLE_PREFIX = 'Sample · ';
const CAMPAIGN = 'sample-pulse';
const H = 3_600_000;

/** The real home is never seeded by accident. */
export function checkHome(dir: string, force = false): string {
  const abs = resolve(dir);
  if (abs === resolve(homedir(), '.shipcast') && !force) throw new Error(`Refusing to write sample data into your real Shipcast home (${abs}). Pass another --home, or --force if you really mean it.`);
  return abs;
}

// ── what wins (the planted truth the playbook should find) ────────────

type Kind = 'pdf-carousel' | 'image-carousel' | 'single-image' | 'text-only' | 'video-vertical' | 'video-landscape';
type Hook = 'question' | 'number' | 'how-to' | 'story' | 'contrarian' | 'announcement' | 'before-after';
const SLOTS = { morning: '08:30', midday: '12:15', afternoon: '15:00', evening: '18:30', night: '21:30' } as const;
type Slot = keyof typeof SLOTS;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

interface ChannelSpec {
  perWeek: number;
  kinds: [Kind, number][];
  kind: Partial<Record<Kind, number>>;
  day: Partial<Record<(typeof DOW)[number], number>>;
  dayWeights: number[];
  slot: Partial<Record<Slot, number>>;
  slotWeights: [Slot, number][];
  hook: Partial<Record<Hook, number>>;
  /** Typical reach at 7 days, and weighted engagement per person reached. */
  reach: number;
  rate: number;
}
const SPEC: Record<'linkedin' | 'instagram' | 'youtube', ChannelSpec> = {
  linkedin: {
    perWeek: 3.3,
    kinds: [['pdf-carousel', 3], ['text-only', 2.5], ['single-image', 2.5], ['image-carousel', 2]],
    kind: { 'pdf-carousel': 2.0, 'image-carousel': 1.1, 'single-image': 0.95, 'text-only': 0.6 },
    day: { Tue: 1.4, Sat: 0.62 },
    dayWeights: [3, 4, 3, 3, 2, 1.6, 0.6],
    slot: { morning: 1.3, night: 0.7 },
    slotWeights: [['morning', 4], ['midday', 3], ['afternoon', 2], ['evening', 1.5], ['night', 1.5]],
    hook: {},
    reach: 2300,
    rate: 0.045,
  },
  instagram: {
    perWeek: 2.4,
    kinds: [['image-carousel', 3], ['single-image', 3], ['video-vertical', 2.5]],
    kind: { 'image-carousel': 1.6, 'video-vertical': 1.05, 'single-image': 0.72 },
    day: { Sun: 1.25 },
    dayWeights: [2, 2, 2, 2, 2, 2, 2],
    slot: { evening: 1.2 },
    slotWeights: [['morning', 2], ['midday', 2], ['afternoon', 1], ['evening', 4], ['night', 1.5]],
    hook: { question: 1.5 },
    reach: 1500,
    rate: 0.06,
  },
  youtube: {
    perWeek: 0.35,
    kinds: [['video-landscape', 1]],
    kind: {},
    day: {},
    dayWeights: [1, 1, 1, 2, 1, 1, 1],
    slot: {},
    slotWeights: [['afternoon', 1]],
    hook: {},
    reach: 900,
    rate: 0.05,
  },
};

const TOPICS = [
  ['changelogs', 'a changelog people actually read'], ['onboarding', 'onboarding that gets to value in a minute'], ['pricing pages', 'a pricing page that answers the real question'],
  ['customer calls', 'customer calls that change the roadmap'], ['release notes', 'release notes as a growth channel'], ['free trials', 'free trials that convert'], ['demo videos', 'a 60-second product demo'],
  ['docs', 'docs as marketing'], ['cold email', 'cold email for developer tools'], ['launch week', 'a launch week on a small team'], ['empty states', 'empty states that teach'], ['feature flags', 'shipping behind feature flags'],
  ['public roadmaps', 'a public roadmap'], ['support tickets', 'reading support tickets for copy'], ['dashboards', 'dashboards nobody opens'], ['side projects', 'a side project that became the product'],
] as const;
const HOOK_LINE: Record<Hook, (t: string, long: string) => string> = {
  question: (t) => `Why do most ${t} get ignored?`,
  number: (t) => `5 things we changed about our ${t} this quarter`,
  'how-to': (_t, l) => `How to build ${l}`,
  story: (t) => `Last year we rewrote our ${t} from scratch.`,
  contrarian: (t) => `Stop treating ${t} as an afterthought.`,
  announcement: (t) => `Introducing a new way to handle ${t}.`,
  'before-after': (t) => `Before: ${t} took us a week. After: one afternoon.`,
};
const HOOKS = Object.keys(HOOK_LINE) as Hook[];
const BODY = [
  'We tried three versions and kept the one that answered a question people were already asking.',
  'The short version: write for the person who just signed up, not for the team that built it.',
  'Most of the work was deleting things.',
  'What surprised us was how much the first sentence mattered.',
  'Numbers below — and what we would do differently.',
  'It took longer than planned and was worth it.',
];
const CTA = ['What would you add?', 'Save this for your next launch.', 'Tell me in the comments what worked for you.', '', 'Link in the first comment.'];
const PILLARS = ['Teach', 'Show', 'Story', 'Ask'];
const FORMAT: Record<Kind, string | undefined> = { 'pdf-carousel': 'carousel', 'image-carousel': 'photo-carousel', 'single-image': 'social-post', 'text-only': undefined, 'video-vertical': 'reel', 'video-landscape': 'youtube-video' };

// ── tiny files so thumbnails and slide counts are real ────────────────

/** A small 4:5 PNG: a two-tone gradient with a few light "text" bars, so thumbnails look like slides. */
export function slidePng(hue: number, w = 120, h = 150): Buffer {
  const hsl = (l: number) => {
    const a = 0.55 * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const bar = x > 12 && ((y > 26 && y < 38 && x < w - 20) || (y > 44 && y < 54 && x < w - 44) || (y > 112 && y < 120 && x < 56));
      const [r, g, b] = bar ? [248, 248, 250] : hsl(0.28 + 0.22 * (y / h));
      raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A minimal PDF with n blank 4:5 pages (the playbook counts pages for slide-count effects). */
export function blankPdf(n: number): string {
  const kids = Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(' ');
  const pages = Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 540 675] >> endobj`).join('\n');
  return `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [${kids}] /Count ${n} >> endobj\n${pages}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
}

// ── the seeding ───────────────────────────────────────────────────────

interface Planned { post: Partial<Post>; ch: ChannelId; lift: number; sent: string; spec: ChannelSpec; step?: string }

export async function seedPulse(opts: { home: string; days?: number; now?: Date; seed?: number; log?: (s: string) => void }) {
  process.env.SHIPCAST_HOME = opts.home;
  const now = opts.now ?? new Date();
  const days = Math.max(14, Math.min(365, opts.days ?? 90));
  const rng = seededRng(opts.seed ?? 20261104);
  const log = opts.log ?? (() => {});
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const weighted = <T,>(xs: [T, number][]) => {
    let r = rng() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [x, w] of xs) if ((r -= w) <= 0) return x;
    return xs[xs.length - 1][0];
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  // Shuffled bags instead of independent draws: every option turns up in its share, so a small history isn't lopsided by luck.
  const bags = new Map<string, unknown[]>();
  const draw = <T,>(key: string, xs: [T, number][]): T => {
    let bag = bags.get(key) as T[] | undefined;
    if (!bag?.length) {
      bag = xs.flatMap(([x, w]) => Array.from({ length: Math.round(w * 2) }, () => x));
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      bags.set(key, bag);
    }
    return bag.pop()!;
  };

  // Replace an earlier sample rather than stacking a second one on it.
  const old = (await listPosts()).filter((p) => p.title.startsWith(SAMPLE_PREFIX));
  const oldIds = new Set(old.map((p) => p.id));
  for (const s of (await readSnapshots()).filter((x) => oldIds.has(x.post))) await deleteSnapshot(s.id);
  for (const p of old) await deletePost(p.id);
  await rm(campaignDir(CAMPAIGN), { recursive: true, force: true });

  const plan = await readPlan();
  const tz = plan.tz;
  await savePlan({ explore: plan.explore ?? 0.2, cadence: { ...plan.cadence, linkedin: plan.cadence.linkedin ?? { perWeek: 3, slots: ['Tue 09:00', 'Wed 12:00', 'Thu 09:00'] }, instagram: plan.cadence.instagram ?? { perWeek: 3, slots: ['Mon 18:00', 'Wed 18:00', 'Fri 18:00'] } } });

  const today = localParts(now.toISOString(), tz).date;
  const planned: Planned[] = [];
  let n = 0;
  for (let d = days; d >= 1; d--) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);
    const dow = DOW[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
    for (const ch of ['linkedin', 'instagram', 'youtube'] as const) {
      const spec = SPEC[ch];
      const wDay = spec.dayWeights[DOW.indexOf(dow)];
      const due = rng() <= (spec.perWeek * wDay) / spec.dayWeights.reduce((a, b) => a + b, 0);
      // Exactly five videos however the dice fall: enough to show, too few for a YouTube playbook (it needs six).
      if (ch === 'youtube' ? d % Math.floor(days / 5) !== 3 : !due) continue;
      const slot = draw(`${ch}:slot`, spec.slotWeights);
      const kind = draw(`${ch}:kind`, spec.kinds);
      const hook = draw(`${ch}:hook`, HOOKS.map((h) => [h, 1] as [Hook, number]));
      const [topic, long] = pick(TOPICS);
      const hhmm = SLOTS[slot].replace(/\d\d$/, (m) => String(Number(m) + Math.floor(rng() * 10)).padStart(2, '0'));
      const at = zonedToUtc(date, hhmm, tz);
      if (Date.parse(at) > now.getTime() - 6 * H) continue;
      const truth = (spec.kind[kind] ?? 1) * (spec.day[dow] ?? 1) * (spec.slot[slot] ?? 1) * (spec.hook[hook] ?? 1);
      const lift = truth * Math.exp(0.16 * gauss()) * (1 + 0.1 * (1 - d / days));
      const i = n++;
      const step = kind === 'text-only' ? undefined : `s${String(i).padStart(3, '0')}`;
      const media = await makeMedia(kind, step, i);
      const caption = [HOOK_LINE[hook](topic, long), '', ...BODY.filter(() => rng() < 0.45).slice(0, 1 + Math.floor(rng() * 4)), pick(CTA)].join('\n').trim();
      const tags = ch === 'linkedin' ? ['#buildinpublic', '#saas', '#productmarketing', '#devtools'].slice(0, Math.floor(rng() * 4)) : ['#startup', '#marketingtips', '#saas', '#founders', '#productdesign', '#buildinpublic', '#indiehackers', '#growth'].slice(0, 3 + Math.floor(rng() * 6));
      const title = ch === 'youtube' ? `${SAMPLE_PREFIX}Video: ${long}` : `${SAMPLE_PREFIX}${HOOK_LINE[hook](topic, long).replace(/[.?]$/, '')}`;
      planned.push({
        ch, lift, sent: at, spec, step,
        post: {
          title: title.slice(0, 120), status: 'published', at, tz, pillar: pick(PILLARS), format: FORMAT[kind], notes: 'Sample post seeded for demos — its numbers are made up.',
          ...(step ? { campaign: CAMPAIGN, step } : {}),
          channels: [{ channel: ch, caption, hashtags: tags, media, via: 'manual', state: 'sent', sentAt: at, url: `https://example.com/sample/${ch}/${i}`, ...(ch === 'youtube' ? { title: long[0].toUpperCase() + long.slice(1) } : {}) }],
        },
      });
    }
  }

  // The last few posts are scored as forecasts: the model is fitted without them first, as it would have been when they were scheduled.
  const holdout = new Set(planned.filter((p) => p.ch !== 'youtube' && Date.parse(p.sent) < now.getTime() - 8 * 24 * H).slice(-10));
  const posts = new Map<Planned, Post>();
  for (const p of planned) posts.set(p, await savePost(p.post));
  let snaps = 0;
  const readings = async (p: Planned, skipLatest = false) => {
    const post = posts.get(p)!;
    const due = [24, 72, 168, 720].filter((h) => Date.parse(p.sent) + (h + 2) * H <= now.getTime());
    const take = skipLatest ? due.slice(0, -1) : due;
    for (const h of take) {
      const grow = h === 24 ? 0.6 : h === 72 ? 0.86 : h === 168 ? 1 : 1.07;
      const reach = p.spec.reach * p.lift * grow * Math.exp(0.05 * gauss());
      const eng = reach * p.spec.rate * p.lift ** 0.25 * Math.exp(0.08 * gauss());
      const source: MetricSource = p.ch === 'youtube' ? 'youtube' : weighted([['manual', 6], ['csv', 2.5], ['screenshot', 1.5]] as [MetricSource, number][]);
      const r = (x: number) => Math.max(0, Math.round(x));
      const v = p.ch === 'linkedin'
        ? { impressions: r(reach * 1.7), reach: r(reach), likes: r(eng * 0.62), comments: r(eng * 0.07), shares: r(eng * 0.04), clicks: r(eng * 0.12) }
        : p.ch === 'instagram'
          ? { reach: r(reach), views: r(reach * 1.9), likes: r(eng * 0.58), comments: r(eng * 0.05), shares: r(eng * 0.05), saves: r(eng * 0.06) }
          : { views: r(reach), likes: r(eng * 0.7), comments: r(eng * 0.08), shares: r(eng * 0.03), follows: r(reach * 0.004), avgViewPct: Math.round(38 + 12 * Math.tanh(Math.log(p.lift))) };
      await addSnapshot({ ...v, post: post.id, channel: p.ch, source, at: new Date(Date.parse(p.sent) + h * H + Math.round(rng() * 3 * H)).toISOString() }, now);
      snaps++;
    }
  };
  // The newest manual posts keep their latest reading open, so "Numbers wanted" has something to ask for.
  const open = (p: Planned) => [24, 72, 168, 720].some((h) => now.getTime() - Date.parse(p.sent) >= (h + 2) * H && now.getTime() - Date.parse(p.sent) <= h * 1.4 * H);
  const recent = new Set(planned.filter((p) => p.ch !== 'youtube' && !holdout.has(p) && open(p)).slice(-3));
  for (const p of planned) if (!holdout.has(p)) await readings(p, recent.has(p));
  log(`${planned.length} published posts, ${snaps} readings so far`);

  const quiet = { narrative: false, ask: async () => '[]', now } as const;
  await refreshPlaybook(quiet);
  for (const p of holdout) await recordForecast(posts.get(p)!, new Date(Date.parse(p.sent) - 24 * H));
  for (const p of holdout) await readings(p);

  // Critic scores for the posts "made in Shipcast", loosely tracking how they did (a demo of the calibration panel).
  for (const p of planned.filter((x) => x.step)) {
    const s = () => Math.max(1, Math.min(5, Math.round((3.4 + 0.9 * Math.log(p.lift) + 0.55 * gauss()) * 10) / 10));
    await writeFile(join(campaignDir(CAMPAIGN), 'deliverables', p.step!, 'out', 'critic.json'), JSON.stringify({ sample: true, scores: { hook: s(), clarity: s(), design: s(), brand: s() } }, null, 1));
  }

  // Upcoming posts to forecast: one strong, one weak, and two marked experiments.
  const up: { ch: ChannelId; dIn: number; time: string; kind: Kind; hook: Hook; topic: number; status: 'draft' | 'scheduled'; experiment?: string }[] = [
    { ch: 'linkedin', dIn: 1, time: '08:45', kind: 'pdf-carousel', hook: 'how-to', topic: 0, status: 'scheduled' },
    { ch: 'instagram', dIn: 2, time: '18:30', kind: 'image-carousel', hook: 'question', topic: 6, status: 'scheduled' },
    { ch: 'linkedin', dIn: 3, time: '21:30', kind: 'text-only', hook: 'announcement', topic: 2, status: 'draft' },
    { ch: 'linkedin', dIn: 5, time: '12:15', kind: 'image-carousel', hook: 'contrarian', topic: 9, status: 'draft', experiment: 'Experiment: contrarian hooks — only 4 LinkedIn posts so far.' },
    { ch: 'instagram', dIn: 6, time: '12:00', kind: 'single-image', hook: 'story', topic: 3, status: 'draft' },
    { ch: 'instagram', dIn: 8, time: '18:00', kind: 'video-vertical', hook: 'number', topic: 11, status: 'draft', experiment: 'Experiment: the reel format — only 3 Instagram posts so far.' },
    { ch: 'linkedin', dIn: 9, time: '09:00', kind: 'pdf-carousel', hook: 'number', topic: 12, status: 'draft' },
  ];
  let upcoming = 0;
  for (const [k, u] of up.entries()) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + u.dIn * 86_400_000).toISOString().slice(0, 10);
    const [topic, long] = TOPICS[u.topic];
    const step = u.kind === 'text-only' ? undefined : `u${k}`;
    const p = await savePost({
      title: `${SAMPLE_PREFIX}${HOOK_LINE[u.hook](topic, long).replace(/[.?]$/, '')}`.slice(0, 120), status: u.status, at: zonedToUtc(date, u.time, tz), tz, pillar: PILLARS[k % 4], format: FORMAT[u.kind], notes: 'Sample post seeded for demos.',
      ...(u.experiment ? { experiment: u.experiment } : {}), ...(step ? { campaign: CAMPAIGN, step } : {}),
      channels: [{ channel: u.ch, caption: `${HOOK_LINE[u.hook](topic, long)}\n\n${BODY[k % BODY.length]}\n\n${CTA[k % CTA.length]}`.trim(), hashtags: u.ch === 'instagram' ? ['#saas', '#startup', '#marketingtips'] : ['#buildinpublic'], media: await makeMedia(u.kind, step, 500 + k), via: 'manual' }],
    });
    if (p.status === 'scheduled') await recordForecast(p, now);
    upcoming++;
  }

  const pb = await refreshPlaybook(quiet);
  // A metrics pass turns the open readings into "Numbers wanted" (no desktop notifications from a seeder).
  await runMetrics({ now: () => now, notify: async () => {}, log: () => {} });
  log(`playbook: ${pb.channels.map((c) => `${c.channel} ${c.ready ? `ready, top win ${c.wins[0]?.level ?? '—'}` : `${c.n} posts`}`).join(' · ')}`);
  const site = await seedReports(now, rng, gauss, tz);
  log(`reports: ${site} website days, goals and notes`);
  return { published: planned.length, upcoming, snapshots: snaps, playbook: pb };
}

/**
 * For reports: sample website days (visits with a weekly rhythm and slow growth, key events,
 * sources, search) with visits credited to the sample posts that did best, two goals and two notes.
 * The website settings say "Sample site"; there is no Google connection behind them.
 */
async function seedReports(now: Date, rng: () => number, gauss: () => number, tz: string): Promise<number> {
  const posts = (await listPosts()).filter((p) => p.title.startsWith(SAMPLE_PREFIX) && p.status === 'published');
  const perf = computePerformance(await readSnapshots());
  const days: Record<string, unknown>[] = [];
  const span = 120;
  for (let d = span; d >= 1; d--) {
    const date = new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const base = (420 + (span - d) * 1.6) * (dow === 0 || dow === 6 ? 0.55 : 1) * Math.exp(0.08 * gauss());
    const sessions = Math.round(base);
    const li = Math.round(sessions * (0.07 + 0.02 * rng())), ig = Math.round(sessions * (0.03 + 0.015 * rng())), google = Math.round(sessions * 0.46);
    const keyEvents = Math.round(sessions * (0.021 + 0.006 * rng()));
    const byCampaign: Record<string, { sessions: number; keyEvents: number; source: string }> = {};
    for (const p of posts) {
      const c = p.channels[0];
      const sent = Date.parse(c.sentAt ?? p.at ?? '');
      const age = (Date.parse(`${date}T12:00:00Z`) - sent) / 86_400_000;
      if (!(age >= 0 && age < 4) || c.channel === 'youtube') continue;
      const lift = headline(perf, p.id, c.channel)?.lift ?? 1;
      const v = Math.round((c.channel === 'linkedin' ? 14 : 6) * lift * Math.exp(-age) * Math.exp(0.2 * gauss()));
      if (v > 0) byCampaign[p.id] = { sessions: v, keyEvents: Math.round(v * 0.04 * lift), source: c.channel === 'linkedin' ? 'linkedin.com' : 'instagram.com' };
    }
    const clicks = Math.round(google * 0.9);
    days.push({ date, sessions, users: Math.round(sessions * 0.82), keyEvents, bySource: { google: { sessions: google, keyEvents: Math.round(keyEvents * 0.45) }, 'linkedin.com': { sessions: li, keyEvents: Math.round(keyEvents * 0.2) }, 'instagram.com': { sessions: ig, keyEvents: Math.round(keyEvents * 0.06) }, '(direct)': { sessions: sessions - google - li - ig, keyEvents: Math.round(keyEvents * 0.29) } }, byCampaign, search: { clicks, impressions: Math.round(clicks * (24 + 4 * rng())), position: Math.round((14 - (span - d) * 0.02 + gauss()) * 10) / 10 }, topQueries: [{ query: 'sample product name', clicks: Math.round(clicks * 0.3), impressions: Math.round(clicks * 2) }, { query: 'sample how to launch', clicks: Math.round(clicks * 0.08), impressions: Math.round(clicks * 6) }, { query: 'sample alternatives', clicks: Math.round(clicks * 0.05), impressions: Math.round(clicks * 4) }] });
  }
  await mkdir(siteDir(), { recursive: true });
  await writeFile(join(siteDir(), 'days.json'), JSON.stringify(days));
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(join(siteDir(), 'settings.json'), 'utf8'));
  } catch {}
  await writeFile(join(siteDir(), 'settings.json'), JSON.stringify({ domains: [], utm: true, ...settings, ga4Name: 'Sample site', lastSync: now.toISOString() }));
  await saveGoals([{ metric: 'posts', target: 14, per: 'month', label: 'Sample · Posts this month' }, { metric: 'keyEvents', target: 380, per: 'month', label: 'Sample · Signups from the site' }]);
  for (const n of await readNotes()) if (n.text.startsWith(SAMPLE_PREFIX)) await deleteNote(n.id);
  const day = (back: number) => localParts(new Date(now.getTime() - back * 86_400_000).toISOString(), tz).date;
  await addNote({ date: day(9), text: `${SAMPLE_PREFIX}New pricing page went live` });
  await addNote({ date: day(3), text: `${SAMPLE_PREFIX}Team at a conference, fewer posts` });
  return days.length;
}

async function makeMedia(kind: Kind, step: string | undefined, i: number): Promise<string[]> {
  if (!step) return [];
  const rel = `campaigns/${CAMPAIGN}/deliverables/${step}/out`;
  const dir = join(campaignDir(CAMPAIGN), 'deliverables', step, 'out');
  await mkdir(dir, { recursive: true });
  const hue = (i * 47) % 360;
  if (kind === 'pdf-carousel') {
    await writeFile(join(dir, 'carousel.pdf'), blankPdf(4 + (i % 7)));
    return [`${rel}/carousel.pdf`];
  }
  if (kind === 'video-vertical' || kind === 'video-landscape') return [`${rel}/${kind === 'video-vertical' ? 'reel-vertical' : 'video-16x9'}.mp4`];
  const count = kind === 'single-image' ? 1 : 4 + (i % 5);
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    await writeFile(join(dir, `slide-${k + 1}.png`), slidePng((hue + k * 9) % 360));
    out.push(`${rel}/slide-${k + 1}.png`);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const val = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const dir = val('--home');
  if (!dir) {
    console.error('usage: node tools/seed-pulse.ts --home <dir> [--days 90] [--force]');
    process.exit(64);
  }
  try {
    const home = checkHome(dir, args.includes('--force'));
    const r = await seedPulse({ home, days: Number(val('--days') ?? 90), log: (s) => console.log(s) });
    console.log(`Seeded SAMPLE history into ${home}: ${r.published} published posts, ${r.snapshots} readings, ${r.upcoming} upcoming posts.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
