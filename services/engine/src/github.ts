import { existsSync } from 'node:fs';
import { run, which } from './exec.ts';
import { currentContext } from './context.ts';
import { isInstallOwnerSync } from './claude-account.ts';

export interface GithubStatus {
  installed: boolean;
  loggedIn: boolean;
  login?: string;
}

export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Accept owner/repo, a github.com URL, or a git URL; return owner/repo. */
export function parseRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/$/, '');
  if (REPO_RE.test(s)) return s;
  const m = s.match(/github\.com[/:]([\w.-]+\/[\w.-]+)/);
  return m ? m[1] : null;
}

export async function githubStatus(): Promise<GithubStatus> {
  if (!(await which('gh'))) return { installed: false, loggedIn: false };
  const r = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 15_000 });
  return r.code === 0 ? { installed: true, loggedIn: true, login: r.stdout.trim() } : { installed: true, loggedIn: false };
}

export interface RepoSummary {
  nameWithOwner: string;
  description: string;
  isPrivate: boolean;
  updatedAt: string;
  url: string;
}

export async function listRepos(limit = 60): Promise<RepoSummary[]> {
  const r = await run('gh', ['repo', 'list', '--limit', String(limit), '--json', 'nameWithOwner,description,isPrivate,updatedAt,url'], { timeoutMs: 30_000 });
  if (r.code !== 0) return [];
  return (JSON.parse(r.stdout) as RepoSummary[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface PullSummary {
  number: number;
  title: string;
  state: string;
  url: string;
}

export async function listPulls(repo: string): Promise<PullSummary[]> {
  if (!REPO_RE.test(repo)) return [];
  const r = await run('gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', '30', '--json', 'number,title,state,url'], { timeoutMs: 30_000 });
  return r.code === 0 ? JSON.parse(r.stdout) : [];
}

/**
 * Shallow-clone a repo into `dest`. Uses `gh` when signed in (private repos
 * work with the user's own GitHub login), otherwise plain git over https.
 */
export async function cloneRepo(repo: string, dest: string, ref?: string): Promise<{ ok: boolean; message: string }> {
  if (!REPO_RE.test(repo)) return { ok: false, message: `not a repo: ${repo}` };
  if (existsSync(dest)) return { ok: true, message: 'already cloned' };
  const gitArgs = ['--depth', '1', ...(ref && !/^\d+$/.test(ref) ? ['--branch', ref] : [])];
  // The machine's GitHub sign-in belongs to the person who set the install up; anyone else gets public repos only,
  // with every stored credential (gh, keychain helpers) switched off.
  const uid = currentContext()?.user;
  const mine = !uid || isInstallOwnerSync(uid);
  const gh = mine ? await githubStatus() : { loggedIn: false };
  const r = gh.loggedIn
    ? await run('gh', ['repo', 'clone', repo, dest, '--', ...gitArgs], { timeoutMs: 300_000 })
    : await run('git', ['-c', 'credential.helper=', 'clone', ...gitArgs, `https://github.com/${repo}.git`, dest], { timeoutMs: 300_000, ...(mine ? {} : { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', GH_TOKEN: '', GITHUB_TOKEN: '' } }) });
  return { ok: r.code === 0, message: (r.stderr || r.stdout).trim().slice(-500) };
}
