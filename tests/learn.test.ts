import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'learn-'));
process.env.SHIPCAST_HOME = home;
const { classify, collectIncidents, judgeLessons, lessonCandidates, learnOnce, lessonsBrief, readLessons, setLessonStatus, saveEval } = await import('@shipcast/engine');

// A campaign with a carousel that kept failing the legibility check, and a revision note.
const cid = 'c20261101-aaaaaa';
const dir = join(home, 'campaigns', cid);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'campaign.json'),
  JSON.stringify({ id: cid, name: 'T', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', source: { type: 'url', value: 'x' }, goal: '', audience: '', tone: '', notes: '', steps: [{ id: 's1', kind: 'pack', pack: 'carousel', status: 'done', options: {} }, { id: 's2', kind: 'pack', pack: 'reel', status: 'done', options: {} }] }),
);
const ev = (t: string, step: string, extra: object) => JSON.stringify({ t, step, ...extra });
const lines = [];
for (let h = 0; h < 4; h++) {
  const t = `2026-11-01T0${h}:00:00.000Z`;
  lines.push(ev(t, 's1', { type: 'status', status: 'running', text: 'Started' }));
  lines.push(ev(t, 's1', { type: 'log', text: 'Quality check found 2 issue(s): Slide 3: the cropped screenshot: its UI text lands at about 12px on the canvas (needs 24px). · Slide 5: text overflows its box (h2 "x"). Shorten it.' }));
}
lines.push(ev('2026-11-01T05:00:00.000Z', 's1', { type: 'log', text: 'Revision queued: make the screenshots readable on a phone' }));
lines.push(ev('2026-11-01T05:00:00.000Z', 's2', { type: 'status', status: 'running', text: 'Started' }));
lines.push(ev('2026-11-01T05:10:00.000Z', 's2', { type: 'log', text: 'Quality check found 1 issue(s): stills/deck: DevTools connection closed' }));
lines.push(ev('2026-11-01T05:20:00.000Z', 's2', { type: 'log', text: 'Brand score 82% — Say "revise" instead of "edit" · 6 hashtags; max 3' }));
writeFileSync(join(dir, 'events.ndjson'), lines.join('\n') + '\n');

const since = new Date('2026-10-01T00:00:00Z');
const now = new Date('2026-11-02T00:00:00Z');

test('incidents are classified into a fixed set of categories; tool failures are infra', () => {
  assert.equal(classify('its UI text lands at about 12px'), 'tiny-screenshot');
  assert.equal(classify('Slide 2: smallest text is 18px — too small for mobile.'), 'small-text');
  assert.equal(classify('text overflows its box'), 'overflow');
  assert.equal(classify('DevTools connection closed'), 'infra');
  assert.equal(classify('Say "revise" instead of "edit"'), 'voice-wording');
  assert.equal(classify('the captions duplicate and collide with the headline'), 'caption-collision');
  assert.equal(classify('something nobody predicted'), 'other');
});

test('collects QA parts, revisions, brand slips and eval lows, and counts runs per format', async () => {
  await saveEval({ at: '2026-11-01T06:00:00.000Z', pieces: [{ campaign: cid, step: 's2', pack: 'reel', scores: { legibility: 2, hook: 4 }, avg: 3, fix: 'Make the captions larger.' }] });
  const { incidents, runs } = await collectIncidents(since);
  assert.equal(runs.carousel.length, 4);
  const carousel = incidents.filter((i) => i.pack === 'carousel');
  assert.equal(carousel.filter((i) => i.category === 'tiny-screenshot').length, 5, '4 QA + 1 revision');
  assert.equal(carousel.filter((i) => i.category === 'overflow').length, 4);
  assert.ok(incidents.some((i) => i.pack === 'reel' && i.category === 'infra'));
  assert.ok(incidents.some((i) => i.pack === 'reel' && i.category === 'hashtags'));
  assert.ok(incidents.some((i) => i.pack === 'reel' && i.source === 'eval' && /legibility scored 2/.test(i.text)));
});

test('candidates skip infra and covered categories; a single revision note is enough', async () => {
  const { incidents } = await collectIncidents(since);
  const c = lessonCandidates([], incidents);
  assert.ok(c.some((g) => g.pack === 'carousel' && g.category === 'tiny-screenshot'));
  assert.ok(!c.some((g) => g.category === 'infra'));
  assert.ok(!c.some((g) => g.category === 'hashtags' || g.category === 'voice-wording'), 'brand voice is per brand, not per format');
  const covered = lessonCandidates([{ id: 'x', pack: 'carousel', category: 'tiny-screenshot', rule: 'r', evidence: [], createdAt: '', status: 'trial', baseline: { rate: 1, runs: 4 } }], incidents);
  assert.ok(!covered.some((g) => g.pack === 'carousel' && g.category === 'tiny-screenshot'));
});

test('learnOnce writes lessons from one synthesis call, injects them into the prompt, and honours yielding', async () => {
  let prompts = 0;
  const ask = async (p: string) => {
    prompts++;
    assert.match(p, /\[revision\] make the screenshots readable/);
    return '```json\n[{"pack":"carousel","category":"tiny-screenshot","rule":"Crop every screenshot to at most 500 CSS px of the screen width so UI text reads on a phone."},{"pack":"carousel","category":"made-up","rule":"ignored because the category was not asked for"}]\n```';
  };
  const yielded = await learnOnce({ now, ask, shouldYield: async () => true });
  assert.equal(yielded.claudeRuns, 0);
  assert.equal(prompts, 0);
  const r = await learnOnce({ now, ask });
  assert.equal(r.claudeRuns, 1);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].status, 'trial');
  assert.equal(r.added[0].baseline.runs, 4);
  assert.match(await lessonsBrief('carousel'), /500 CSS px/);
  assert.equal(await lessonsBrief('reel'), '');
  await setLessonStatus(r.added[0].id, 'off');
  assert.equal(await lessonsBrief('carousel'), '');
  assert.equal((await readLessons()).length, 1);
});

test('a trial lesson is kept when its category gets rarer and retired when it does not', () => {
  const mk = (category: string) => ({ id: category, pack: 'carousel', category, rule: 'r', evidence: [], createdAt: '2026-11-10T00:00:00.000Z', status: 'trial' as const, baseline: { rate: 0.8, runs: 10 } });
  const runs = { carousel: Array.from({ length: 10 }, (_, i) => ({ at: `2026-11-1${i}T12:00:00.000Z`.replace('1-1', '1-1') })) };
  // 10 runs after the lesson: overflow still hits 8 of them, tiny-screenshot only 1.
  const incidents = runs.carousel.flatMap((r, i) => [
    ...(i < 8 ? [{ id: `o${i}`, at: r.at, campaign: 'c', step: `s${i}`, pack: 'carousel', source: 'qa' as const, category: 'overflow', text: '' }] : []),
    ...(i < 1 ? [{ id: `t${i}`, at: r.at, campaign: 'c', step: `s${i}`, pack: 'carousel', source: 'qa' as const, category: 'tiny-screenshot', text: '' }] : []),
  ]);
  const ls = [mk('overflow'), mk('tiny-screenshot')];
  const { kept, retired } = judgeLessons(ls, incidents, runs, new Date('2026-11-20T00:00:00Z'));
  assert.deepEqual(kept.map((l) => l.id), ['tiny-screenshot']);
  assert.deepEqual(retired.map((l) => l.id), ['overflow']);
});
