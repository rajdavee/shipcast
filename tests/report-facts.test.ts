import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'report-facts-'));
const { buildFacts, periodFor, shiftPeriod, volumeQuality, robustZ, streak, readingsAsOf, channelOfSource } = await import('@shipcast/engine');

const H = 3_600_000;
const D = 24 * H;
const NOW = new Date('2026-11-06T16:00:00Z');

let n = 0;
/** A published post on one channel, `daysAgo` before NOW. */
function post(ch: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  const at = new Date(NOW.getTime() - daysAgo * D).toISOString();
  return { id: `p${++n}`, title: `Post ${n}`, status: 'published', at, tz: 'UTC', notes: '', createdAt: at, updatedAt: at, channels: [{ channel: ch, caption: 'Hello', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: at }], ...extra } as any;
}
/** A reading of a post `ageH` hours after it went out. */
function snap(p: any, ageH: number, v: Record<string, number>) {
  const ch = p.channels[0].channel;
  return { id: `s${++n}`, post: p.id, channel: ch, at: new Date(Date.parse(p.channels[0].sentAt) + ageH * H).toISOString(), ageHours: ageH, source: 'manual', ...v } as any;
}

test('periods: rolling days, calendar months in the zone, and shifting back', () => {
  const w = periodFor('last7', NOW, 'UTC');
  assert.equal(w.end, NOW.toISOString());
  assert.equal(Date.parse(w.end) - Date.parse(w.start), 7 * D);
  const m = periodFor('lastMonth', NOW, 'America/New_York');
  assert.equal(m.start, '2026-10-01T04:00:00.000Z', 'midnight 1 Oct in New York (EDT)');
  assert.equal(m.end, '2026-11-01T04:00:00.000Z');
  assert.equal(m.label, 'October 2026');
  const prev = shiftPeriod(m, -1);
  assert.equal(prev.label, 'September 2026');
  assert.equal(prev.end, m.start);
  const jan = shiftPeriod(periodFor('lastMonth', new Date('2026-02-10T12:00:00Z'), 'UTC'), -1);
  assert.equal(jan.label, 'December 2025', 'crosses the year');
  const q = periodFor('lastQuarter', NOW, 'UTC');
  assert.equal(q.label, 'Q3 2026');
  assert.throws(() => periodFor('custom', NOW, 'UTC', { start: '2026-11-02', end: '2026-11-01' }));
});

test('volume and quality parts add up to the whole change', () => {
  const s = volumeQuality(4, 4000, 6, 5400)!;
  assert.equal(s.volume + s.quality, 1400);
  assert.ok(s.volume > 0 && s.quality < 0, 'more posts, less each');
  assert.equal(s.perPost, 900);
  assert.equal(volumeQuality(0, 0, 3, 100), undefined);
});

test('robust z and streaks', () => {
  assert.equal(robustZ(5, [1, 2]), undefined, 'too little history');
  assert.ok(robustZ(30, [10, 11, 9, 10, 12])! > 3);
  assert.equal(streak([1, 2, 3, 4]), 3);
  assert.equal(streak([5, 4, 3]), -2);
  assert.equal(streak([1, 3, 3]), 0);
  assert.equal(channelOfSource('lnkd.in'), 'linkedin');
  assert.equal(channelOfSource('m.youtube.com'), 'youtube');
  assert.equal(channelOfSource('google'), undefined);
});

test('the previous period is read as it stood the same time after it ended', () => {
  const p = post('linkedin', 10);
  const snaps = [snap(p, 24, { reach: 100 }), snap(p, 168, { reach: 400 })];
  const early = readingsAsOf(snaps, new Date(Date.parse(p.at) + 48 * H).toISOString());
  assert.equal(early.get(`${p.id}|linkedin`)?.reach, 100);
  assert.equal(readingsAsOf(snaps, NOW.toISOString()).get(`${p.id}|linkedin`)?.reach, 400);
});

