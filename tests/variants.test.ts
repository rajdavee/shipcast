import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'variants-'));
const { applyHook, HOOK_TARGET } = await import('@shipcast/engine');

test('a hook patch replaces only the opening and leaves the rest identical', () => {
  const story = { preset: 'vertical', scenes: [{ scene: 'title', fields: { title: 'Old' }, vo: 'old', duration: 3 }, { scene: 'product', fields: { image: 'a.png' }, vo: 'same' }] };
  const v = applyHook(story, { name: 'pain', angle: 'pain', hook: 'x', patch: { scenes: { '0': { scene: 'statement', fields: { text: 'New *hook*' }, vo: 'new', duration: 3 } } } }, HOOK_TARGET.storyboard!.field);
  assert.equal(v.scenes[0].scene, 'statement');
  assert.deepEqual(v.scenes[1], story.scenes[1], 'later scenes untouched');
  assert.equal(story.scenes[0].scene, 'title', 'base not mutated');
});

test('post patches merge fields; out-of-range or junk indexes are ignored; top-level overrides apply', () => {
  const g = { items: [{ type: 'card', layout: 'big', fields: { headline: 'A', sub: 'keep' } }, { type: 'card', layout: 'big', fields: { headline: 'B' } }] };
  const v = applyHook(g, { name: 'stat', angle: 'stat', hook: 'x', patch: { items: { '0': { fields: { headline: 'A2' } }, '7': { fields: { headline: 'nope' } }, x: {} } } }, HOOK_TARGET.graphics!.field);
  assert.deepEqual(v.items[0].fields, { headline: 'A2', sub: 'keep' });
  assert.equal(v.items.length, 2);
  const e = applyHook({ theme: 'light', emails: [{ name: 'L', subjects: ['a'], preheader: 'p', blocks: [] }] }, { name: 'q', angle: 'curiosity', hook: 'x', patch: { emails: { '0': { subjects: ['b', 'c'] } }, theme: 'brand' } }, 'emails');
  assert.deepEqual(e.emails[0].subjects, ['b', 'c']);
  assert.equal(e.emails[0].preheader, 'p');
  assert.equal(e.theme, 'brand');
});
