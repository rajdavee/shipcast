import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'golden-'));
process.env.SHIPCAST_HOME = home;
const { runGolden, createCampaign, readCampaign, updateCampaign, readEvals, campaignDir, nextGoldenPacks, GOLDEN_PACKS } = await import('@shipcast/engine');

test('rotation skips nothing and wraps around', async () => {
  const a = await nextGoldenPacks(0, 2);
  assert.deepEqual(a.packs, GOLDEN_PACKS.slice(0, 2));
  const b = await nextGoldenPacks(GOLDEN_PACKS.length - 1, 2);
  assert.deepEqual(b.packs, [GOLDEN_PACKS.at(-1), GOLDEN_PACKS[0]]);
  assert.equal(b.next, 1);
});

test('the quality check sets itself up from your latest product, waits, scores, and moves on', async () => {
  assert.match((await runGolden()).summary, /first finished project/);
  await createCampaign({ name: 'Acme', source: { type: 'url', value: 'https://acme.test' }, goal: 'g', audience: 'a', tone: '', notes: '', steps: [{ id: 'brief', kind: 'brief', options: {}, status: 'done', outputs: [], revisions: [] }] });

  const setup = await runGolden();
  assert.match(setup.summary, /Set up the quality-check project from Acme; making carousel and social-post/);
  assert.equal(setup.nextInMinutes, 30);
  const { campaignId } = JSON.parse((await import('node:fs')).readFileSync(join(home, 'agents', 'golden.json'), 'utf8'));
  let c = (await readCampaign(campaignId))!;
  assert.equal(c.name, 'Quality check');
  assert.equal(c.source.value, 'https://acme.test');
  assert.deepEqual(c.steps.map((s) => s.pack ?? s.kind), ['brief', 'carousel', 'social-post']);

  assert.match((await runGolden()).summary, /Researching/);

  // Brief and both pieces finish; give them something to look at.
  await updateCampaign(campaignId, (x) => x.steps.forEach((s) => (s.status = 'done')));
  for (const s of c.steps.filter((s) => s.kind === 'pack')) {
    const out = join(campaignDir(campaignId), 'deliverables', s.id, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'contact-sheet.jpg'), 'x');
  }
  const scores = { realism: 3, fidelity: 4, brand: 4, hook: 4, layout: 3, legibility: 4, artefacts: 4 };
  const r = await runGolden({ judgeFn: async () => ({ scores, notes: '', fix: 'bigger type' }) as any });
  assert.match(r.summary, /carousel 3\.71 · social-post 3\.71; next: presentation and document/);
  const ev = await readEvals();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].golden, true);
  assert.deepEqual(ev[0].pieces.map((p) => p.pack), ['carousel', 'social-post']);
  c = (await readCampaign(campaignId))!;
  assert.deepEqual(c.steps.map((s) => s.pack ?? s.kind), ['brief', 'presentation', 'document'], 'scored pieces are dropped, the next pair queued');
});
