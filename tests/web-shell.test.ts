import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzy } from '../apps/web/src/match.ts';
import { resolveRoute } from '../apps/web/src/hooks.ts';

test('old hash routes land on the new places', () => {
  const r = (h: string) => resolveRoute(h.split('/').filter(Boolean)).join('/');
  assert.equal(r(''), 'new');
  assert.equal(r('new'), 'new');
  assert.equal(r('trending'), 'ideas');
  assert.equal(r('voice'), 'brand');
  assert.equal(r('learning'), 'insights');
  assert.equal(r('setup'), 'settings/connections');
  assert.equal(r('skills'), 'settings/skills');
  assert.equal(r('settings'), 'settings/connections');
  assert.equal(r('settings/agents'), 'settings/agents');
  assert.equal(r('settings/nope'), 'settings/connections');
  assert.equal(r('c/abc'), 'c/abc');
  assert.equal(r('library'), 'library');
  assert.equal(r('calendar'), 'calendar');
});

test('palette matching: subsequences match, word starts and runs rank first', () => {
  assert.equal(fuzzy('xyz', 'Library'), null);
  assert.equal(fuzzy('', 'Library'), 0);
  assert.ok(fuzzy('pmm', 'Plan my month') !== null);
  assert.ok(fuzzy('lib', 'Library')! > fuzzy('lib', 'Bun launch library kit')!);
  assert.ok(fuzzy('set', 'Settings')! > fuzzy('set', 'Reset the rest')!);
  assert.ok(fuzzy('cal', 'Calendar')! > fuzzy('cal', 'Vertical clips')!);
});
