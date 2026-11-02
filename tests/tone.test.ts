import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'tone-'));
const { DEFAULT_TONE, normalizeTone, toneBrief, scoreText, applyLexicon, readingGrade, saveTone, getTone, listTones, deleteTone, outputText, forChannel } = await import('@shipcast/engine');

test('profiles normalize anything into a complete, clamped profile', () => {
  const p = normalizeTone({ name: 'Acme', sliders: { formalCasual: 400, humor: -3 }, emoji: 'lots', lexicon: { banned: ['cheap'], preferred: { client: 'partner' } }, readingLevel: 'phd' });
  assert.equal(p.sliders.formalCasual, 100);
  assert.equal(p.sliders.humor, 0);
  assert.equal(p.emoji, DEFAULT_TONE.emoji, 'unknown enum falls back');
  assert.equal(p.readingLevel, DEFAULT_TONE.readingLevel);
  assert.deepEqual(p.lexicon.banned, ['cheap']);
  assert.equal(p.lexicon.preferred.client, 'partner');
});

test('the brief for Claude carries sliders, lexicon, claims and channel notes', () => {
  const p = normalizeTone({ name: 'Acme', lexicon: { banned: ['synergy'], preferred: { client: 'partner' } }, claims: { allowedStats: ['40% faster setup'], forbidden: ['#1'], requireSource: true } });
  const b = toneBrief(p, 'linkedin');
  assert.match(b, /Brand voice: Acme \(for linkedin\)/);
  assert.match(b, /"synergy"/);
  assert.match(b, /"partner" not "client"/);
  assert.match(b, /40% faster setup/);
  assert.match(b, /Professional, insight first/, 'channel note from defaults');
  assert.equal(forChannel(p, 'tiktok').emoji, 'native');
});

test('brand score catches banned words, forbidden claims, unsourced stats, hashtags and emoji', () => {
  const p = normalizeTone({ claims: { allowedStats: ['40%'], forbidden: ['guaranteed'], requireSource: true } });
  const bad = scoreText('Unlock seamless synergy! Guaranteed results, 3x faster and 40% cheaper. We are the best platform ever!!! 🚀🚀🚀 #a #b #c #d #e', p, 'linkedin');
  const rules = bad.issues.map((i) => i.rule);
  for (const r of ['banned', 'claim', 'unsourced', 'hashtags', 'emoji']) assert.ok(rules.includes(r as any), `${r} in ${rules}`);
  assert.ok(!bad.issues.some((i) => i.match === '40%'), 'approved stat is fine');
  assert.ok(bad.score < 50);
  const good = scoreText('Invoices go out in one click. Payments land in your account two days sooner, and your team stops chasing them by email.', p, 'linkedin');
  assert.equal(good.issues.length, 0, JSON.stringify(good.issues));
  assert.equal(good.score, 100);
});

test('lexicon swaps and reading grade', () => {
  const p = normalizeTone({ lexicon: { preferred: { client: 'partner' }, banned: [] } });
  assert.equal(applyLexicon('Every client and Client gets a call.', p), 'Every partner and partner gets a call.');
  assert.ok(readingGrade('The cat sat on the mat. It was happy.').grade < 4);
  assert.ok(readingGrade('Comprehensive organizational transformation necessitates multidimensional stakeholder considerations.').grade > 14);
});

test('profiles save, list, load and delete; default always exists', async () => {
  const saved = await saveTone({ name: 'Veracy Calm', sliders: { formalCasual: 30 } });
  assert.equal(saved.id, 'veracy-calm');
  assert.equal((await getTone('veracy-calm'))?.sliders.formalCasual, 30);
  const ids = (await listTones()).map((t) => t.id);
  assert.deepEqual(ids, ['default', 'veracy-calm']);
  const edited = await saveTone({ id: 'veracy-calm', humor: 1, sliders: { humor: 5 } });
  assert.equal(edited.sliders.formalCasual, 30, 'edits keep untouched fields');
  await deleteTone('veracy-calm');
  assert.equal(await getTone('veracy-calm'), null);
  assert.equal((await getTone('default'))?.id, 'default');
  assert.equal(await getTone('../etc'), null);
});

