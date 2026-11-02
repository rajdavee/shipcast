import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'gen-'));
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_GEN_FAKE = '1';
const { route, guard, compileShot, generate, planGeneration, MODELS } = await import('@shipcast/gen');
const { checkBudget, record } = await import('../services/gen/src/router.ts');

const hosted = ['fal', 'replicate'] as const;

test('the router picks by capability, needs and tier, and honours an explicit model', () => {
  assert.equal(route({ capability: 'i2v', tier: 'premium', providers: [...hosted] })[0].quality, 5);
  assert.equal(route({ capability: 'i2v', tier: 'draft', providers: [...hosted] })[0].id, 'ltx23-i2v', 'draft favours cheap and fast');
  assert.ok(route({ capability: 'i2v', lastFrame: true, providers: [...hosted] }).every((m) => m.inputs.lastFrame));
  assert.ok(route({ capability: 's2v', audio: true, providers: [...hosted] }).length >= 2);
  assert.equal(route({ capability: 't2i', model: 'flux2-pro', providers: [...hosted] })[0].id, 'flux2-pro');
  assert.throws(() => route({ capability: 'i2v', model: 'flux2-pro', providers: [...hosted] }), /does t2i/);
  assert.equal(route({ capability: 't2i', providers: ['fake'] })[0].provider, 'fake');
  assert.ok(MODELS.filter((m) => m.provider !== 'fake').every((m) => m.commercialOK), 'registry defaults to commercially usable models');
});

test('the guard refuses sexual content, look-alikes, public figures and real faces without consent', () => {
  assert.equal(guard({ prompt: 'a nude portrait' }).ok, false);
  assert.equal(guard({ prompt: 'face swap our CEO onto the actor' }).ok, false);
  assert.match(guard({ prompt: 'Elon Musk holding our app' }).reason ?? '', /public figure/);
  assert.equal(guard({ prompt: 'a woman at a desk', realPerson: true }).ok, false);
  assert.equal(guard({ prompt: 'a woman at a desk', realPerson: true, consent: 'c-123' }).ok, true);
  const ok = guard({ prompt: 'a finance officer in her 40s reading a document' });
  assert.ok(ok.ok && ok.disclose?.includes('synthetic person'));
});

test('shots compile to literal camera language within each model budget', () => {
  const shot = { subject: 'a finance officer in her 40s holding a tablet', motion: 'looks up and smiles slightly', scene: 'a quiet oak-panelled office', framing: 'medium close-up, subject left third', camera: { move: 'static' as const, lens: '85mm' as const, aperture: 'f/2.8' as const }, light: 'window', look: 'photoreal' };
  const v = compileShot(shot, { promptWords: 200, capability: 'i2v' });
  assert.match(v.prompt, /no camera movement at all/);
  assert.match(v.prompt, /85mm portrait lens/);
  assert.match(v.negative, /extra fingers/);
  const still = compileShot(shot, { promptWords: 200, capability: 't2i' });
  assert.ok(!/smiles slightly|camera movement/.test(still.prompt), 'stills drop motion');
  assert.ok(compileShot(shot, { promptWords: 20, capability: 'i2v' }).prompt.split(/\s+/).length <= 20);
});

test('generate runs end to end on the free placeholder, caches retakes and writes a disclosure sidecar', async () => {
  const img = await generate({ capability: 't2i', shot: { subject: 'a person reading', look: 'photoreal' }, aspect: '16:9', out: join(home, 'c1', 'hero') });
  assert.ok(existsSync(img.file) && img.file.endsWith('.png'));
  assert.equal(img.usd, 0);
  const meta = JSON.parse(readFileSync(`${img.file}.json`, 'utf8'));
  assert.deepEqual(meta.disclosure, ['AI-generated', 'synthetic person']);
  const again = await generate({ capability: 't2i', shot: { subject: 'a person reading', look: 'photoreal' }, aspect: '16:9', out: join(home, 'c1', 'hero-2') });
  assert.equal(again.cached, true);
  const clip = await generate({ capability: 'i2v', prompt: 'slow push in', image: img.file, seconds: 2, out: join(home, 'c1', 'clip') });
  assert.ok(clip.file.endsWith('.mp4') && existsSync(clip.file));
  await assert.rejects(generate({ capability: 't2i', prompt: 'nude', out: join(home, 'c1', 'x') }), /explicit/);
  await assert.rejects(generate({ capability: 't2i', prompt: 'x', out: '/tmp/outside' }), /must be inside/);
  const plan = await planGeneration({ capability: 'i2v', tier: 'premium', provider: 'fal', seconds: 5 });
  assert.ok(plan.usd > 0.4 && plan.alternatives.length >= 1, 'plans with real prices before spending');
});

test('budgets refuse spend over the per-project and monthly caps', async () => {
  await record('camp-1', 'kling3-i2v', 4.5);
  await assert.rejects(checkBudget('camp-1', 1, { perKey: 5, perMonth: 25 }), /over its \$5\.00 cap/);
  await checkBudget('camp-2', 1, { perKey: 5, perMonth: 25 });
  await record('camp-2', 'kling3-i2v', 20);
  await assert.rejects(checkBudget('camp-3', 1, { perKey: 5, perMonth: 25 }), /monthly cap/);
  writeFileSync(join(home, 'touch'), '');
});

test('takes: three alternatives of one shot with different seeds, video takes get posters, budgeted as a set', async () => {
  const { generateTakes } = await import('../services/gen/src/index.ts');
  const r = await generateTakes({ capability: 'i2v', prompt: 'slow push on a desk', seconds: 1, takes: 3, out: join(home, 'c9', 'hero') });
  assert.equal(r.takes.length, 3);
  assert.deepEqual(r.takes.map((t: any) => t.file.match(/-t(\d)\.mp4$/)?.[1]), ['1', '2', '3']);
  for (const t of r.takes) assert.ok(t.poster && existsSync(t.poster), 'poster frame');
  await record('c-takes', 'kling3-i2v', 4.9);
  await assert.rejects(generateTakes({ capability: 'i2v', prompt: 'x', seconds: 5, takes: 3, provider: 'fal', budgetKey: 'c-takes', out: join(home, 'c9', 'y') }), /cap/);
});
