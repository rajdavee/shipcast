import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../apps/web/src/pulse-model.ts';
import { CALENDAR_CHANNELS, type Post as EnginePost } from '../services/engine/src/calendar.ts';
import { bucketOf, headline, parseMetricNumber, weightedEngagement, type Performance as EnginePerf } from '../services/engine/src/metrics.ts';
import { featuresOf, hookByRules } from '../services/engine/src/playbook.ts';
import type { Post } from '../apps/web/src/calendar-model.ts';

const perf = (over: Partial<m.Performance>): m.Performance => ({ post: 'p', channel: 'linkedin', bucket: '7d', ageHours: 168, baselineN: 14, source: 'manual', ...over });

test('lift badge: direction, the ±5 % "about usual" band, and no baseline', () => {
  assert.deepEqual(m.liftBadge(2.1), { text: '▲2.1×', tone: 'up', label: '2.1× your usual' });
  assert.deepEqual(m.liftBadge(0.6), { text: '▼0.6×', tone: 'down', label: '0.6× your usual' });
  assert.equal(m.liftBadge(1.03).text, '≈1.0×');
  assert.equal(m.liftBadge(1.03).tone, 'flat');
  assert.deepEqual(m.liftBadge(undefined), { text: '—', tone: 'none', label: 'No baseline yet' });
  assert.equal(m.liftBadge(0).text, '—');
  assert.equal(m.liftBadge(12.4).text, '▲12×');
  assert.equal(m.heatStrength(1), 0);
  assert.equal(m.heatStrength(3), 1);
  assert.equal(m.heatStrength(1 / 3), 1);
  assert.ok(m.heatStrength(1.5) > 0.3 && m.heatStrength(1.5) < 0.4);
});

test('lift headline reads as a sentence about the same age, and says why when there is no baseline', () => {
  assert.equal(m.liftHeadline(perf({ lift: 2.1, liftAudience: 2.3, liftEngagement: 1.9 }), 'LinkedIn'), '2.1× your usual reach and engagement at 7 days, vs 14 posts');
  assert.equal(m.liftHeadline(perf({ lift: 0.8, liftAudience: 0.8, bucket: '1d', baselineN: 1 }), 'LinkedIn'), '0.8× your usual reach at 1 day, vs 1 post');
  assert.match(m.liftHeadline(perf({ baselineN: 2 }), 'Instagram'), /^No baseline yet — your usual on Instagram at 7 days needs 3 other posts with numbers \(2 so far\)\.$/);
});

test('headline picks the same reading as the engine (most settled bucket with a lift)', () => {
  const rows: m.Performance[] = [perf({ bucket: '1d', ageHours: 24, lift: 1.4 }), perf({ bucket: '7d', lift: 1.9 }), perf({ bucket: '30d', ageHours: 720 })];
  assert.equal(m.headlineOf(rows, 'p', 'linkedin')!.bucket, headline(rows as EnginePerf[], 'p', 'linkedin')!.bucket);
  assert.equal(m.headlineOf(rows, 'p', 'linkedin')!.lift, 1.9);
  const post = { id: 'p', channels: [{ channel: 'instagram' }, { channel: 'linkedin' }] } as Post;
  assert.equal(m.postHeadline(rows, post)!.channel, 'linkedin', 'a channel with a lift wins over one without numbers');
  for (const h of [1, 20, 30, 60, 100, 168, 240, 400, 600, 900]) assert.equal(m.bucketOf(h), bucketOf(h), `bucket at ${h} h`);
});

test('forecast text is always marked as a forecast, never as a result', () => {
  const f = { lift: 1.42, lo: 0.81, hi: 2.33 };
  assert.equal(m.forecastHint(f), '~1.4×');
  assert.equal(m.forecastLabel(f), 'Forecast: likely 0.8–2.3× your usual');
  assert.ok(!m.forecastHint(f).includes('▲') && !m.forecastHint(f).includes('▼'));
  const p = m.bandPos({ lift: 1, lo: 0.5, hi: 2 });
  assert.equal(p.at, 50);
  assert.equal(p.lo, 25);
  assert.equal(p.hi, 75);
  assert.deepEqual(m.bandPos({ lift: 100, lo: 0.001, hi: 100 }), { lo: 0, hi: 100, at: 100 }, 'clamped to the axis');
});

