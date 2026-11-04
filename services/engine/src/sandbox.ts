import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isInstallOwnerSync } from './claude-account.ts';
import { currentContext } from './context.ts';
import { rootHome, userDir, workspaceDir } from './paths.ts';

/**
 * Claude runs can use tools (shell, file reads), and every account's runs
 * execute as the same OS user. For anyone but the person who set the install
 * up, a run is wrapped in an OS sandbox that can only see their own workspace
 * and user folder inside the install — not the account store, not other
 * workspaces, not the machine's own sign-ins. macOS: sandbox-exec. Linux:
 * bubblewrap. Elsewhere such runs are refused unless the admin declares every
 * account trusted.
 */

export class SandboxError extends Error {}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const q = (p: string) => JSON.stringify(p);
/** Machine secrets outside the install that a run never needs. */
const PRIVATE = ['.claude', '.ssh', '.config/gh', '.aws', '.gnupg', '.netrc', '.docker', 'Library/Keychains', '.kube'].map((p) => join(homedir(), p));
/** Install-wide, read-only material a run may use. */
const SHARED_READ = ['skills', 'fonts', 'icons', 'trends'];

export function macProfile(root: string, ws: string, user: string): string {
  const r = real(root);
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read* file-write* (subpath ${q(r)}))`,
    ...SHARED_READ.map((d) => `(allow file-read* (subpath ${q(join(r, d))}))`),
    `(allow file-read* file-write* (subpath ${q(real(ws))}))`,
    `(allow file-read* file-write* (subpath ${q(real(user))}))`,
    ...PRIVATE.map((p) => `(deny file-read* file-write* (subpath ${q(real(p))}))`),
  ].join('');
}

export function bwrapArgs(root: string, ws: string, user: string): string[] {
  const r = real(root);
  return [
    '--dev-bind', '/', '/',
    // Hide the whole install, then put back only what this person may see.
    '--tmpfs', r,
    ...SHARED_READ.flatMap((d) => (existsSync(join(r, d)) ? ['--ro-bind', join(r, d), join(r, d)] : [])),
    '--bind', real(ws), real(ws),
    '--bind', real(user), real(user),
    ...PRIVATE.filter(existsSync).flatMap((p) => ['--tmpfs', real(p)]),
    '--die-with-parent',
    '--',
  ];
}

const which = (bin: string) => ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].map((d) => join(d, bin)).find(existsSync);

/**
 * The command to spawn for a run in the current context: the plain command for the install owner
 * (or no user at all), else wrapped in the sandbox. Throws when isolation isn't possible.
 */
export function sandboxed(bin: string, args: string[]): { bin: string; args: string[]; sandbox: 'none' | 'sandbox-exec' | 'bwrap' } {
  const ctx = currentContext();
  if (!ctx?.user || !ctx.workspace || isInstallOwnerSync(ctx.user)) return { bin, args, sandbox: 'none' };
  const ws = workspaceDir(ctx.workspace);
  const user = userDir(ctx.user);
  for (const d of [ws, user]) mkdirSync(d, { recursive: true });
  if (process.platform === 'darwin' && which('sandbox-exec')) return { bin: which('sandbox-exec')!, args: ['-p', macProfile(rootHome(), ws, user), bin, ...args], sandbox: 'sandbox-exec' };
  if (process.platform === 'linux' && which('bwrap')) return { bin: which('bwrap')!, args: [...bwrapArgs(rootHome(), ws, user), bin, ...args], sandbox: 'bwrap' };
  if (process.env.SHIPCAST_TRUST_ALL_USERS === '1') return { bin, args, sandbox: 'none' };
  throw new SandboxError("This server can't keep other people's runs apart (it needs sandbox-exec on macOS or bubblewrap on Linux). Install bubblewrap, or set SHIPCAST_TRUST_ALL_USERS=1 if every account is trusted.");
}
