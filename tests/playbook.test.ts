import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'playbook-'));
const e = await import('@shipcast/engine');
const { featuresOf, mediaKind, hookByRules, ctaOf, labelHooks, fitChannel, buildPlaybook, channelPlaybook, forecastFeatures, forecastPost, chooseForSlot, seededRng, validateNarrative, playbookNarrative, scoreForecasts, spearman, refreshPlaybook, readPlaybook, recordForecast, readForecasts, publicPlaybook } = e;
type Post = import('@shipcast/engine').Post;
type TrainingRow = import('@shipcast/engine').TrainingRow;

// 2026-09-07 is a Monday; slot hours are UTC and the posts are planned in UTC.
const dateFor = (weekday: number, week: number) => new Date(Date.UTC(2026, 8, 7 + ((weekday + 6) % 7) + 7 * week)).toISOString().slice(0, 10);
const HOURS: Record<string, number> = { morning: 9, midday: 12, afternoon: 15, evening: 19, night: 23 };
const MEDIA: Record<string, (rng: () => number) => string[]> = {
  'pdf-carousel': () => ['campaigns/c1/out/carousel.pdf'],
  'image-carousel': (r) => Array.from({ length: 2 + Math.floor(r() * 6) }, (_, i) => `campaigns/c1/out/slides/slide-0${i + 1}.png`),
  'single-image': () => ['campaigns/c1/out/post.png'],
  'video-vertical': () => ['campaigns/c1/out/reel-vertical.mp4'],
  'video-landscape': () => ['campaigns/c1/out/video.mp4'],
  'text-only': () => [],
};
const HOOKS = ['Why do most launch posts flop?', '5 things I learned shipping a launch video', 'How to write a README people finish', 'Stop writing long changelogs.', 'Last year we almost shut down when our API broke.', 'Introducing the new export panel'];
const pickOf = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

function post(i: number, o: { kind: string; weekday: number; hour: string; format?: string; hook?: string; r?: () => number }): Post {
  const r = o.r ?? seededRng(i);
  const date = dateFor(o.weekday, i % 8);
  const at = `${date}T${String(HOURS[o.hour]).padStart(2, '0')}:00:00.000Z`;
  return {
    id: `p${i}`, title: `post ${i}`, status: 'published', at, tz: 'UTC', format: o.format ?? 'social-post', pillar: pickOf(r, ['Teach', 'Show', 'Story', 'Ask']), notes: '', createdAt: at, updatedAt: at,
    ...(r() < 0.3 ? { trend: 't1' } : {}),
    channels: [{ channel: 'linkedin', caption: `${o.hook ?? pickOf(r, HOOKS)}\n\n${'Body line. '.repeat(1 + Math.floor(r() * 60))}${r() < 0.5 ? '\nWhat would you add?' : ''}`, hashtags: Array.from({ length: Math.floor(r() * 6) }, (_, k) => `#t${k}`), media: MEDIA[o.kind](r), via: 'manual', ...(r() < 0.5 ? { firstComment: 'Full guide: https://example.com/guide' } : {}) }],
  };
}

/** ~60 LinkedIn posts with features at random and planted effects: PDF carousel +0.7, text-only −0.4, Tuesday morning +0.3 (log-lift). */
function synthetic(n = 60, seed = 42): { posts: Post[]; rows: TrainingRow[] } {
  const r = seededRng(seed);
  const posts: Post[] = [];
  const rows: TrainingRow[] = [];
  for (let i = 0; i < n; i++) {
    const kind = pickOf(r, Object.keys(MEDIA));
    const weekday = 1 + Math.floor(r() * 5);
    const hour = pickOf(r, Object.keys(HOURS));
    const p = post(i, { kind, weekday, hour, format: pickOf(r, ['carousel', 'social-post', 'quote-cards', 'reel', 'case-study']), r });
    const noise = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()) * 0.25;
    const lift = Math.exp(0.7 * +(kind === 'pdf-carousel') - 0.4 * +(kind === 'text-only') + 0.3 * +(weekday === 2 && hour === 'morning') + noise);
    posts.push(p);
    rows.push({ post: p.id, channel: 'linkedin', features: featuresOf(p, 'linkedin', { slides: kind === 'pdf-carousel' ? 8 : undefined })!, lift });
  }
  return { posts, rows };
}

