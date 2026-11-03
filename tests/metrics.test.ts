import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'metrics-'));
const { savePost, addSnapshot, readSnapshots, deleteSnapshot, bucketOf, weightedEngagement, engagementRate, computePerformance, headline, importMetricsCsv, postPerformance } = await import('@shipcast/engine');

const sent = (d: string, ch: 'linkedin' | 'instagram' = 'linkedin', url?: string) =>
  savePost({ title: `post ${d}`, at: `${d}T03:30:00.000Z`, status: 'published', channels: [{ channel: ch, caption: 'x', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: `${d}T03:30:00.000Z`, ...(url ? { url } : {}) }] });
const plus = (d: string, h: number) => new Date(Date.parse(`${d}T03:30:00.000Z`) + h * 3_600_000);

test('ages fall into comparable buckets', () => {
  assert.equal(bucketOf(2), null);
  assert.equal(bucketOf(20), '1d');
  assert.equal(bucketOf(80), '3d');
  assert.equal(bucketOf(150), '7d');
  assert.equal(bucketOf(38), null, 'between 1 and 3 days is neither');
  assert.equal(bucketOf(2000), '30d');
});

test('engagement is weighted by intent and read against reach', () => {
  assert.equal(weightedEngagement({ likes: 10, comments: 2, shares: 1, saves: 1 }), 10 + 4 + 3 + 3);
  assert.equal(weightedEngagement({ impressions: 100 }), undefined);
  assert.equal(engagementRate({ reach: 1000, impressions: 5000, likes: 50 }), 0.05, 'reach beats impressions as the denominator');
});

test('snapshots: platform number formats, age from the sent time, one per source per age, and guards', async () => {
  const p = await sent('2026-10-01');
  const s = await addSnapshot({ post: p.id, channel: 'linkedin', source: 'manual', impressions: '1.2K' as any, likes: '3,410' as any, avgViewPct: '140%' as any }, plus('2026-10-01', 24));
  assert.equal(s.impressions, 1200);
  assert.equal(s.likes, 3410);
  assert.equal(s.avgViewPct, 100);
  assert.equal(s.ageHours, 24);
  await addSnapshot({ post: p.id, channel: 'linkedin', source: 'manual', impressions: 1500 }, plus('2026-10-01', 26));
  assert.equal((await readSnapshots()).filter((x) => x.post === p.id).length, 1, 'a second manual read at 1 day replaces the first');
  await assert.rejects(addSnapshot({ post: p.id, channel: 'linkedin', source: 'manual' }, plus('2026-10-01', 30)), /no numbers/);
  await assert.rejects(addSnapshot({ post: p.id, channel: 'instagram', source: 'manual', likes: 1 }), /no instagram/);
  await assert.rejects(addSnapshot({ post: p.id, channel: 'linkedin', source: 'manual', likes: 1 }, new Date('2026-09-01')), /hasn't gone out/);
  const id = (await readSnapshots())[0].id;
  assert.ok(await deleteSnapshot(id));
});

test('lift is against your usual on the same channel at the same age, and needs enough history', async () => {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
  const reach = [1000, 1200, 800, 1000, 3000];
  const ps: Awaited<ReturnType<typeof sent>>[] = [];
  for (const [i, d] of days.entries()) {
    const p = await sent(d);
    ps.push(p);
    await addSnapshot({ post: p.id, channel: 'linkedin', source: 'manual', reach: reach[i], likes: reach[i] / 20 }, plus(d, 72));
  }
  // An Instagram post doesn't join LinkedIn's baseline.
  const ig = await sent('2026-10-06', 'instagram');
  await addSnapshot({ post: ig.id, channel: 'instagram', source: 'manual', reach: 99_999, likes: 5000 }, plus('2026-10-06', 72));
  const perf = computePerformance(await readSnapshots());
  const star = perf.find((x) => x.post === ps[4].id && x.bucket === '3d')!;
  assert.equal(star.baselineN, 4);
  assert.equal(star.liftAudience, 3, '3000 vs a median of 1000');
  assert.equal(star.lift, 3);
  assert.equal(perf.find((x) => x.post === ig.id)!.lift, undefined, 'one Instagram post has no usual to compare with');
  assert.equal(headline(perf, ps[4].id, 'linkedin')?.bucket, '3d');
  const pp = await postPerformance(ps[4].id);
  assert.equal(pp.snapshots.length, 1);
});

test('CSV import matches rows by URL, by id, or by channel and day; reports what it could not place', async () => {
  const a = await sent('2026-10-20', 'linkedin', 'https://www.linkedin.com/feed/update/urn:li:activity:111/');
  const b = await sent('2026-10-21', 'linkedin');
  const csv = [
    'Post URL,Post publish date,Impressions,Reactions,Comments,Reposts',
    'https://www.linkedin.com/feed/update/urn:li:activity:111?utm=x,2026-10-20,"4,200",120,14,6',
    ',2026-10-21,900,20,1,0',
    'https://www.linkedin.com/feed/update/urn:li:activity:999/,2026-09-01,10,1,0,0',
  ].join('\n');
  const r = await importMetricsCsv(csv, 'linkedin', new Date('2026-10-27T03:30:00Z'));
  assert.equal(r.saved, 2);
  assert.equal(r.unmatched.length, 1);
  const sa = (await readSnapshots()).find((s) => s.post === a.id)!;
  assert.equal(sa.impressions, 4200);
  assert.equal(sa.likes, 120);
  assert.equal(sa.shares, 6);
  assert.equal(sa.source, 'csv');
  assert.ok((await readSnapshots()).some((s) => s.post === b.id));
});

test('snapshot writes from two processes never lose each other', async () => {
  const { spawn } = await import('node:child_process');
  const p = await sent('2026-10-25');
  const script = `const { addSnapshot } = await import('@shipcast/engine'); const ch = process.argv[1]; for (let i = 0; i < 12; i++) await addSnapshot({ post: '${p.id}', channel: 'linkedin', source: ch, likes: i + 1 }, new Date(Date.parse('2026-10-25T03:30:00Z') + (24 + i * 60) * 3600000));`;
  const run = (src: string) => new Promise<number>((r) => spawn(process.execPath, ['--input-type=module', '-e', script, src], { env: process.env, stdio: 'inherit' }).on('exit', (c) => r(c ?? 1)));
  assert.deepEqual(await Promise.all([run('manual'), run('screenshot')]), [0, 0]);
  const mine = (await readSnapshots()).filter((s) => s.post === p.id);
  assert.equal(mine.filter((s) => s.source === 'manual').length, mine.filter((s) => s.source === 'screenshot').length, 'both writers kept every bucket');
  assert.ok(mine.length >= 6);
});
