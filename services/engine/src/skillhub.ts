import { cp, mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { home, rootHome, ROOT } from './paths.ts';
import { run } from './exec.ts';

/**
 * Skill Hub — the best upstream Claude skills, mixed and matched per job.
 *
 * The registry (skills/registry.json) lists skill *packages*: one repo, a
 * pinned commit, the skill folders to take, the licence, and the roles they
 * can play (motion, design-taste, diagram, copy…). Packages install from a
 * tarball of that exact commit into ~/.shipcast/skills — never into the
 * user's own ~/.claude — and every enabled skill is bundled into one
 * generated plugin ("hub") that Shipcast passes to each Claude run next to
 * its own. Packs ask for roles; the hub picks the best enabled package for
 * each (or the user's choice) and tells Claude which skill to use.
 */

export interface HubPackage {
  id: string;
  name: string;
  repo: string;
  ref: string;
  /** Skill folders inside the repo (each contains SKILL.md); "." = the repo root is the skill. */
  paths: string[];
  /** path → the skill's frontmatter name, when it differs from the folder name (always for "."). */
  names?: Record<string, string>;
  licence: string;
  area: 'motion' | 'editing' | 'design' | 'diagram' | 'social' | 'brand' | 'story' | 'audio' | 'core';
  /** Roles this package can fill, with the skill to call for each. */
  roles: Record<string, string>;
  summary: string;
  /** 1–5, for professional creators. */
  verdict: number;
  /** Tools, runtimes or API keys the skills assume. */
  needs?: string[];
  stars?: number;
  /** Enabled out of the box (permissive licence, proven useful). */
  default?: boolean;
  /** Added by the user from a URL (not in the curated registry). */
  custom?: boolean;
}

export interface HubState {
  installed: Record<string, { ref: string; at: string }>;
  enabled: Record<string, boolean>;
  /** role → package id the user chose. */
  roles: Record<string, string>;
  /** package id → true once the user accepted a non-permissive licence. */
  accepted: Record<string, boolean>;
}

/** The folder (and skill) name a path installs as. */
export const skillName = (p: HubPackage, path: string) => p.names?.[path] ?? (path === '.' ? p.id : path.split('/').pop()!);

const SAFE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0', 'Unlicense', '0BSD']);
export const isPermissive = (licence: string) => SAFE.has(licence);

const hubDir = () => join(rootHome(), 'skills');
const storeDir = (id: string) => join(hubDir(), 'store', id);
const stateFile = () => join(hubDir(), 'state.json');
/** The generated plugin Claude loads (--plugin-dir). */
export const hubPluginDir = () => join(hubDir(), 'plugin');

const customFile = () => join(hubDir(), 'custom.json');

async function loadCustom(): Promise<HubPackage[]> {
  try {
    return JSON.parse(await readFile(customFile(), 'utf8'));
  } catch {
    return [];
  }
}

export async function loadRegistry(): Promise<HubPackage[]> {
  let curated: HubPackage[] = [];
  try {
    curated = JSON.parse(await readFile(join(ROOT, 'skills', 'registry.json'), 'utf8')).packages;
  } catch {}
  return [...curated, ...(await loadCustom()).map((p) => ({ ...p, custom: true }) as HubPackage)];
}

/**
 * Add any GitHub skill repo (or a folder inside one) as a custom package,
 * pinned to its current commit. Finds every SKILL.md under the path.
 */
export async function addCustomPackage(url: string): Promise<HubPackage> {
  const m = url.trim().match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (!m) throw new Error('Paste a GitHub link like https://github.com/owner/repo or …/tree/main/skills');
  const [, owner, repo, branch, sub] = m;
  const gh = async (p: string) => {
    const r = await fetch(`https://api.github.com/${p}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'shipcast' }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404) throw new Error('That repository or path was not found (private repos are not supported)');
    if (!r.ok) throw new Error(`GitHub said ${r.status}${r.status === 403 ? ' (rate limit — try again in a few minutes)' : ''}`);
    return r.json() as Promise<any>;
  };
  const info = await gh(`repos/${owner}/${repo}`);
  const sha = (await gh(`repos/${owner}/${repo}/commits/${encodeURIComponent(branch ?? info.default_branch)}`)).sha as string;
  const tree = (await gh(`repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)).tree as { path: string }[];
  const prefix = sub ? `${sub.replace(/\/$/, '')}/` : '';
  const skip = /(^|\/)\.(agents|cursor|codex|gemini|opencode|kiro|windsurf|trae|github)\//;
  const dirs = tree
    .map((t) => t.path)
    .filter((p) => /(^|\/)SKILL\.md$/.test(p) && (prefix ? p.startsWith(prefix) || p === `${sub}/SKILL.md` : true) && !skip.test(p))
    .map((p) => (p === 'SKILL.md' ? '.' : p.replace(/\/SKILL\.md$/, '')))
    .slice(0, 40);
  if (!dirs.length) throw new Error('No SKILL.md found there');
  const id = `custom-${owner}-${repo}${sub ? `-${sub.split('/').pop()}` : ''}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60);
  const names: Record<string, string> = {};
  if (dirs.includes('.')) names['.'] = repo.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const pkg: HubPackage = {
    id,
    name: `${repo}${sub ? ` · ${sub.split('/').pop()}` : ''}`,
    repo: `${owner}/${repo}`,
    ref: sha,
    paths: dirs,
    ...(Object.keys(names).length ? { names } : {}),
    licence: info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : 'none',
    area: 'core',
    roles: {},
    summary: info.description || `Skills from ${owner}/${repo}`,
    verdict: 3,
    stars: info.stargazers_count,
  };
  const all = (await loadCustom()).filter((p) => p.id !== id);
  await mkdir(hubDir(), { recursive: true });
  await writeFile(customFile(), JSON.stringify([...all, pkg], null, 2));
  return pkg;
}

export async function removeCustomPackage(id: string): Promise<void> {
  await writeFile(customFile(), JSON.stringify((await loadCustom()).filter((p) => p.id !== id), null, 2));
  await rm(storeDir(id), { recursive: true, force: true });
  const s = await hubState();
  delete s.installed[id];
  delete s.enabled[id];
  await saveState(s);
  await buildHubPlugin();
}

export async function hubState(): Promise<HubState> {
  try {
    return { installed: {}, enabled: {}, roles: {}, accepted: {}, ...JSON.parse(await readFile(stateFile(), 'utf8')) };
  } catch {
    return { installed: {}, enabled: {}, roles: {}, accepted: {} };
  }
}

async function saveState(s: HubState) {
  await mkdir(hubDir(), { recursive: true });
  await writeFile(stateFile(), JSON.stringify(s, null, 2));
}

export const isEnabled = (p: HubPackage, s: HubState) => s.enabled[p.id] ?? !!p.default;
/** Built-in packages ship with Shipcast's own plugin (repo "local"); they are always installed. */
export const isLocal = (p: HubPackage) => p.repo === 'local';
export const isInstalled = (p: HubPackage, s: HubState) => isLocal(p) || (s.installed[p.id]?.ref === p.ref && existsSync(storeDir(p.id)));

/** Download the pinned commit and keep only the package's skill folders. */
export async function installPackage(id: string, opts: { acceptLicence?: boolean } = {}): Promise<{ ok: boolean; log: string }> {
  const pkg = (await loadRegistry()).find((p) => p.id === id);
  if (!pkg) return { ok: false, log: `unknown skill package ${id}` };
  if (isLocal(pkg)) return { ok: true, log: `${pkg.name} is built in` };
  const state = await hubState();
  if (!isPermissive(pkg.licence) && !state.accepted[id] && !opts.acceptLicence) return { ok: false, log: `${pkg.name} is licensed "${pkg.licence}". Accept its licence to install it.` };
  if (!/^[\w.-]+\/[\w.-]+$/.test(pkg.repo) || !/^[0-9a-f]{7,40}$|^v?[\w.-]+$/.test(pkg.ref)) return { ok: false, log: 'bad repo or ref in registry' };
  const tmp = await mkdtemp(join(tmpdir(), 'shipcast-skill-'));
  try {
    const tgz = join(tmp, 'src.tgz');
    const r = await fetch(`https://codeload.github.com/${pkg.repo}/tar.gz/${pkg.ref}`, { signal: AbortSignal.timeout(180_000) });
    if (!r.ok) return { ok: false, log: `download failed (${r.status})` };
    await writeFile(tgz, Buffer.from(await r.arrayBuffer()));
    const x = await run('tar', ['-xzf', tgz, '-C', tmp, '--strip-components=1'], { timeoutMs: 180_000 });
    if (x.code !== 0) return { ok: false, log: x.stderr.slice(-400) };
    await rm(storeDir(id), { recursive: true, force: true });
    await mkdir(storeDir(id), { recursive: true });
    const missing: string[] = [];
    for (const p of pkg.paths) {
      const src = p === '.' ? tmp : join(tmp, p);
      if (!existsSync(join(src, 'SKILL.md'))) {
        missing.push(p);
        continue;
      }
      // A root-level skill is the whole repo (minus git metadata and the download itself).
      await cp(src, join(storeDir(id), skillName(pkg, p)), { recursive: true, filter: (f) => !/[\\/]\.git([\\/]|$)|src\.tgz$/.test(f) });
    }
    if (missing.length === pkg.paths.length) return { ok: false, log: `no SKILL.md found at ${missing.join(', ')}` };
    state.installed[id] = { ref: pkg.ref, at: new Date().toISOString() };
    if (opts.acceptLicence) state.accepted[id] = true;
    state.enabled[id] = true;
    await saveState(state);
    await buildHubPlugin();
    return { ok: true, log: `${pkg.name}: ${pkg.paths.length - missing.length} skill(s) installed from ${pkg.repo}@${pkg.ref.slice(0, 7)}${missing.length ? `; missing ${missing.join(', ')}` : ''}` };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function setPackage(id: string, patch: { enabled?: boolean }): Promise<HubState> {
  const s = await hubState();
  if (typeof patch.enabled === 'boolean') s.enabled[id] = patch.enabled;
  await saveState(s);
  await buildHubPlugin();
  return s;
}

export async function setRole(role: string, id: string | null): Promise<HubState> {
  const s = await hubState();
  if (id) s.roles[role] = id;
  else delete s.roles[role];
  await saveState(s);
  return s;
}

/** Rebuild the "hub" plugin from every installed, enabled package. */
export async function buildHubPlugin(): Promise<string[]> {
  const [reg, s] = await Promise.all([loadRegistry(), hubState()]);
  // Several workers can rebuild at once: build aside, then swap the finished folder in.
  const final = hubPluginDir();
  const dir = `${final}.build-${process.pid}-${Date.now().toString(36)}`;
  await mkdir(join(dir, '.claude-plugin'), { recursive: true });
  await mkdir(join(dir, 'skills'), { recursive: true });
  await writeFile(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'hub', description: "Upstream skills enabled in Shipcast's Skill Hub", version: '1.0.0' }, null, 2));
  const names: string[] = [];
  for (const p of reg) {
    if (isLocal(p) || !isEnabled(p, s) || !isInstalled(p, s)) continue;
    for (const path of p.paths) {
      const name = skillName(p, path);
      if (!existsSync(join(storeDir(p.id), name)) || names.includes(name)) continue;
      await cp(join(storeDir(p.id), name), join(dir, 'skills', name), { recursive: true });
      names.push(name);
    }
  }
  const old = `${final}.old-${process.pid}-${Date.now().toString(36)}`;
  await rename(final, old).catch(() => {});
  try {
    await rename(dir, final);
  } catch {
    // Another worker swapped its build in first; theirs is identical, keep it.
    await rm(dir, { recursive: true, force: true });
  }
  await rm(old, { recursive: true, force: true }).catch(() => {});
  return names;
}