test('features: media kind from files and channel, time in the plan zone, copy buckets', () => {
  assert.equal(mediaKind({ channel: 'linkedin', media: ['a/deck.pdf'] }), 'pdf-carousel');
  assert.equal(mediaKind({ channel: 'linkedin', media: ['a/1.png', 'a/2.png'] }), 'image-carousel');
  assert.equal(mediaKind({ channel: 'linkedin', media: ['a/1.jpg'] }), 'single-image');
  assert.equal(mediaKind({ channel: 'youtube', media: ['a/video.mp4'] }), 'video-landscape');
  assert.equal(mediaKind({ channel: 'instagram', media: ['a/video.mp4'] }), 'video-vertical', 'the channel decides when the path does not');
  assert.equal(mediaKind({ channel: 'youtube', media: ['a/shorts/clip.mp4'] }), 'video-vertical');
  assert.equal(mediaKind({ channel: 'x', media: [] }), 'text-only');
  const p = post(1, { kind: 'image-carousel', weekday: 2, hour: 'morning', hook: 'Why do most launch posts flop?' });
  p.tz = 'Asia/Kolkata';
  p.at = '2026-09-08T03:30:00.000Z'; // 09:00 Tuesday in Kolkata, 03:30 UTC
  p.channels[0] = { ...p.channels[0], caption: 'Why do most launch posts flop? 🚀🔥\n\nHere is the fix. Comment "guide" and I will send it.', hashtags: ['#a', '#b'], firstComment: 'https://x.dev/guide', media: ['s/1.png', 's/2.png', 's/3.png'] };
  const f = featuresOf(p, 'linkedin')!;
  assert.deepEqual({ weekday: f.weekday, hour: f.hour, kind: f.mediaKind, slides: f.slides, cap: f.captionLen, tags: f.hashtags, fc: f.firstComment, emoji: f.emoji, cta: f.cta, hook: f.hook, link: f.linkInCaption }, { weekday: 'Tue', hour: 'morning', kind: 'image-carousel', slides: '2-5', cap: 'short', tags: '1-3', fc: 'link', emoji: '1-2', cta: 'comment-prompt', hook: 'question', link: 'no' });
  assert.equal(featuresOf(p, 'instagram'), null);
  assert.equal(ctaOf('Save this for your next launch.'), 'save-share');
  assert.equal(ctaOf('Try it free at shipcast.dev'), 'link');
  assert.equal(ctaOf('Body.\n\nWhich one would you pick?'), 'question');
  assert.equal(ctaOf('Just a thought.'), 'none');
});

test('hook rules place the common openings', () => {
  const cases: [string, string | null][] = [
    ['Why do most launch posts flop?', 'question'],
    ['5 things I learned shipping a launch video', 'number'],
    ['Seven mistakes founders make with pricing', 'number'],
    ['How to write a README people finish', 'how-to'],
    ["Here's how we cut onboarding to 3 minutes", 'how-to'],
    ['Stop writing long changelogs.', 'contrarian'],
    ["Cold email isn't dead — your list is wrong.", 'contrarian'],
    ['Last year we almost shut down.', 'story'],
    ['I quit my job when the second customer paid.', 'story'],
    ['Before: 3 hours of editing. After: 10 minutes.', 'before-after'],
    ['Introducing the new export panel', 'announcement'],
    ['We just shipped dark mode.', 'announcement'],
    ['"Ship it ugly" — our CTO', 'quote'],
    ['Pricing pages lie.', null],
  ];
  for (const [line, want] of cases) assert.equal(hookByRules(line), want, line);
});

