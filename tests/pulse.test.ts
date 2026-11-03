import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'pulse-'));
const { suggestedSlots, trendFit, rankForYou, moreLikeThis, remix, savePost, addSnapshot, getPost, collectIncidents, savePlan } = await import('@shipcast/engine');

const model = { effects: [{ feature: 'format', level: 'carousel', effect: 1.8, n: 9 }, { feature: 'mediaKind', level: 'video-vertical', effect: 0.7, n: 6 }] };
const pb = {
  computedAt: '',
  channels: [
    { channel: 'linkedin', n: 20, ready: true, wins: [], losses: [], heat: [], bestSlots: [{ weekday: 'Tue', hour: 'morning', lift: 1.6, n: 5, posts: [] }, { weekday: 'Sat', hour: 'night', lift: 0.9, n: 3, posts: [] }], model },
  ],
} as any;

test('suggested slots come from the best cells that beat your usual', () => {
  assert.deepEqual(suggestedSlots(pb), { linkedin: { slots: ['Tue 09:00'], why: ['Tue morning: 1.6× your usual over 5 posts'] } });
  assert.deepEqual(suggestedSlots(null), {});
});

test('trend cards are ranked by how well their recipe fits what wins for you', () => {
  const card = (key: string, pack: string) => ({ key, platform: 'linkedin', recipe: { pack } }) as any;
  assert.deepEqual(trendFit(card('a', 'carousel'), pb), { fit: 1.8, why: 'Carousel posts do 1.8× your usual on LinkedIn (9 posts)' });
  assert.equal(trendFit(card('b', 'reel'), pb)?.fit, 0.7, 'a reel is vertical video, which does worse for you');
  assert.equal(trendFit(card('d', 'newsletter'), pb), null, 'no evidence either way');
  assert.equal(trendFit(card('c', 'carousel'), null), null);
  const ranked = rankForYou([card('weak', 'reel'), card('first', 'newsletter'), card('fits', 'carousel')], pb);
  assert.deepEqual(ranked.map((c) => c.key), ['fits', 'first', 'weak']);
  assert.equal(ranked[0].fit, 1.8);
});

test('a winner gets a follow-up idea and remixes for the other channels in the plan', async () => {
  await savePlan({ cadence: { linkedin: { perWeek: 3, slots: [] }, instagram: { perWeek: 2, slots: [] }, x: { perWeek: 1, slots: [] } } });
  const p = await savePost({ title: 'Five launch mistakes', format: 'carousel', pillar: 'Teach', at: '2026-10-01T03:30:00Z', status: 'published', channels: [{ channel: 'linkedin', caption: 'Most launches fail quietly.\n\nHere is why.', hashtags: ['#launch'], media: [], via: 'manual', state: 'sent', sentAt: '2026-10-01T03:30:00Z' }] });
  const more = await moreLikeThis(p.id);
  assert.equal(more.status, 'idea');
  assert.equal(more.format, 'carousel');
  assert.equal(more.pillar, 'Teach');
  assert.match(more.notes, /Its hook: "Most launches fail quietly\."/);
  const rx = await remix(p.id);
  assert.deepEqual(rx.map((x) => x.channels[0].channel).sort(), ['instagram', 'x']);
  assert.equal(rx.find((x) => x.channels[0].channel === 'instagram')!.format, 'photo-carousel');
  await assert.rejects(moreLikeThis('nope'), /not found/);
});

test('posts far below your usual become learning-loop evidence', async () => {
  const mk = async (d: string, reach: number, title = `p ${d}`) => {
    const p = await savePost({ title, format: 'social-post', at: `${d}T03:30:00.000Z`, status: 'published', channels: [{ channel: 'x', caption: 'Hot take nobody asked for', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: `${d}T03:30:00.000Z` }] });
    await addSnapshot({ post: p.id, channel: 'x', source: 'manual', reach, likes: reach / 50 }, new Date(Date.parse(`${d}T03:30:00Z`) + 72 * 3_600_000));
    return p;
  };
  for (const d of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) await mk(d, 1000);
  const flop = await mk('2026-10-14', 200, 'The flop');
  const { incidents } = await collectIncidents(new Date('2026-09-01'));
  const hit = incidents.filter((i) => i.category === 'underperformed');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].pack, 'social-post');
  assert.match(hit[0].text, /"The flop" on x did 0\.2× your usual at 3d/);
  assert.ok(await getPost(flop.id));
});

test('packs get the copy findings for their channel; nothing until there is data', async () => {
  const { pulseBrief } = await import('@shipcast/engine');
  const book = { computedAt: '', channels: [{ channel: 'linkedin', n: 20, ready: true, wins: [{ feature: 'hook', level: 'question', label: 'LinkedIn · question hook: 1.5× your usual (8 posts, medium confidence)' }, { feature: 'format', level: 'carousel', label: 'LinkedIn · Carousel: 1.8×' }], losses: [{ feature: 'hashtags', level: '6+', label: 'LinkedIn · 6+ hashtags: 0.6× your usual (5 posts, low confidence)' }], heat: [], bestSlots: [], narrative: ['Questions start conversations here.'] }] } as any;
  const b = await pulseBrief('carousel', book);
  assert.match(b, /What works for this brand on LinkedIn/);
  assert.match(b, /\+ LinkedIn · question hook/);
  assert.match(b, /- LinkedIn · 6\+ hashtags/);
  assert.ok(!/Carousel: 1\.8/.test(b), 'format findings belong to planning, not to the writer of a fixed format');
  assert.match(b, /Why: Questions start conversations/);
  assert.equal(await pulseBrief('no-such-pack', book), '');
  assert.equal(await pulseBrief('carousel', { computedAt: '', channels: [] } as any), '', 'no findings and no top posts yet');
});
