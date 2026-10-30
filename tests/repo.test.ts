import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_DIR } from '@shipcast/engine';

test('plugin skills have frontmatter with name + description', () => {
  const dir = join(PLUGIN_DIR, 'skills');
  const skills = readdirSync(dir);
  assert.ok(skills.length >= 4);
  for (const s of skills) {
    const head = readFileSync(join(dir, s, 'SKILL.md'), 'utf8').split('---')[1] ?? '';
    assert.match(head, new RegExp(`\\nname: ${s}\\n`), s);
    assert.match(head, /\ndescription: .{40,}/, s);
  }
});
