import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getUser } from './auth.ts';
import { currentContext } from './context.ts';
import { rootHome, userDir } from './paths.ts';

/**
 * Each person's own Claude: a long-lived token from `claude setup-token` or
 * an Anthropic API key, kept in their private folder (0600) and handed only to
 * the Claude runs they start, with a config folder of their own so nothing of
 * the machine's sign-in leaks in. The person who set the install up may keep
 * using this machine's Claude sign-in instead.
 */

interface ClaudeCreds {
  token?: string;
  apiKey?: string;
  savedAt?: string;
}

const file = (uid: string) => join(userDir(uid), 'claude.json');

async function readCreds(uid: string): Promise<ClaudeCreds> {
  try {
    return JSON.parse(await readFile(file(uid), 'utf8'));
  } catch {
    return {};
  }
}

export class ClaudeAccountError extends Error {}

/** Tokens from `claude setup-token` start sk-ant-oat…; API keys sk-ant-api…. */
export function credentialKind(value: string): 'token' | 'apiKey' | null {
  const v = String(value ?? '').trim();
  if (/^sk-ant-oat\d*-[\w-]{20,}$/.test(v)) return 'token';
  if (/^sk-ant-api\d*-[\w-]{20,}$/.test(v)) return 'apiKey';
  return null;
}

export async function saveClaudeCredential(uid: string, value: string): Promise<{ kind: 'token' | 'apiKey' }> {
  const kind = credentialKind(value);
  if (!kind) throw new ClaudeAccountError('Paste the token from `claude setup-token` (sk-ant-oat…) or an Anthropic API key (sk-ant-api…).');
  await mkdir(userDir(uid), { recursive: true, mode: 0o700 });
  const tmp = `${file(uid)}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify({ [kind]: value.trim(), savedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(tmp, file(uid));
  await chmod(file(uid), 0o600).catch(() => {});
  return { kind };
}

export async function forgetClaudeCredential(uid: string): Promise<void> {
  await rm(file(uid), { force: true });
}

export interface ClaudeConnection {
  connected: boolean;
  method: 'token' | 'apiKey' | 'machine' | 'none';
  savedAt?: string;
  /** Only the install owner may fall back to the machine's sign-in. */
  machineAllowed: boolean;
}

export async function claudeConnection(uid: string): Promise<ClaudeConnection> {
  const c = await readCreds(uid);
  const owner = !!(await getUser(uid))?.installOwner;
  if (c.token) return { connected: true, method: 'token', savedAt: c.savedAt, machineAllowed: owner };
  if (c.apiKey) return { connected: true, method: 'apiKey', savedAt: c.savedAt, machineAllowed: owner };
  return { connected: owner, method: owner ? 'machine' : 'none', machineAllowed: owner };
}

/** Read synchronously: a Claude run is spawned synchronously, and these are two tiny local files. */
function credsSync(uid: string): ClaudeCreds {
  try {
    return JSON.parse(readFileSync(file(uid), 'utf8'));
  } catch {
    return {};
  }
}
export function isInstallOwnerSync(uid: string): boolean {
  try {
    return !!(JSON.parse(readFileSync(join(rootHome(), 'auth', 'users.json'), 'utf8')) as { id: string; installOwner?: boolean }[]).find((u) => u.id === uid)?.installOwner;
  } catch {
    return false;
  }
}

/**
 * Environment for a Claude run in the current context. No user in context (a single-user install,
 * a command-line tool): the machine's sign-in, as before. A user with their own credential: that,
 * in a config folder of their own. A user without one who didn't set the install up: refused.
 */
export function claudeEnv(): Record<string, string> {
  const uid = currentContext()?.user;
  if (!uid) return {};
  const c = credsSync(uid);
  const isolated = { CLAUDE_CONFIG_DIR: join(userDir(uid), 'claude') };
  if (c.token) return { ...isolated, CLAUDE_CODE_OAUTH_TOKEN: c.token, ANTHROPIC_API_KEY: '' };
  if (c.apiKey) return { ...isolated, ANTHROPIC_API_KEY: c.apiKey, CLAUDE_CODE_OAUTH_TOKEN: '' };
  if (isInstallOwnerSync(uid)) return {};
  throw new ClaudeAccountError('Connect your Claude account first (Account → Claude) — runs use your own Claude plan.');
}
