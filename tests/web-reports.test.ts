import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../apps/web/src/reports-model.ts';
import { perms } from '../apps/web/src/auth-model.ts';
import { KPI_KEYS as ENGINE_KPI_KEYS } from '../services/engine/src/report-facts.ts';
import { SECTION_IDS } from '../services/engine/src/report.ts';

test('the web mirrors the engine: KPI keys and section ids', () => {
  assert.deepEqual([...m.KPI_KEYS], [...ENGINE_KPI_KEYS]);
  const ids: m.SectionId[] = [...SECTION_IDS];
  assert.equal(ids.length, 9);
  for (const k of m.KPI_KEYS) assert.ok(m.METRIC_LABEL[k], `label for ${k}`);
});

test('change reads with a sign, a tone and a spoken label; tiny moves are "about the same"', () => {
  assert.deepEqual(m.fmtChange(0.234), { text: '+23%', tone: 'up', arrow: '↑', label: 'Up 23% on the period before' });
  assert.deepEqual(m.fmtChange(-0.081), { text: '−8.1%', tone: 'down', arrow: '↓', label: 'Down 8.1% on the period before' });
  assert.equal(m.fmtChange(0.004).text, '±0%');
  assert.equal(m.fmtChange(0.004).tone, 'flat');
  assert.equal(m.fmtChange(undefined).tone, 'none');
  assert.equal(m.fmtChange(undefined).text, '—');
  assert.equal(m.fmtChange(Number.NaN).tone, 'none');
  assert.equal(m.fmtChange(-0.2, { invert: true }).tone, 'up', 'down is good for inverted metrics');
  assert.equal(m.fmtChange(1.5).text, '+150%');
});

test('KPI values: rates are percent points, counts are compact, deltas are signed', () => {
  assert.equal(m.fmtKpi(4.21, 'percent'), '4.2%');
  assert.equal(m.fmtKpi(4, 'percent'), '4%');
  assert.equal(m.fmtKpi(12.6, 'percent'), '13%');
  assert.equal(m.fmtKpi(842), '842');
  assert.equal(m.fmtKpi(12_400), '12.4K');
  assert.equal(m.fmtKpi(undefined), '—');
  assert.equal(m.fmtDelta(3200), '+3,200');
  assert.equal(m.fmtDelta(-410), '−410');
  assert.equal(m.fmtDelta(0), '±0');
  assert.equal(m.liftText(2.1), '2.1× your usual');
  assert.equal(m.liftText(undefined), 'No baseline yet');
  assert.equal(m.whyChip('Format · Carousel: 2.1× usual'), 'Carousel');
  assert.equal(m.whyChip('Hook · Question'), 'Question');
});

test('sparkline: oldest left, newest right, highest at the top, flat series in the middle', () => {
  const s = m.sparkPath([1, 3, 2], 100, 20, 0);
  assert.equal(s.line, 'M0 20 L50 0 L100 10');
  assert.deepEqual(s.last, { x: 100, y: 10 });
  assert.match(s.area, /Z$/);
  assert.equal(m.sparkPath([5, 5, 5], 100, 20, 0).line, 'M0 10 L50 10 L100 10');
  assert.equal(m.sparkPath([], 100, 20).line, '');
  assert.equal(m.sparkPath([], 100, 20).last, null);
  const one = m.sparkPath([7], 100, 20, 0);
  assert.deepEqual(one.last, { x: 50, y: 10 });
  assert.equal(one.area, '', 'one point has no area');
});

