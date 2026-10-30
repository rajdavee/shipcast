import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './exec.ts';
import type { SkillDep } from './types.ts';

/** Folders where Claude Code (and the `skills` CLI) put user-level skills. */
export function skillRoots(): string[] {
  const h = homedir();
  return [join(h, '.claude/skills'), join(h, '.agents/skills')];
}

export function isSkillInstalled(name: string): boolean {
  return skillRoots().some((r) => existsSync(join(r, name, 'SKILL.md')));
}

/** Install a third-party skill from its own repository with the `skills` CLI. */
export async function installSkill(dep: SkillDep): Promise<{ ok: boolean; log: string }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(dep.source)) return { ok: false, log: `bad source ${dep.source}` };
  const args = ['-y', 'skills', 'add', dep.source, '-g', '-y', '-a', 'claude-code'];
  if (dep.skill) args.push('--skill', dep.skill);
  const r = await run('npx', args, { timeoutMs: 600_000 });
  return { ok: r.code === 0 && isSkillInstalled(dep.name), log: (r.stdout + r.stderr).slice(-3000) };
}