test('a week of facts: totals, comparison, waterfall, split, top posts, work, coverage', () => {
  n = 0;
  // Last week: two LinkedIn posts. This week: three LinkedIn and one Instagram, one without numbers.
  const old1 = post('linkedin', 12), old2 = post('linkedin', 9);
  const a = post('linkedin', 5, { format: 'carousel', experiment: 'Try a PDF' }), b = post('linkedin', 4), c = post('linkedin', 3), ig = post('instagram', 2), quiet = post('linkedin', 1);
  // Baseline history so lifts exist (3+ other posts at the same age).
  const hist = [post('linkedin', 40), post('linkedin', 35), post('linkedin', 30)];
  const snaps = [
    ...hist.map((h) => snap(h, 48, { reach: 500, likes: 10 })),
    snap(old1, 48, { reach: 600, likes: 12 }), snap(old2, 48, { reach: 400, likes: 8 }),
    snap(a, 48, { reach: 2000, likes: 60, comments: 5 }), snap(b, 48, { reach: 500, likes: 9 }), snap(c, 48, { reach: 300, likes: 3 }),
    snap(ig, 30, { reach: 900, likes: 40, saves: 4 }),
  ];
  const camp = { id: 'c1', name: 'Launch', createdAt: new Date(NOW.getTime() - 3 * D).toISOString(), steps: [{ kind: 'pack', status: 'done', endedAt: new Date(NOW.getTime() - 2 * D).toISOString() }, { kind: 'pack', status: 'failed' }] } as any;
  const later = post('linkedin', -2);
  const upcoming = { ...later, status: 'scheduled', channels: [{ ...later.channels[0], state: 'pending', sentAt: undefined }] };
  const f = buildFacts({ posts: [...hist, old1, old2, a, b, c, ig, quiet, upcoming], snapshots: snaps, campaigns: [camp], goals: [{ id: 'g', metric: 'posts', target: 6, per: 'week' }], notes: [{ id: 'n1', date: '2026-11-03', text: 'Pricing page launched' }, { id: 'n2', date: '2026-08-01', text: 'old' }] }, periodFor('last7', NOW, 'UTC'), NOW);

  assert.equal(f.totals.posts, 5);
  assert.equal(f.totals.measured, 4);
  assert.equal(f.totals.audience, 3700);
  assert.equal(f.prev.posts, 2);
  assert.equal(f.prev.audience, 1000);
  const aud = f.kpis.find((k) => k.key === 'audience')!;
  assert.equal(aud.value, 3700);
  assert.equal(aud.change, 2.7);
  assert.equal(aud.series.at(-1), 3700);
  assert.ok(!f.kpis.some((k) => k.key === 'sessions'), 'no website numbers, no website tiles');

  assert.equal(f.waterfall.reduce((s, w) => s + w.delta, 0), f.totals.audience - f.prev.audience, 'channel changes add up');
  assert.equal(f.waterfall[0].channel, 'linkedin');
  assert.equal(f.split!.volume + f.split!.quality, 2700);

  assert.equal(f.top[0].post, a.id, 'the 2,000-reach carousel leads');
  assert.ok(f.top[0].lift! > 3);
  assert.equal(f.work.published, 5);
  assert.deepEqual(f.work.byChannel, { linkedin: 4, instagram: 1 });
  assert.deepEqual(f.work.experiments.map((e) => e.post), [a.id]);
  assert.deepEqual(f.work.campaigns, [{ id: 'c1', name: 'Launch', created: true, pieces: 1 }]);
  assert.equal(f.work.pieces, 1);
  assert.equal(f.work.upcoming, 1);

  assert.deepEqual(f.coverage.missing.map((m) => m.post), [quiet.id]);
  assert.match(f.coverage.messages.join(' '), /1 published post has no numbers/);
  assert.match(f.coverage.messages.join(' '), /Website numbers are not connected/);
  assert.deepEqual(f.notes.map((x) => x.id), ['n1']);

  const g = f.goals[0];
  assert.equal(g.window.start, '2026-11-02T00:00:00.000Z', 'Monday-based week');
  assert.equal(g.actual, 4, 'posts this Mon–Fri so far');
  assert.equal(g.done, false);
  assert.ok(g.projected! >= 6 && g.onTrack, 'four by Friday afternoon is on pace for six');
});

test('website days: totals, social sources by channel, search, and visits credited to a post', () => {
  n = 0;
  const p = post('linkedin', 5);
  const day = (date: string, sessions: number, extra: Record<string, unknown> = {}) => ({ date, sessions, users: sessions - 5, keyEvents: 2, ...extra });
  const site = [
    day('2026-10-25', 100),
    day('2026-11-02', 150, { bySource: { 'linkedin.com': { sessions: 40, keyEvents: 2 }, 'lnkd.in': { sessions: 10, keyEvents: 1 }, google: { sessions: 80, keyEvents: 0 } }, byCampaign: { [p.id]: { sessions: 30, keyEvents: 2, source: 'linkedin' } }, search: { clicks: 50, impressions: 1000, position: 8 }, topQueries: [{ query: 'shipcast', clicks: 20, impressions: 100 }] }),
    day('2026-11-04', 120, { byCampaign: { [p.id]: { sessions: 5, keyEvents: 1 } }, search: { clicks: 30, impressions: 1000, position: 12 } }),
  ];
  const f = buildFacts({ posts: [p], snapshots: [], campaigns: [], site }, periodFor('last7', NOW, 'UTC'), NOW);
  assert.equal(f.site!.sessions, 270);
  assert.equal(f.site!.prev.sessions, 100);
  assert.deepEqual(f.site!.social, [{ channel: 'linkedin', sessions: 50, keyEvents: 3 }]);
  assert.equal(f.site!.search!.clicks, 80);
  assert.equal(f.site!.search!.position, 10, 'impression-weighted');
  assert.equal(f.site!.topQueries[0].query, 'shipcast');
  assert.equal(f.kpis.find((k) => k.key === 'sessions')!.value, 270);
  assert.equal(f.kpis.find((k) => k.key === 'searchClicks')!.value, 80);
  assert.equal(f.work.posts[0].visits, 35);
  assert.equal(f.work.posts[0].keyEvents, 3);
  assert.equal(f.coverage.site, 'connected');
});

test('a run of growing weeks is notable', () => {
  n = 0;
  const posts: any[] = [], snaps: any[] = [];
  // One post a week for 8 weeks, each reaching more than the last, plus a big jump this week.
  for (let w = 7; w >= 0; w--) {
    const p = post('linkedin', w * 7 + 2);
    posts.push(p);
    snaps.push(snap(p, 24, { reach: w === 0 ? 5000 : 1000 + (7 - w) * 100 }));
  }
  const f = buildFacts({ posts, snapshots: snaps, campaigns: [] }, periodFor('last7', NOW, 'UTC'), NOW);
  const kinds = f.notable.map((x) => `${x.kind}:${x.key}:${x.channel ?? 'all'}`);
  assert.ok(kinds.includes('high:audience:all'), kinds.join(', '));
  assert.ok(kinds.some((k) => k.startsWith('streak-up:audience')), kinds.join(', '));
});
