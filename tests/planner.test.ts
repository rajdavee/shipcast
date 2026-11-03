import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'plan-'));
process.env.SHIPCAST_HOME = home;
const { planSlots, planMonth, mediaFor, syncMadePosts, savePlan, savePost, getPost, createCampaign, campaignDir, updateCampaign } = await import('@shipcast/engine');

const plan = { tz: 'Asia/Kolkata', pillars: [{ name: 'Teach', share: 60 }, { name: 'Show', share: 40 }], cadence: { linkedin: { perWeek: 3, slots: ['Tue 09:00', 'Thu 09:00'] }, instagram: { perWeek: 1, slots: ['Wed 18:00'] } } };

test('slots follow the cadence exactly, fill missing weekdays, convert time zones and skip taken days', () => {
  // 2026-11-02 is a Monday; one week.
  const s = planSlots(plan, '2026-11-02', '2026-11-09');
  assert.deepEqual(s.map((x) => `${x.channel} ${x.date} ${x.time}`), ['linkedin 2026-11-02 09:00', 'linkedin 2026-11-03 09:00', 'instagram 2026-11-04 18:00', 'linkedin 2026-11-05 09:00']);
  assert.equal(s[1].at, '2026-11-03T03:30:00.000Z');
  assert.deepEqual(s.map((x) => x.i), [0, 1, 2, 3]);
  const taken = [{ id: 'x', title: '', status: 'draft' as const, tz: 'Asia/Kolkata', at: '2026-11-03T03:30:00.000Z', channels: [{ channel: 'linkedin' as const, caption: '', hashtags: [], media: [], via: 'manual' as const }], notes: '', createdAt: '', updatedAt: '' }];
  assert.equal(planSlots(plan, '2026-11-02', '2026-11-09', taken).length, 3);
});

test('plan my month fills slots from one call, keeps formats and pillars valid, ignores junk', async () => {
  await savePlan(plan);
  let prompt = '';
  const ask = async (p: string) => {
    prompt = p;
    return JSON.stringify([
      { slot: 0, title: 'The 3-minute launch checklist', pillar: 'Teach', format: 'carousel', hook: 'Shipped? Do these 3 things.', caption: 'Shipped? Do these 3 things.\n\n1…', firstComment: 'Repo: https://github.com/x/y', hashtags: ['#launch', '#a', '#b', '#c', '#d', '#e', '#f'] },
      { slot: 2, title: 'Before/after reel', pillar: 'Nope', format: 'not-a-format', caption: 'x' },
      { slot: 2, title: 'duplicate slot' },
      { slot: 99, title: 'no such slot' },
    ]);
  };
  const r = await planMonth({ from: '2026-11-02', to: '2026-11-09', ask });
  assert.equal(r.slots, 4);
  assert.equal(r.created.length, 2);
  assert.equal(r.skipped, 2);
  assert.match(prompt, /1\. LinkedIn — Tue 2026-11-03 09:00/);
  assert.match(prompt, /Teach — 60%/);
  const [a, b] = r.created;
  assert.equal(a.status, 'draft');
  assert.equal(a.format, 'carousel');
  assert.equal(a.channels[0].hashtags.length, 5, 'hashtags capped to the channel');
  assert.equal(a.channels[0].firstComment, 'Repo: https://github.com/x/y');
  assert.equal(b.format, 'photo-carousel', 'unknown format falls back to the channel default');
  assert.equal(b.pillar, undefined);
  // Planning again only fills what's left.
  const again = await planMonth({ from: '2026-11-02', to: '2026-11-09', ask: async () => '[]' });
  assert.equal(again.slots, 2);
});

test('made deliverables attach the right files per channel, and the post becomes ready', async () => {
  const c = await createCampaign({ name: 'P', source: { type: 'url', value: 'https://p.test' }, goal: '', audience: '', tone: '', notes: '', steps: [{ id: 'brief', kind: 'brief', options: {}, status: 'done', outputs: [], revisions: [] }, { id: 'd1', kind: 'pack', pack: 'carousel', options: {}, status: 'running', outputs: [], revisions: [] }] });
  const out = join(campaignDir(c.id), 'deliverables', 'd1', 'out');
  mkdirSync(join(out, 'slides'), { recursive: true });
  for (const f of ['slides/slide-01.png', 'slides/slide-02.png', 'carousel.pdf', 'contact.sheet.jpg', 'carousel.mp4']) writeFileSync(join(out, f), 'x');
  const p = await savePost({ title: 't', at: '2026-11-20T03:30:00Z', campaign: c.id, step: 'd1', channels: [{ channel: 'linkedin', caption: 'c', hashtags: [], media: [], via: 'manual' }, { channel: 'instagram', caption: 'c', hashtags: [], media: [], via: 'manual' }] });
  assert.equal(await syncMadePosts(), 0, 'nothing attaches while it is still being made');
  await updateCampaign(c.id, (x) => void (x.steps[1].status = 'done'));
  assert.equal(await syncMadePosts(), 1);
  const q = (await getPost(p.id))!;
  assert.equal(q.status, 'ready');
  assert.deepEqual(q.channels[0].media.map((m) => m.split('/').pop()), ['carousel.pdf'], 'LinkedIn gets the PDF carousel');
  assert.deepEqual(q.channels[1].media.map((m) => m.split('/').pop()), ['slide-01.png', 'slide-02.png'], 'Instagram gets the slides, not the sheet or the music video');
  assert.ok(!q.channels[0].media[0].startsWith('/'), 'paths are relative to the Shipcast home');
  assert.deepEqual(await mediaFor(join(campaignDir(c.id), 'deliverables', 'd1'), 'youtube'), [], 'a carousel has no video for YouTube');
});