test('heat-map scale: diverging steps around usual, a 7 × 5 Monday-first grid', () => {
  assert.deepEqual(m.heatLevel(1.02), { tone: 'flat', level: 0 });
  assert.deepEqual(m.heatLevel(1.1), { tone: 'up', level: 1 });
  assert.deepEqual(m.heatLevel(1.25), { tone: 'up', level: 2 });
  assert.deepEqual(m.heatLevel(1.6), { tone: 'up', level: 3 });
  assert.deepEqual(m.heatLevel(2.5), { tone: 'up', level: 4 });
  assert.deepEqual(m.heatLevel(0.5), { tone: 'down', level: 4 });
  assert.deepEqual(m.heatLevel(undefined), { tone: 'none', level: 0 });
  const g = m.heatGrid([{ weekday: 'Tue', hour: 'morning', lift: 1.9, n: 4, posts: [] }, { weekday: 'Sun', hour: 'night', lift: 0.5, n: 1, posts: [] }]);
  assert.equal(g.length, 7);
  assert.ok(g.every((r) => r.length === 5));
  assert.equal(g[1][0]!.lift, 1.9);
  assert.equal(g[6][4]!.lift, 0.5);
  assert.equal(g.flat().filter(Boolean).length, 2);
  const bar = m.effectBar({ effect: 2, lo: 1.5, hi: 3 });
  assert.equal(bar.left, 50);
  assert.equal(bar.width, 25);
  assert.equal(m.effectBar({ effect: 0.5, lo: 0.4, hi: 0.7 }).left, 25);
});

test('quick form: 5–7 fields that each platform shows, in its own words; "1.2K" is a number', () => {
  for (const c of CALENDAR_CHANNELS) {
    const f = m.fieldsFor(c.id);
    assert.ok(f.length >= 5 && f.length <= 8, `${c.id}: ${f.length} fields`);
    assert.equal(new Set(f).size, f.length);
    assert.ok(f.every((k) => (m.METRIC_KEYS as readonly string[]).includes(k)));
  }
  assert.ok(!m.fieldsFor('linkedin').includes('saves'), 'LinkedIn shows no saves');
  assert.ok(m.fieldsFor('instagram').includes('saves'));
  assert.ok(m.fieldsFor('youtube').includes('avgViewPct') && !m.fieldsFor('linkedin').includes('avgViewPct'));
  assert.equal(m.metricLabel('linkedin', 'likes'), 'Reactions');
  assert.equal(m.metricLabel('x', 'shares'), 'Reposts');
  assert.equal(m.metricLabel('instagram', 'likes'), 'Likes');
  for (const s of ['1.2K', '3,410', '12 %', '3M', '0', '842', 'abc', '', '-4', '1.2.3']) assert.equal(m.parseMetric(s), s.trim() ? parseMetricNumber(s) : undefined, `"${s}" parses like the engine`);
  assert.deepEqual(m.readForm({ reach: '1.2K', likes: ' 34 ', comments: '', shares: 'lots', avgViewPct: '140' }), { values: { reach: 1200, likes: 34 }, bad: ['shares', 'avgViewPct'] });
  assert.equal(m.fmtCount(842), '842');
  assert.equal(m.fmtCount(1240), '1.2K');
  assert.equal(m.fmtCount(13_900), '13.9K');
  assert.equal(m.fmtCount(254_000), '254K');
  assert.equal(m.fmtCount(3_400_000), '3.4M');
  assert.equal(m.engagementOf({ likes: 10, comments: 2, shares: 1, saves: 1, clicks: 3 }), weightedEngagement({ likes: 10, comments: 2, shares: 1, saves: 1, clicks: 3 }));
});

test('step chart: starts at zero, steps up at each reading, ages on a sqrt axis', () => {
  const pts = m.stepChart([{ ageHours: 168, reach: 1000 }, { ageHours: 24, reach: 600 }] as m.Snapshot[], m.audienceOf as never, 200, 50, 168);
  assert.deepEqual(pts.map((p) => p.age), [24, 168]);
  assert.equal(pts[1].x, 200);
  assert.equal(pts[1].y, 0);
  assert.equal(pts[0].y, 20);
  assert.equal(m.stepPath(pts, 50), `M0 50 H${pts[0].x.toFixed(1)} V20.0 H200.0 V0.0`);
  assert.deepEqual(m.stepChart([{ ageHours: 24 }] as m.Snapshot[], m.audienceOf as never, 200, 50), []);
});