test('waterfall: one scale, axis where zero falls, bars sorted biggest gain first, total is the sum', () => {
  const w = m.waterfallBars([
    { channel: 'youtube', name: 'YouTube', delta: 300 },
    { channel: 'linkedin', name: 'LinkedIn', delta: 2900 },
    { channel: 'x', name: 'X', delta: -800 },
  ]);
  assert.equal(w.total, 2400);
  assert.equal(w.bars.map((b) => b.channel).join(','), 'linkedin,youtube,x');
  // span = 2900 + 800; zero at 800/3700
  assert.equal(w.zero, Math.round((800 / 3700) * 10000) / 100);
  const li = w.bars[0], x = w.bars[2];
  assert.equal(li.tone, 'up');
  assert.equal(li.left, w.zero);
  assert.ok(Math.abs(li.left + li.width - 100) < 0.02, 'the biggest gain reaches the right edge');
  assert.equal(x.tone, 'down');
  assert.ok(Math.abs(x.left) < 0.02, 'the biggest loss reaches the left edge');
  assert.ok(Math.abs(x.left + x.width - w.zero) < 0.02, 'a loss ends at the axis');

  const gains = m.waterfallBars([{ channel: 'linkedin', name: 'LinkedIn', delta: 10 }, { channel: 'youtube', name: 'YouTube', delta: 5 }]);
  assert.equal(gains.zero, 0);
  assert.equal(gains.bars[1].width, 50);
  const none = m.waterfallBars([{ channel: 'linkedin', name: 'LinkedIn', delta: 0 }]);
  assert.equal(none.bars[0].width, 0);
  assert.equal(none.bars[0].tone, 'flat');
});

test('volume vs per-post split: shares of one bar and a sentence that matches the numbers', () => {
  const v = m.splitView({ volume: 1200, quality: 2000, perPost: 1100, prevPerPost: 900 })!;
  assert.equal(v.volume + v.quality, 100);
  assert.equal(v.volume, 37.5);
  assert.equal(v.total, 3200);
  assert.equal(v.caption, 'Reach rose +3,200: posting more +1,200, more per post +2,000 (900 → 1,100 a post).');
  const down = m.splitView({ volume: -500, quality: 200, perPost: 1000, prevPerPost: 950 })!;
  assert.match(down.caption, /^Reach fell −300: posting less −500, more per post \+200/);
  assert.equal(m.splitView(undefined), null);
  assert.match(m.splitView({ volume: 0, quality: 0, perPost: 10, prevPerPost: 10 })!.caption, /held steady/);
});

test('goals: progress, pace tick, forecast and a plain state', () => {
  const g = m.goalBar({ actual: 40, target: 100, elapsed: 0.5, projected: 80, onTrack: false, done: false });
  assert.deepEqual(g, { pct: 40, pace: 50, projected: 80, tone: 'behind', text: 'Behind pace' });
  assert.equal(m.goalBar({ actual: 60, target: 100, elapsed: 0.5, projected: 120, onTrack: true, done: false }).tone, 'ok');
  assert.equal(m.goalBar({ actual: 60, target: 100, elapsed: 0.5, projected: 120, onTrack: true, done: false }).projected, 100, 'forecast is capped at the bar end');
  assert.equal(m.goalBar({ actual: 10, target: 100, elapsed: 0.1, done: false }).tone, 'early');
  assert.equal(m.goalBar({ actual: 130, target: 100, elapsed: 0.9, done: true }).pct, 100);
  assert.equal(m.goalBar({ actual: 130, target: 100, elapsed: 0.9, done: true }).text, 'Reached');
  assert.equal(m.goalBar({ actual: 5, target: 0, elapsed: 0.5, done: false }).pct, 100, 'a zero target never divides by zero');
  assert.equal(m.goalTitle({ metric: 'audience', target: 2000, per: 'month', channel: 'linkedin' }), '2K people reached a month on LinkedIn');
  assert.equal(m.goalTitle({ metric: 'rate', target: 4.5, per: 'week' }), '4.5% engagement rate a week');
  assert.equal(m.goalTitle({ metric: 'posts', target: 3, per: 'week', label: 'Ship 3' }), 'Ship 3');
});

