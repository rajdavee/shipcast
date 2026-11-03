import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'shipcast-seed-pulse-'));
process.env.SHIPCAST_HOME = home;
const { checkHome, seedPulse, SAMPLE_PREFIX, slidePng, blankPdf } = await import('../tools/seed-pulse.ts');
const { listPosts, readSnapshots, readPlaybook, forecastCalibration, pendingNumbers } = await import('../services/engine/src/index.ts');
after(() => rmSync(home, { recursive: true, force: true }));

test('seed-pulse refuses the real home unless forced', () => {
  assert.throws(() => checkHome(join(homedir(), '.shipcast')), /Refusing/);
  assert.throws(() => checkHome(`${homedir()}/.shipcast/`), /Refusing/);
  assert.equal(checkHome(join(homedir(), '.shipcast'), true), join(homedir(), '.shipcast'));
  assert.equal(checkHome(home), home);
});

test('seed-pulse plants effects the playbook recovers, labels everything Sample, and re-runs in place', async () => {
  const now = new Date('2026-11-04T10:00:00Z');
  const r = await seedPulse({ home, now, seed: 7 });
  const posts = await listPosts();
  assert.ok(posts.length >= 60 && posts.length <= 110, `${posts.length} posts`);
  assert.ok(posts.every((p) => p.title.startsWith(SAMPLE_PREFIX)), 'every title says Sample');
  const published = posts.filter((p) => p.status === 'published');
  assert.equal(published.length, r.published);
  for (const ch of ['linkedin', 'instagram', 'youtube']) assert.ok(published.some((p) => p.channels[0].channel === ch), ch);
  assert.ok(published.every((p) => Date.parse(p.at!) < now.getTime() && Date.parse(p.at!) > now.getTime() - 91 * 86_400_000));
  const upcoming = posts.filter((p) => p.status !== 'published');
  assert.ok(upcoming.length >= 5 && upcoming.every((p) => Date.parse(p.at!) > now.getTime()));
  assert.ok(upcoming.some((p) => p.experiment?.startsWith('Experiment:')));
  const snaps = await readSnapshots();
  assert.ok(snaps.every((s) => Date.parse(s.at) <= now.getTime()), 'no reading from the future');

  const pb = (await readPlaybook())!;
  const li = pb.channels.find((c) => c.channel === 'linkedin')!;
  const ig = pb.channels.find((c) => c.channel === 'instagram')!;
  assert.ok(li.ready && ig.ready);
  assert.equal(li.wins[0].level, 'pdf-carousel', 'top LinkedIn win is the PDF carousel');
  assert.ok(li.losses.some((f) => f.level === 'text-only'), 'text-only loses on LinkedIn');
  assert.ok(ig.wins.slice(0, 3).some((f) => f.level === 'image-carousel'), 'photo carousels win on Instagram');
  assert.equal(pb.channels.find((c) => c.channel === 'youtube')?.ready ?? false, false, 'a few YouTube videos are not enough for a playbook');

  const cal = await forecastCalibration();
  assert.ok(cal.n >= 5, 'held-out posts were forecast before their numbers came in');
  assert.ok((await pendingNumbers(now)).length >= 1, 'some numbers are still wanted');

  // A second run replaces the sample instead of doubling it.
  const again = await seedPulse({ home, now, seed: 7 });
  assert.equal((await listPosts()).length, posts.length);
  assert.equal((await readSnapshots()).length, again.snapshots);
});

test('sample media are real files: a valid PNG and a PDF whose pages can be counted', () => {
  const png = slidePng(200, 20, 25);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 20);
  assert.equal((blankPdf(6).match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length, 6);
});