test('hooks the rules miss get one batched call, and the labels are cached by line', async () => {
  const prompts: string[] = [];
  const ask = async (p: string) => (prompts.push(p), 'Sure: [{"i": 1, "type": "bold-claim"}, {"i": 2, "type": "nonsense"}]');
  const a = await labelHooks(['Pricing pages lie.', 'The quiet part of launch week', 'Why does nobody read docs?'], ask);
  assert.equal(prompts.length, 1);
  assert.ok(!prompts[0].includes('nobody read docs'), 'rule-placed lines are not sent');
  assert.equal(a.get('Pricing pages lie.'), 'bold-claim');
  assert.equal(a.get('The quiet part of launch week'), 'other', 'an invalid label falls back');
  assert.equal(a.get('Why does nobody read docs?'), 'question');
  const b = await labelHooks(['Pricing pages lie.'], async () => assert.fail('cached lines need no call'));
  assert.equal(b.get('Pricing pages lie.'), 'bold-claim');
});

test('ridge recovers planted effects from synthetic history, deterministically', () => {
  const { rows } = synthetic();
  const m = fitChannel(rows)!;
  const eff = (f: string, lv: string) => m.effects.find((x) => x.feature === f && x.level === lv)!;
  const pdf = eff('mediaKind', 'pdf-carousel');
  assert.ok(pdf.effect >= 1.6 && pdf.effect <= 2.6, `PDF carousel ${pdf.effect}`);
  assert.ok(pdf.lo > 1 && pdf.lo <= pdf.effect && pdf.hi >= pdf.effect, 'band brackets the effect and clears 1');
  assert.equal(pdf.posts.length, pdf.n);
  assert.ok(eff('mediaKind', 'text-only').effect < 1, 'text-only loses');
  assert.ok(m.effects.filter((x) => x.feature === 'slides').every((x) => Math.abs(Math.log(x.effect)) < 0.1), 'slide count refines carousels without taking the PDF effect');
  assert.deepEqual(fitChannel(rows), m, 'same posts, same model');
  assert.equal(fitChannel(rows.slice(0, 5)), null, 'too few posts');
});

test('playbook: PDF carousel is the top win with high confidence, heat-map cells, not-enough-data state', () => {
  const { rows } = synthetic();
  const pb = buildPlaybook(rows, new Date('2026-11-01T00:00:00Z'));
  const li = pb.channels.find((c) => c.channel === 'linkedin')!;
  assert.ok(li.ready);
  assert.equal(li.wins[0].level, 'pdf-carousel');
  assert.equal(li.wins[0].confidence, 'high');
  assert.match(li.wins[0].label, /^LinkedIn · PDF carousel: \d(\.\d)?× your usual \(\d+ posts, high confidence\)$/);
  assert.ok(li.losses.some((f) => f.level === 'text-only'));
  assert.ok(li.wins.length <= 5 && li.losses.length <= 5 && [...li.wins, ...li.losses].every((f) => f.n >= 3));
  assert.equal(li.heat.reduce((s, c) => s + c.n, 0), rows.length);
  assert.ok(li.bestSlots.every((c) => c.n >= 2));
  const thin = channelPlaybook('instagram', rows.slice(0, 4).map((r) => ({ ...r, channel: 'instagram' as const })));
  assert.equal(thin.ready, false);
  assert.match(thin.message!, /Not enough data yet — 4 of 6/);
  assert.equal(publicPlaybook(pb).channels[0].model!.boot.length, 0, 'the API copy drops the bootstrap draws');
});