test('time saved: per-report estimates by period length', () => {
  assert.equal(m.timeSaved('last7'), 2.5);
  assert.equal(m.timeSaved('last30'), 4);
  assert.equal(m.timeSaved('lastMonth'), 4);
  assert.equal(m.timeSaved('lastQuarter'), 6);
  assert.equal(m.timeSaved('custom', { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' }), 2.5);
  assert.equal(m.timeSaved('custom', { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' }), 4);
  assert.equal(m.timeSaved('custom', { start: '2026-07-01T00:00:00Z', end: '2026-10-01T00:00:00Z' }), 6);
  assert.equal(m.timeSavedText(2.5), 'Time saved: about 2.5 hours (estimate)');
  assert.equal(m.timeSavedText(4), 'Time saved: about 4 hours (estimate)');
});

const facts = (over: Partial<m.Facts> = {}) =>
  ({
    kpis: [{ key: 'audience', label: 'People reached', value: 5000, change: 0.3, series: [1, 2] }],
    waterfall: [{ channel: 'linkedin', name: 'LinkedIn', delta: 900 }, { channel: 'youtube', name: 'YouTube', delta: 100 }],
    channels: [],
    top: [{ post: 'p1', title: 'Our pricing teardown carousel that everyone shared', channel: 'linkedin', at: '2026-11-01T10:00:00Z', lift: 2.1, why: [] }],
    goals: [],
    notable: [],
    ...over,
  }) as m.Facts;

test('suggested questions come from what is in the report, at most four, no repeats', () => {
  const q = m.suggestedQuestions(facts());
  assert.equal(q[0], 'Why did reach go up?');
  assert.ok(q.includes('Which channel grew most?'));
  assert.ok(q.some((x) => x.startsWith('Why did “Our pricing teardown')));
  assert.ok(q.length <= 4);
  assert.equal(new Set(q).size, q.length);
  const flat = m.suggestedQuestions(facts({ kpis: [{ key: 'audience', label: 'People reached', value: 1, change: 0.01, series: [] }], waterfall: [], top: [] }));
  assert.deepEqual(flat, ['Why did reach change?', 'What should we post next week?']);
  const goals = m.suggestedQuestions(facts({ waterfall: [], top: [], goals: [{ label: 'Website visits', onTrack: false } as m.GoalFact], site: { keyEvents: 3 } as m.SiteFacts }));
  assert.ok(goals.includes('How do we get back on pace for website visits?'));
  assert.ok(goals.includes('Which posts brought signups?'));
});

test('next-step navigation maps engine paths to this app’s hash routes', () => {
  assert.equal(m.mapNavigate('/calendar?plan=1'), '/calendar/plan');
  assert.equal(m.mapNavigate('/insights?tab=numbers'), '/insights/performance');
  assert.equal(m.mapNavigate('/insights?tab=quality'), '/insights/quality');
  assert.equal(m.mapNavigate('/settings?tab=website'), '/settings/website');
  assert.equal(m.mapNavigate('/calendar?post=abc'), '/calendar/post/abc');
  assert.equal(m.mapNavigate('/calendar'), '/calendar');
  assert.equal(m.mapNavigate('#/reports'), '/reports');
  assert.equal(m.mapNavigate(undefined), null);
  assert.equal(m.mapNavigate('/somewhere-else'), null, 'unknown places are not followed');
});

test('create form: period labels, custom ranges and the request body', () => {
  assert.deepEqual(m.PERIOD_CHOICES.map((p) => p.kind), ['last7', 'last30', 'lastMonth', 'lastQuarter', 'custom']);
  assert.equal(m.periodLabel('last7'), 'This week');
  assert.equal(m.periodLabel('lastQuarter'), 'Last quarter');
  assert.deepEqual(m.AUDIENCE_CHOICES.map((a) => a.id), ['team', 'boss', 'client']);
  assert.equal(m.customRangeProblem('', '2026-10-01'), 'Pick a start and an end date.');
  assert.equal(m.customRangeProblem('2026-10-05', '2026-10-01'), 'The start has to be before the end.');
  assert.equal(m.customRangeProblem('2024-01-01', '2026-01-01'), 'Pick a range of a year or less.');
  assert.equal(m.customRangeProblem('2026-10-01', '2026-10-31'), null);
  assert.deepEqual(m.createBody('last7', 'boss'), { kind: 'last7', audience: 'boss' });
  assert.deepEqual(m.createBody('custom', 'client', '2026-10-01', '2026-10-31'), { kind: 'custom', audience: 'client', start: '2026-10-01', end: '2026-11-01' }, 'the end day is included');
  assert.equal(m.makingStep(0), 'Reading your numbers…');
  assert.equal(m.makingStep(10 * 60_000), m.MAKING_STEPS.at(-1));
});

test('role gates: viewers read, editors make and act, admins also share, send and deliver', () => {
  const v = m.reportGates(perms('viewer'));
  assert.deepEqual([v.read, v.create, v.edit, v.act, v.ask, v.share, v.send, v.delivery, v.website], [true, false, false, false, true, false, false, false, false], 'viewers may ask (answered from the facts, no Claude)');
  const e = m.reportGates(perms('editor'));
  assert.deepEqual([e.create, e.edit, e.act, e.ask, e.remove, e.share, e.send, e.delivery], [true, true, true, true, true, false, false, false]);
  const a = m.reportGates(perms('admin'));
  assert.deepEqual([a.share, a.send, a.delivery, a.website], [true, true, true, true]);
  assert.equal(m.reportGates(perms(null)).read, false);
});

test('sections, coverage fixes, exports and share links', () => {
  const s = m.splitSections([{ id: 'summary', title: 'In short', lines: ['a'] }, { id: 'why', title: 'Why', lines: [], hidden: true }]);
  assert.deepEqual(s.shown.map((x) => x.id), ['summary']);
  assert.deepEqual(s.hidden.map((x) => x.id), ['why']);
  assert.deepEqual(m.linesFrom(' one \n\n two\n'), ['one', 'two']);

  const cov = (missing: number, site: 'connected' | 'none') => ({ missing: Array.from({ length: missing }, (_, i) => ({ post: `p${i}`, title: `P${i}`, channel: 'linkedin' as const })), sources: {}, site, messages: [] });
  assert.deepEqual(m.coverageFixes(cov(0, 'connected'), true), []);
  assert.deepEqual(m.coverageFixes(cov(1, 'connected'), true), [{ label: 'Add numbers for 1 post', href: '#/calendar/post/p0' }]);
  assert.deepEqual(m.coverageFixes(cov(3, 'none'), true).map((x) => x.href), ['#/insights/performance', '#/settings/website']);
  assert.match(m.coverageFixes(cov(0, 'none'), false)[0].label, /Ask an admin/);

  const ex = m.exportLinks('rep123abc');
  assert.deepEqual(ex.map((x) => x.id), ['pdf', 'pptx', 'csv', 'md', 'card']);
  assert.equal(ex[0].href, '/api/reports/rep123abc/export/pdf');
  assert.equal(ex[4].href, '/api/reports/rep123abc/card.png');

  assert.equal(m.shareLink('http://localhost:4300', '/r/tok'), 'http://localhost:4300/r/tok');
  assert.equal(m.shareLink('http://localhost:4300/', 'r/tok'), 'http://localhost:4300/r/tok');
  assert.equal(m.shareLink('http://x', 'https://example.com/r/tok'), 'https://example.com/r/tok');
});

test('delivery helpers: webhook kinds, email lists, rollup order', () => {
  assert.equal(m.webhookKind('https://hooks.slack.com/services/T/B/x'), 'slack');
  assert.equal(m.webhookKind('https://acme.webhook.office.com/webhookb2/x'), 'teams');
  assert.equal(m.webhookKind('https://discord.com/api/webhooks/1/abc'), 'discord');
  assert.equal(m.webhookKind('https://example.com/hook'), 'generic');
  assert.deepEqual(m.parseEmails('Boss@Acme.com, client@example.com; boss@acme.com\nnope'), { ok: ['boss@acme.com', 'client@example.com'], bad: ['nope'] });
  assert.deepEqual(m.parseEmails('  '), { ok: [], bad: [] });
  const r = m.rollupOrder([
    { workspace: { id: 'a', name: 'Zed' }, needsAttention: true },
    { workspace: { id: 'b', name: 'Acme' }, needsAttention: false },
    { workspace: { id: 'c', name: 'Beta' }, needsAttention: true },
  ]);
  assert.deepEqual(r.map((x) => x.workspace.name), ['Beta', 'Zed', 'Acme']);
});

test('chart bars and relative times', () => {
  const b = m.chartBars({ title: 't', labels: ['LinkedIn', 'YouTube'], series: [{ name: 'Reach', values: [200, 50] }] });
  assert.deepEqual(b.map((x) => x.values[0].pct), [100, 25]);
  assert.equal(m.chartBars({ title: 't', labels: ['a'], series: [{ name: 's', values: [0] }] })[0].values[0].pct, 0);
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(m.ago('2026-11-05T11:59:30Z', now), 'just now');
  assert.equal(m.ago('2026-11-05T11:30:00Z', now), '30 min ago');
  assert.equal(m.ago('2026-11-05T07:00:00Z', now), '5 h ago');
  assert.equal(m.ago('2026-11-02T12:00:00Z', now), '3 days ago');
  assert.equal(m.ago(undefined, now), '');
});