test('draft features mirror the engine for every key a forecast factor can use', () => {
  const at = '2026-11-10T08:30:00Z';
  const cases: Partial<EnginePost>[] = [
    { format: 'carousel', pillar: 'Teach', channels: [{ channel: 'linkedin', caption: 'How to build a changelog people read\n\nBody', hashtags: ['#a'], media: ['campaigns/x/out/deck.pdf'], via: 'manual' }] },
    { trend: 't1', channels: [{ channel: 'instagram', caption: `Why do launches flop?\n${'word '.repeat(200)}https://x.io`, hashtags: Array(8).fill('#t'), media: ['a.png', 'b.png', 'c.png'], via: 'manual', firstComment: 'link: https://x.io' }] },
    { channels: [{ channel: 'youtube', caption: '', title: 'Last year we shipped a thing', hashtags: [], media: ['v-16x9.mp4'], via: 'manual' }] },
  ];
  for (const c of cases) {
    const p = { id: 'p', title: 'T', status: 'draft', at, tz: 'Europe/London', notes: '', createdAt: '', updatedAt: '', ...c } as EnginePost;
    const mine = m.draftFeatures(p as unknown as Post, p.channels[0].channel)!;
    const theirs = featuresOf(p, p.channels[0].channel)!;
    for (const [k, v] of Object.entries(mine)) assert.equal(v, (theirs as Record<string, string>)[k], `${p.channels[0].channel}.${k}`);
  }
  for (const l of ['Why do most launch posts get ignored?', '5 things we cut', 'How to write release notes', 'Stop writing feature lists.', 'Introducing exports', 'Last year we rewrote it.', 'Before: 14 steps. After: 3.', '"Ship it," she said.', 'Plain line']) assert.equal(m.hookByRules(l), hookByRules(l), l);
});

test('forecast factors: only learned effects that apply to the draft, strongest first', () => {
  const e = (feature: string, level: string, effect: number, n = 8): m.Effect => ({ feature, level, effect, lo: effect * 0.8, hi: effect * 1.2, n, confidence: 'high', posts: [] });
  const model = { effects: [e('mediaKind', 'pdf-carousel', 1.9), e('mediaKind', 'text-only', 0.6), e('hour', 'morning', 1.2), e('weekday', 'Tue', 1.02), e('hook', 'how-to', 0.7, 2)] };
  const f = { mediaKind: 'pdf-carousel', hour: 'morning', weekday: 'Tue', hook: 'how-to' };
  assert.deepEqual(m.factorsFor(model, f).map((x) => x.level), ['pdf-carousel', 'morning'], 'too small an effect and too few posts are left out');
  assert.deepEqual(m.factorsFor(undefined, f), []);
});

test('playbook words: level names, the why sentence uses only the finding’s numbers, calibration lines', () => {
  assert.equal(m.levelName('mediaKind', 'pdf-carousel'), 'PDF carousels');
  assert.equal(m.levelName('hook', 'before-after'), 'Before after hooks');
  assert.equal(m.levelName('weekday', 'Tue'), 'Tuesdays');
  const why = m.whySentence({ feature: 'mediaKind', level: 'pdf-carousel', effect: 2.1, lo: 1.5, hi: 2.8, n: 12, confidence: 'high', posts: [] }, 'LinkedIn');
  assert.equal(why, 'PDF carousels on LinkedIn did 2.1× your usual across 12 posts, after allowing for everything else about them; the likely range (1.5×–2.8×) stays on one side of usual.');
  for (const n of why.match(/\d+(\.\d+)?/g)!) assert.ok(['2.1', '12', '1.5', '2.8'].includes(n), n);
  assert.match(m.whySentence({ feature: 'hour', level: 'night', effect: 0.8, lo: 0.6, hi: 1.1, n: 5, confidence: 'low', posts: [] }, 'LinkedIn'), /below it .* still crosses usual/);
  assert.equal(m.calibrationLine({ n: 9, rows: Array.from({ length: 9 }, (_, i) => ({ inBand: i < 7 })) as m.Calibration['rows'] }), 'Forecasts landed inside their range 7 of 9 times');
  assert.equal(m.calibrationLine({ n: 0, rows: [] }), null);
  assert.equal(m.criticLine({ n: 12, rank: 0.62 }), 'Critic scores track your results: strong (12 posts).');
  assert.equal(m.criticStrength(0.3), 'moderate');
  assert.equal(m.criticStrength(0.1), 'weak');
  assert.equal(m.criticStrength(-0.4), 'inverse');
  assert.match(m.criticLine({ n: 3, rank: null }), /^Not enough yet .*\(3 so far\)\.$/);
});

test('leaderboard: one row per post at its headline, top and bottom without overlap', () => {
  const rows: m.Performance[] = [];
  for (let i = 0; i < 8; i++) rows.push(perf({ post: `p${i}`, lift: 0.5 + i * 0.25 }), perf({ post: `p${i}`, bucket: '1d', ageHours: 24, lift: 9 }));
  rows.push(perf({ post: 'ig', channel: 'instagram', lift: 5 }));
  const lb = m.leaderboard(rows, 'linkedin', 3);
  assert.deepEqual(lb.top.map((r) => r.post), ['p7', 'p6', 'p5']);
  assert.deepEqual(lb.bottom.map((r) => r.post), ['p0', 'p1', 'p2']);
  assert.ok(lb.top.every((r) => r.bucket === '7d'));
  assert.deepEqual(m.leaderboard(rows.slice(0, 4), 'linkedin', 3).bottom.map((r) => r.post), [], 'no bottom list when everything fits in the top');
});