test('forecast: a PDF carousel on Tuesday morning beats text-only on Saturday night', () => {
  const { rows } = synthetic();
  const m = fitChannel(rows)!;
  const good = forecastFeatures(m, featuresOf(post(900, { kind: 'pdf-carousel', weekday: 2, hour: 'morning', hook: 'How to write a README people finish' }), 'linkedin')!);
  const bad = forecastFeatures(m, featuresOf(post(901, { kind: 'text-only', weekday: 6, hour: 'night', hook: 'How to write a README people finish' }), 'linkedin')!);
  assert.ok(good.lift > bad.lift * 1.5, `${good.lift} vs ${bad.lift}`);
  assert.ok(good.lo < good.lift && good.lift < good.hi);
  assert.match(good.label, /^likely \d+\.\d–\d+\.\d× your usual$/);
  assert.ok(bad.unseen.includes('weekday'), 'Saturday was never posted on');
});

test('forecast scoring: band coverage and rank correlation', () => {
  const fs = [
    { post: 'a', channel: 'linkedin' as const, at: '', lift: 1, lo: 0.5, hi: 1.5 },
    { post: 'b', channel: 'linkedin' as const, at: '', lift: 2, lo: 1.5, hi: 3 },
    { post: 'c', channel: 'linkedin' as const, at: '', lift: 0.8, lo: 0.6, hi: 1.2 },
    { post: 'd', channel: 'linkedin' as const, at: '', lift: 1.5, lo: 1, hi: 2 },
    { post: 'e', channel: 'linkedin' as const, at: '', lift: 1.1, lo: 0.7, hi: 1.6 },
  ];
  const actual: Record<string, number> = { a: 1.2, b: 3.5, c: 0.7, d: 1.6 };
  const s = scoreForecasts(fs, (p) => actual[p]);
  assert.equal(s.n, 4, 'no numbers yet → not scored');
  assert.equal(s.inside, 0.75);
  assert.equal(s.rank, 1);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 2], [1, 2]), null);
  assert.equal(spearman([1, 1, 2, 3], [1, 2, 3, 4]), 0.949, 'ties share a rank');
});

test('Thompson sampling: exploits the winner, explores about as often as asked, and says why', async () => {
  const { rows } = synthetic();
  const model = fitChannel(rows)!;
  const formats = ['carousel', 'social-post', 'reel', 'newsletter'];
  const run = async (explore: number, hookTypes: string[], n = 500) => {
    const rng = seededRng(3);
    const out = [];
    for (let i = 0; i < n; i++) out.push(await chooseForSlot({ channel: 'linkedin', candidates: { formats, hookTypes }, explore, rng, model }));
    return out;
  };
  const greedy = await run(0, ['question']);
  assert.ok(greedy.filter((c) => c.format === 'carousel').length / greedy.length > 0.8, 'PDF carousel most of the time');
  assert.ok(greedy.every((c) => !c.experiment));
  const mixed = await run(0.2, ['question']);
  const other = mixed.filter((c) => c.format !== 'carousel').length / mixed.length;
  assert.ok(other > 0.14 && other < 0.3, `something else ${other}`);
  const exp = mixed.filter((c) => c.experiment);
  assert.ok(exp.length / mixed.length > 0.14 && exp.length / mixed.length < 0.26);
  assert.ok(exp.filter((c) => c.format === 'newsletter').length > exp.length * 0.9, 'the never-tried format is the one tested');
  assert.ok(exp.every((c) => /^Experiment: the \S+ format — (only \d+ LinkedIn posts? so far|never tried on LinkedIn yet)\.$/.test(c.reason!)));
  const both = await run(0.2, ['question', 'number', 'contrarian', 'curiosity'], 300);
  assert.ok(both.some((c) => c.experiment && c.hookType === 'curiosity' && /never tried/.test(c.reason!)), 'an untried hook gets tested');
  const a = await chooseForSlot({ channel: 'linkedin', candidates: { formats, hookTypes: ['question'] }, explore: 0.2, rng: seededRng(9), model });
  const b = await chooseForSlot({ channel: 'linkedin', candidates: { formats, hookTypes: ['question'] }, explore: 0.2, rng: seededRng(9), model });
  assert.deepEqual(a, b, 'seeded → repeatable');
  const cold = await chooseForSlot({ channel: 'tiktok', candidates: { formats: ['reel'] }, explore: 0, rng: seededRng(1), model: null });
  assert.deepEqual(cold, { format: 'reel', experiment: false });
});

