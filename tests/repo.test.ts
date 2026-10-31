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

test('skill hub registry entries are pinned, licensed and self-consistent', async () => {
  const { readFile } = await import('node:fs/promises');
  const reg = JSON.parse(await readFile(new URL('../skills/registry.json', import.meta.url), 'utf8'));
  const ids = new Set<string>();
  for (const p of reg.packages) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.match(p.repo, /^[\w.-]+\/[\w.-]+$/, p.id);
    assert.match(p.ref, /^[0-9a-f]{40}$/, `${p.id} must pin a full commit SHA`);
    assert.ok(p.licence, `${p.id} needs a licence (or "none")`);
    assert.ok(p.paths.length > 0);
    const names = p.paths.map((x: string) => p.names?.[x] ?? (x === '.' ? p.id : x.split('/').pop()));
    for (const [role, skill] of Object.entries(p.roles)) assert.ok(names.includes(skill), `${p.id}: role ${role} points at ${skill}, which isn't in paths`);
    assert.ok(p.verdict >= 1 && p.verdict <= 5);
  }
});