/** Which package and skill plays each role for a job: the user's pick, else the best enabled one. */
export async function assignRoles(roles: string[]): Promise<{ role: string; pkg: HubPackage; skill: string }[]> {
  const [reg, s] = await Promise.all([loadRegistry(), hubState()]);
  const out: { role: string; pkg: HubPackage; skill: string }[] = [];
  for (const role of roles) {
    const candidates = reg.filter((p) => p.roles[role] && isEnabled(p, s) && (isPermissive(p.licence) || s.accepted[p.id]));
    const chosen = candidates.find((p) => p.id === s.roles[role]) ?? candidates.sort((a, b) => b.verdict - a.verdict)[0];
    if (chosen) out.push({ role, pkg: chosen, skill: chosen.roles[role] });
  }
  return out;
}

/** Make sure the packages a job needs are installed (permissive or accepted only). */
export async function ensureForRoles(roles: string[], packages: string[] = []): Promise<{ assigned: Awaited<ReturnType<typeof assignRoles>>; log: string[] }> {
  const log: string[] = [];
  // Tests and air-gapped machines can switch the hub off entirely.
  if (process.env.SHIPCAST_SKILLHUB === 'off') return { assigned: [], log };
  const s = await hubState();
  const reg = await loadRegistry();
  const assigned = await assignRoles(roles);
  const want = new Set([...assigned.map((a) => a.pkg.id), ...packages]);
  for (const id of want) {
    const p = reg.find((x) => x.id === id);
    if (!p || isInstalled(p, s)) continue;
    const r = await installPackage(id);
    log.push(r.log);
  }
  if (want.size) await buildHubPlugin();
  return { assigned, log };
}

/** The lines appended to a pack's prompt so Claude uses the right specialist for each part. */
export function rolesPrompt(assigned: { role: string; pkg: HubPackage; skill: string }[]): string {
  if (!assigned.length) return '';
  return `\n\n## Specialist skills for this job (Shipcast Skill Hub)\n${assigned.map((a) => `- **${a.role}** → use the \`${isLocal(a.pkg) ? 'shipcast' : 'hub'}:${a.skill}\` skill (${a.pkg.name}${isLocal(a.pkg) ? '' : `, ${a.pkg.repo}`})`).join('\n')}\nLoad each one when you reach that part of the work; Shipcast's own skills still define the output format.`;
}