test('output text gathers copy from md, txt and spec JSON but not paths or settings', async () => {
  const out = mkdtempSync(join(tmpdir(), 'out-'));
  writeFileSync(join(out, 'caption.md'), 'Ship faster with fewer meetings.');
  writeFileSync(join(out, 'NOTES.md'), 'internal notes about synergy');
  writeFileSync(join(out, 'deck.json'), JSON.stringify({ slides: [{ layout: 'cover big', fields: { title: 'Two documents disagree', image: 'assets/a b.png', body: 'Veracy holds the payment.' } }] }));
  const t = await outputText(out);
  assert.match(t, /Ship faster/);
  assert.match(t, /Two documents disagree/);
  assert.ok(!t.includes('synergy'), 'NOTES skipped');
  assert.ok(!t.includes('assets/a b.png') && !t.includes('cover big'), 'paths and layout ids skipped');
});

test('a voice learned from scratch never overwrites the default', async () => {
  const { saveTone, getTone, DEFAULT_TONE } = await import('@shipcast/engine');
  const learned = { ...DEFAULT_TONE, id: '', name: 'Heard Voice', description: 'heard' };
  const saved = await saveTone(learned);
  assert.equal(saved.id, 'heard-voice');
  assert.equal((await getTone('default'))?.name, DEFAULT_TONE.name);
});

test('placeholders are errors', async () => {
  const { scoreText, DEFAULT_TONE } = await import('@shipcast/engine');
  const r = scoreText('Book a walkthrough at [URL to confirm]. Pricing TBD. Call {{name}} today about the product we built.', DEFAULT_TONE);
  assert.equal(r.issues.filter((i) => i.rule === 'placeholder').length, 3);
  assert.equal(scoreText('See [1] for the source; we cite every number in the report body here.', DEFAULT_TONE).issues.filter((i) => i.rule === 'placeholder').length, 0, 'citations are fine');
});

test('ordinary words are not superlative claims', async () => {
  const { scoreText, DEFAULT_TONE } = await import('@shipcast/engine');
  assert.equal(scoreText('Open the first screen, then the first card on the Docket. It is the only matter open today.', DEFAULT_TONE).issues.filter((i) => i.rule === 'claim').length, 0);
  assert.equal(scoreText('We are the best platform and industry-leading in every way you can imagine here.', DEFAULT_TONE).issues.filter((i) => i.rule === 'claim').length, 2);
});

test('cited numbers and acronyms are not flagged; shouting is', async () => {
  const { scoreText, DEFAULT_TONE } = await import('@shipcast/engine');
  const r = scoreText('Gen Z trust fell to 10% ([Wealth Professional](https://x.test)).\nKPMG, SIFMA and FINRA all agree on the direction of travel here.\nSource: Deloitte, 21% mature.', DEFAULT_TONE);
  assert.equal(r.issues.filter((i) => i.rule === 'unsourced' || i.rule === 'caps').length, 0, JSON.stringify(r.issues));
  assert.equal(scoreText('Get it FREE today, it is the deal of the year for every single team.', DEFAULT_TONE).issues.filter((i) => i.rule === 'caps').length, 1);
  assert.equal(scoreText('Our product is 3x faster than anything else you have tried this year.', DEFAULT_TONE).issues.filter((i) => i.rule === 'unsourced').length, 1);
});

test('bracketed "replace before sending" notes are placeholders', async () => {
  const { scoreText, DEFAULT_TONE } = await import('@shipcast/engine');
  assert.equal(scoreText('Veracy, [Veracy postal address: replace before sending], Panama. Thanks for reading our launch note today.', DEFAULT_TONE).issues.filter((i) => i.rule === 'placeholder').length, 1);
});
