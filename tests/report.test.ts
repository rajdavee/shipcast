import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'report-'));
const { buildFacts, periodFor, recommend, templateSections, templateHeadline, allowedNumbers, checkLine, writeReport, createReport, getReport, listReports, editReport, rewriteReport, reportVersions, restoreVersion, deleteReport, runRecommendation, savePost, addSnapshot, listPosts, readPlan, savePlan } = await import('@shipcast/engine');

const H = 3_600_000, D = 24 * H;
const NOW = new Date();
let n = 0;
function post(ch: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  const at = new Date(NOW.getTime() - daysAgo * D).toISOString();
  return { id: `p${++n}`, title: `Post ${n}`, status: 'published', at, tz: 'UTC', notes: '', createdAt: at, updatedAt: at, channels: [{ channel: ch, caption: 'Hello', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: at }], ...extra } as any;
}
const snap = (p: any, ageH: number, v: Record<string, number>) => ({ id: `s${++n}`, post: p.id, channel: p.channels[0].channel, at: new Date(Date.parse(p.channels[0].sentAt) + ageH * H).toISOString(), ageHours: ageH, source: 'manual', ...v }) as any;

function sampleFacts() {
  n = 0;
  const hist = [post('linkedin', 40), post('linkedin', 35), post('linkedin', 30)];
  const old = post('linkedin', 10);
  const star = post('linkedin', 5, { title: 'Five launch mistakes', format: 'carousel' }), b = post('linkedin', 4), ig = post('instagram', 3);
  const snaps = [...hist.map((h) => snap(h, 48, { reach: 500, likes: 10 })), snap(old, 48, { reach: 600, likes: 12 }), snap(star, 48, { reach: 2000, likes: 60 }), snap(b, 48, { reach: 500, likes: 9 }), snap(ig, 30, { reach: 900, likes: 40 })];
  const playbook = { computedAt: '', channels: [{ channel: 'linkedin', n: 20, ready: true, wins: [{ feature: 'format', level: 'carousel', effect: 2.1, lo: 1.5, hi: 2.8, n: 12, confidence: 'high', posts: [], label: 'LinkedIn · Carousel: 2.1× your usual (12 posts, high confidence)' }], losses: [], heat: [], bestSlots: [] }] } as any;
  return buildFacts({ posts: [...hist, old, star, b, ig], snapshots: snaps, campaigns: [], playbook, goals: [{ id: 'g', metric: 'posts', target: 40, per: 'month' }] }, periodFor('last7', NOW, 'UTC'), NOW);
}

test('next steps are tied to actions and ranked: pace, follow-up, then the rest', () => {
  const f = sampleFacts();
  const recs = recommend(f, { suggested: { linkedin: { slots: ['Tue 09:00'], why: ['Tue morning: 1.6× your usual over 5 posts'] } }, cadence: { linkedin: { slots: [] } } });
  assert.ok(recs.length <= 3 && recs.length >= 2);
  const kinds = recs.map((r) => r.kind);
  if (f.goals[0].onTrack === false) assert.equal(kinds[0], 'pace');
  assert.ok(kinds.includes('more-like-this'));
  const more = recs.find((r) => r.kind === 'more-like-this')!;
  assert.equal(more.action.post, f.top[0].post);
  assert.match(more.why, /your usual on LinkedIn, and it had what usually wins for you \(Carousel\)/);
  assert.deepEqual(recs.map((r) => r.id), recs.map((_, i) => `r${i + 1}`));
});

test('the template writes every section from the facts, and the audience decides what shows', () => {
  const f = sampleFacts();
  const recs = recommend(f);
  const team = templateSections(f, recs, 'team');
  const ids = team.map((s) => s.id);
  for (const id of ['summary', 'work', 'results', 'why', 'next', 'coverage']) assert.ok(ids.includes(id as any), id);
  assert.ok(team.every((s) => !s.hidden), 'the team sees everything');
  const boss = templateSections(f, recs, 'boss');
  assert.equal(boss.find((s) => s.id === 'work')!.hidden, true);
  assert.match(team.find((s) => s.id === 'why')!.lines.join(' '), /“Five launch mistakes” had what usually wins for you: Carousel/);
  assert.match(templateHeadline(f), /People reached up \d+% to 3,400, led by LinkedIn/);
  // Every number the template writes is a fact.
  const allowed = allowedNumbers(f, recs);
  for (const s of team) for (const l of s.lines) assert.ok(checkLine(l, allowed), l);
});

test('Claude lines with a number that is not a fact are dropped; the template fills in', async () => {
  const f = sampleFacts();
  const recs = recommend(f);
  const reply = JSON.stringify({
    headline: 'Reach up to 3.4k this week, led by LinkedIn',
    summary: ['Reach rose to 3,400 people.', 'We expect 9,999 next week.'],
    results: ['Made up: 12,345 impressions.'],
    why: ['The carousel did 4× your usual.'],
  });
  const w = await writeReport(f, recs, 'team', async () => reply);
  assert.equal(w.headline, 'Reach up to 3.4k this week, led by LinkedIn');
  assert.deepEqual(w.sections.find((s) => s.id === 'summary')!.lines, ['Reach rose to 3,400 people.']);
  assert.equal(w.sections.find((s) => s.id === 'results')!.lines[0], templateSections(f, recs, 'team').find((s) => s.id === 'results')!.lines[0], 'all lines bad: template');
  assert.equal(w.writer, 'mixed');
  const broken = await writeReport(f, recs, 'team', async () => 'not json');
  assert.equal(broken.writer, 'template');
});