test('narrative: sentences with numbers not in the input are dropped', async () => {
  const input = 'LinkedIn · PDF carousel: 2.1× your usual (9 posts, high confidence)\nslot Tuesdays Mornings (5–11): 1.4× your usual (3 posts)';
  assert.deepEqual(validateNarrative(['PDF carousels run at 2.1× your usual across 9 posts.', 'They earn 35% more saves.', 'Keep Tuesday mornings (5–11) for them.', 'Post 3 a week.'], input), ['PDF carousels run at 2.1× your usual across 9 posts.', 'Keep Tuesday mornings (5–11) for them.', 'Post 3 a week.']);
  const { rows } = synthetic();
  const pb = buildPlaybook(rows);
  let prompt = '';
  const why = await playbookNarrative(pb, async (p) => {
    prompt = p;
    return JSON.stringify({ linkedin: [`PDF carousels are your strongest format at ${pb.channels[0].wins[0].label.match(/(\d+(\.\d)?)×/)![1]}× your usual.`, 'They triple your reach.', 'Text-only posts get 12.5% less.'], x: ['ignored'] });
  });
  assert.match(prompt, /never introduce a new number/);
  assert.deepEqual(why.linkedin.slice(1), ['They triple your reach.'], 'a sentence with an invented number is dropped; one without numbers stays');
  assert.equal(why.x, undefined);
});

test('refresh caches the playbook from posts and headline lifts; scheduled posts store forecasts', async () => {
  const { posts, rows } = synthetic();
  const perf = rows.map((r) => ({ post: r.post, channel: r.channel, bucket: '7d' as const, ageHours: 168, lift: Math.round(r.lift * 100) / 100, baselineN: 20, source: 'manual' as const }));
  let calls = 0;
  const pb = await refreshPlaybook({ posts, perf, now: new Date('2026-11-02T00:00:00Z'), ask: async (p) => (calls++, p.includes('Label the hook') ? '[]' : '{"linkedin": ["PDF carousels lead."]}') });
  assert.equal(calls, 1, 'every synthetic hook is rule-placed, so only the narrative is asked for');
  assert.deepEqual(pb.channels[0].narrative, ['PDF carousels lead.']);
  assert.equal((await readPlaybook())!.computedAt, '2026-11-02T00:00:00.000Z');
  const draft = post(950, { kind: 'pdf-carousel', weekday: 2, hour: 'morning' });
  draft.channels.push({ channel: 'instagram', caption: 'x', hashtags: [], media: ['a.png'], via: 'manual' });
  assert.ok((await forecastPost(draft, 'linkedin'))!.lift > 1);
  assert.equal(await forecastPost(draft, 'instagram'), null, 'no instagram model yet');
  const stored = await recordForecast(draft, new Date('2026-11-03T00:00:00Z'));
  assert.equal(stored.length, 1);
  await recordForecast(draft);
  assert.equal((await readForecasts()).length, 1, 're-scheduling replaces the forecast');
});

test('recovery holds across many synthetic histories, not just one lucky seed', () => {
  let inRange = 0;
  for (let s = 1; s <= 20; s++) {
    const { rows } = synthetic(60, s);
    const m = fitChannel(rows)!;
    const pdf = m.effects.find((x) => x.feature === 'mediaKind' && x.level === 'pdf-carousel')!.effect;
    if (pdf >= 1.6 && pdf <= 2.6) inRange++;
    assert.ok(m.effects.find((x) => x.feature === 'mediaKind' && x.level === 'text-only')!.effect < 1, `seed ${s}`);
    assert.equal(buildPlaybook(rows).channels[0].wins[0].level, 'pdf-carousel', `seed ${s}`);
  }
  assert.ok(inRange >= 17, `${inRange}/20 in 1.6–2.6×`);
});