test('reports are stored, edited with versions, restored, acted on and deleted', async () => {
  const p = await savePost({ title: 'Winner', status: 'published', format: 'carousel', at: new Date(Date.now() - 3 * D).toISOString(), channels: [{ channel: 'linkedin', caption: 'Why most launches fail?', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: new Date(Date.now() - 3 * D).toISOString() }] });
  for (const [i, reach] of [500, 520, 480].entries()) {
    const o = await savePost({ title: `Old ${i}`, status: 'published', at: new Date(Date.now() - (30 + i) * D).toISOString(), channels: [{ channel: 'linkedin', caption: 'x', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: new Date(Date.now() - (30 + i) * D).toISOString() }] });
    await addSnapshot({ post: o.id, channel: 'linkedin', source: 'manual', reach, likes: 10, at: new Date(Date.now() - (28 + i) * D).toISOString() } as any);
  }
  await addSnapshot({ post: p.id, channel: 'linkedin', source: 'manual', reach: 2400, likes: 90, at: new Date(Date.now() - 1 * D).toISOString() } as any);

  const r = await createReport({ kind: 'last7', audience: 'boss', ask: null, by: 'u1' });
  assert.match(r.id, /^rep[a-f0-9]{12}$/);
  assert.equal(r.writer, 'template');
  assert.equal(r.facts.totals.posts, 1);
  assert.equal((await listReports())[0].id, r.id);

  const e = await editReport(r.id, { headline: 'Our best week', sections: [{ id: 'summary', lines: ['We had a great week.'] }, { id: 'work', hidden: false }] });
  assert.equal(e.version, 2);
  assert.equal(e.sections.find((s) => s.id === 'summary')!.edited, true);
  assert.equal(e.sections.find((s) => s.id === 'work')!.hidden, false);
  const re = await rewriteReport(r.id, { audience: 'client', ask: null });
  assert.equal(re.audience, 'client');
  assert.equal(re.version, 3);
  assert.deepEqual((await reportVersions(r.id)).map((v) => v.version), [1, 2]);
  const back = await restoreVersion(r.id, 2);
  assert.equal(back.headline, 'Our best week');

  const more = back.recommendations.find((x) => x.kind === 'more-like-this');
  assert.ok(more, back.recommendations.map((x) => x.kind).join());
  const done = await runRecommendation(r.id, more!.id);
  assert.equal(done.created![0].status, 'idea');
  assert.match(done.created![0].title, /^Follow-up: Winner/);
  assert.ok(done.report.recommendations.find((x) => x.id === more!.id)!.done);
  assert.ok((await listPosts()).some((x) => x.id === done.created![0].id));

  await savePlan({ cadence: { linkedin: { perWeek: 2, slots: [] } } });
  assert.equal((await readPlan()).cadence.linkedin!.slots.length, 0);

  assert.equal(await deleteReport(r.id), true);
  assert.equal(await getReport(r.id), null);
  assert.equal(await getReport('../etc'), null);
});

test('asking a report: checked answers with a chart, or the facts alone when the model strays', async () => {
  const { askReport, factsAnswer, seriesLabels } = await import('@shipcast/engine');
  const r = await createReport({ kind: 'last7', ask: null });
  const good = await askReport(r.id, 'Which channel grew?', async () => JSON.stringify({ answer: [`LinkedIn reached ${r.facts.totals.audience} people.`], chart: { title: 'Reach', labels: ['now'], series: [{ name: 'Reach', values: [r.facts.totals.audience] }] } }));
  assert.equal(good.by, 'claude');
  assert.equal(good.chart!.series[0].values[0], r.facts.totals.audience);
  const strayed = await askReport(r.id, 'Which channel grew?', async () => JSON.stringify({ answer: ['LinkedIn reached 987,654 people.'] }));
  assert.equal(strayed.by, 'facts');
  assert.ok(strayed.answer.length > 0);
  const madeUpChart = await askReport(r.id, 'How did we do?', async () => JSON.stringify({ answer: ['Fine.'], chart: { title: 'x', labels: ['a'], series: [{ name: 'x', values: [424242] }] } }));
  assert.notEqual(madeUpChart.chart?.series[0].values[0], 424242, 'a chart with invented values is replaced');
  await assert.rejects(askReport(r.id, '   '), /Ask a question/);
  assert.equal(seriesLabels(r.facts).length, r.facts.kpis[0].series.length);
  const ch = factsAnswer(sampleFacts(), 'which channel did best?', []);
  assert.equal(ch.chart!.labels.length, 2);
});
