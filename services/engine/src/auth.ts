import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Role } from './context.ts';
import { withDirLock } from './filelock.ts';
import { rootHome, workspaceDir } from './paths.ts';

/**
 * Accounts, sessions, workspaces and invites. Everything lives in
 * <root>/auth as small JSON files (0600), written under a folder lock because
 * the api and agents processes both read and write them. Passwords are
 * scrypt-hashed; session and invite tokens are random and only their SHA-256
 * is stored, so a copy of the folder can't be used to sign in.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export interface User {
  id: string;
  email: string;
  name: string;
  passHash: string;
  createdAt: string;
  /** The account that set up this install (can use the machine's own Claude login). */
  installOwner?: boolean;
  lastWorkspace?: string;
  passwordChangedAt?: string;
}
export interface Session {
  hash: string;
  user: string;
  createdAt: string;
  lastSeen: string;
  expiresAt: string;
  agent?: string;
}
export interface Member {
  user: string;
  role: Role;
  addedAt: string;
}
export interface Workspace {
  id: string;
  name: string;
  /** Each user's own; can't be shared, left or deleted. */
  personalOf?: string;
  createdAt: string;
  members: Member[];
}
export interface Invite {
  hash: string;
  workspace: string;
  role: Exclude<Role, 'owner'>;
  email?: string;
  by: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}
interface AuthConfig {
  openSignup: boolean;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const dir = () => join(rootHome(), 'auth');
const f = (name: string) => join(dir(), `${name}.json`);
async function read<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(f(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}
async function write(name: string, data: unknown) {
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  // The lock helper may have created it first with the default mode.
  await chmod(dir(), 0o700).catch(() => {});
  const tmp = `${f(name)}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1) + '\n', { mode: 0o600 });
  await rename(tmp, f(name));
  await chmod(f(name), 0o600).catch(() => {});
}
let chain: Promise<unknown> = Promise.resolve();
/** One writer at a time, in this process and across processes. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => withDirLock(dir(), fn);
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

const id = (prefix: 'u' | 'w') => `${prefix}${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
const now = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const normEmail = (e: string) => String(e ?? '').trim().toLowerCase();

// ── passwords ──────────────────────────────────────────────────────────

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(String(pw).normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function passwordProblem(pw: string, email = ''): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (email && pw.toLowerCase().includes(normEmail(email).split('@')[0]) && normEmail(email).split('@')[0].length >= 4) return "Don't build the password from your email.";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|qwerty)/i.test(pw)) return 'That password is too easy to guess.';
  return null;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// ── reads ──────────────────────────────────────────────────────────────

export const listUsers = () => read<User[]>('users', []);
export const listWorkspaces = () => read<Workspace[]>('workspaces', []);
export const authConfig = () => read<AuthConfig>('config', { openSignup: false });
export async function getUser(uid: string) {
  return (await listUsers()).find((u) => u.id === uid);
}
export async function hasUsers() {
  return (await listUsers()).length > 0;
}
/** The user without secrets, for API responses. */
export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, installOwner: !!u.installOwner });

export async function workspacesFor(uid: string): Promise<(Workspace & { role: Role })[]> {
  return (await listWorkspaces()).flatMap((w) => {
    const m = w.members.find((x) => x.user === uid);
    return m ? [{ ...w, role: m.role }] : [];
  });
}
export async function roleIn(uid: string, wid: string): Promise<Role | null> {
  return (await listWorkspaces()).find((w) => w.id === wid)?.members.find((m) => m.user === uid)?.role ?? null;
}

export const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
/** read: see everything · write: make, edit, schedule · manage: connections, settings, members · own: delete or hand over the workspace */
export type Action = 'read' | 'write' | 'manage' | 'own';
const NEED: Record<Action, number> = { read: 1, write: 2, manage: 3, own: 4 };
export const can = (role: Role | null | undefined, action: Action) => !!role && ROLE_RANK[role] >= NEED[action];

// ── sign-up and sign-in ────────────────────────────────────────────────

/** Workspace-level data from a single-user install, moved into the first account's workspace. */
export const LEGACY_ENTRIES = ['campaigns', 'calendar', 'metrics', 'tone', 'lessons', 'evals', 'agents', 'gen', 'settings.json', 'secrets.json', 'usage-pause.json'];

export async function migrateLegacy(wid: string): Promise<string[]> {
  const moved: string[] = [];
  const target = workspaceDir(wid);
  await mkdir(target, { recursive: true, mode: 0o700 });
  // Accounts on one machine share an OS user, but no other OS user should read anyone's workspace.
  for (const d of [rootHome(), join(rootHome(), 'workspaces'), target]) await chmod(d, 0o700).catch(() => {});
  for (const e of LEGACY_ENTRIES) {
    const from = join(rootHome(), e);
    const to = join(target, e);
    if (existsSync(from) && !existsSync(to)) {
      await rename(from, to);
      moved.push(e);
    }
  }
  await write('migrated', { workspace: wid, at: now(), moved });
  return moved;
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string;
  invite?: string;
}

/** The first account sets the install up (and inherits its existing data); later ones need an invite unless sign-up is open. */
export function signUp(input: SignupInput): Promise<{ user: User; workspace: Workspace; migrated?: string[] }> {
  return locked(async () => {
    const email = normEmail(input.email);
    if (!EMAIL.test(email)) throw new AuthError(400, 'Enter a valid email address.');
    const weak = passwordProblem(input.password, email);
    if (weak) throw new AuthError(400, weak);
    const users = await listUsers();
    const first = users.length === 0;
    const invites = await read<Invite[]>('invites', []);
    const inv = input.invite ? invites.find((i) => i.hash === sha(input.invite!)) : undefined;
    // The invite is checked first, so a stranger can't learn which emails have accounts.
    if (!first && !(await authConfig()).openSignup) {
      if (!inv) throw new AuthError(403, 'Sign-up needs an invite link from someone in a workspace.');
    }
    if (users.some((u) => u.email === email)) throw new AuthError(409, 'An account with that email already exists — sign in instead.');
    if (inv) {
      const problem = inviteProblem(inv, email);
      if (problem) throw new AuthError(403, problem);
    }
    const user: User = { id: id('u'), email, name: String(input.name ?? '').trim().slice(0, 80) || email.split('@')[0], passHash: await hashPassword(input.password), createdAt: now(), ...(first ? { installOwner: true } : {}) };
    const personal: Workspace = { id: id('w'), name: `${user.name}'s workspace`, personalOf: user.id, createdAt: now(), members: [{ user: user.id, role: 'owner', addedAt: now() }] };
    const workspaces = await listWorkspaces();
    if (inv) {
      const w = workspaces.find((x) => x.id === inv.workspace);
      if (w) w.members.push({ user: user.id, role: inv.role, addedAt: now() });
      inv.usedAt = now();
      inv.usedBy = user.id;
      await write('invites', invites);
    }
    user.lastWorkspace = inv?.workspace ?? personal.id;
    await write('users', [...users, user]);
    await write('workspaces', [...workspaces, personal]);
    const migrated = first ? await migrateLegacy(personal.id) : undefined;
    return { user, workspace: personal, ...(migrated ? { migrated } : {}) };
  });
}

// Slow brute force without locking anyone out for long: per email and per address, 10 tries in 15 minutes.
const attempts = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
function tooMany(key: string, t = Date.now()): boolean {
  const xs = (attempts.get(key) ?? []).filter((x) => t - x < WINDOW);
  attempts.set(key, xs);
  return xs.length >= 10;
}
const failed = (key: string, t = Date.now()) => {
  // Bounded: old entries go first if someone sprays many emails or addresses.
  if (attempts.size > 50_000) for (const k of [...attempts.keys()].slice(0, 10_000)) attempts.delete(k);
  attempts.set(key, [...(attempts.get(key) ?? []), t]);
};
export const resetRateLimits = () => attempts.clear();

export const SESSION_DAYS = 30;

export async function signIn(emailIn: string, password: string, meta: { ip?: string; agent?: string } = {}): Promise<{ token: string; user: User }> {
  const email = normEmail(emailIn);
  const keys = [`e:${email}`, ...(meta.ip ? [`i:${meta.ip}`] : [])];
  if (keys.some((k) => tooMany(k))) throw new AuthError(429, 'Too many attempts — wait a few minutes and try again.');
  // Count the try before the slow password check, so parallel guesses can't all slip under the limit.
  keys.forEach((k) => failed(k));
  const user = (await listUsers()).find((u) => u.email === email);
  // Same work whether or not the account exists, so timing doesn't reveal which emails are registered.
  const ok = await verifyPassword(password, user?.passHash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!user || !ok) throw new AuthError(401, 'Email or password is wrong.');
  // A good password clears this email's count (not the address's: one person shouldn't unlock a sprayer).
  attempts.delete(`e:${email}`);
  return { token: await createSession(user.id, meta.agent), user };
}

export function createSession(uid: string, agent?: string): Promise<string> {
  return locked(async () => {
    const token = randomBytes(32).toString('base64url');
    const t = Date.now();
    const sessions = (await read<Session[]>('sessions', [])).filter((s) => Date.parse(s.expiresAt) > t);
    sessions.push({ hash: sha(token), user: uid, createdAt: now(), lastSeen: now(), expiresAt: new Date(t + SESSION_DAYS * 86_400_000).toISOString(), ...(agent ? { agent: agent.slice(0, 160) } : {}) });
    await write('sessions', sessions);
    return token;
  });
}

/** The signed-in user for a session token, sliding the expiry forward (at most once every 10 minutes). */
export async function sessionUser(token: string | undefined): Promise<{ user: User; session: Session } | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const h = sha(token);
  const s = (await read<Session[]>('sessions', [])).find((x) => x.hash === h);
  if (!s || Date.parse(s.expiresAt) <= Date.now()) return null;
  const user = await getUser(s.user);
  if (!user) return null;
  if (Date.now() - Date.parse(s.lastSeen) > 10 * 60_000) {
    await locked(async () => {
      const all = await read<Session[]>('sessions', []);
      const x = all.find((y) => y.hash === h);
      if (x) {
        x.lastSeen = now();
        x.expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
        await write('sessions', all);
      }
    });
  }
  return { user, session: s };
}

export function signOut(token: string): Promise<void> {
  return locked(async () => write('sessions', (await read<Session[]>('sessions', [])).filter((s) => s.hash !== sha(token))));
}
/** Sign out everywhere, optionally keeping the current session. */
export function signOutAll(uid: string, keepToken?: string): Promise<void> {
  return locked(async () => write('sessions', (await read<Session[]>('sessions', [])).filter((s) => s.user !== uid || (keepToken && s.hash === sha(keepToken)))));
}
export async function sessionsOf(uid: string, current?: string) {
  return (await read<Session[]>('sessions', [])).filter((s) => s.user === uid && Date.parse(s.expiresAt) > Date.now()).map((s) => ({ id: s.hash.slice(0, 12), createdAt: s.createdAt, lastSeen: s.lastSeen, agent: s.agent, current: !!current && s.hash === sha(current) }));
}

export async function changePassword(uid: string, current: string, next: string, keepToken?: string): Promise<void> {
  const u = await getUser(uid);
  if (!u || !(await verifyPassword(current, u.passHash))) throw new AuthError(401, 'Your current password is wrong.');
  const weak = passwordProblem(next, u.email);
  if (weak) throw new AuthError(400, weak);
  const hash = await hashPassword(next);
  await locked(async () => {
    const users = await listUsers();
    const x = users.find((y) => y.id === uid)!;
    x.passHash = hash;
    x.passwordChangedAt = now();
    await write('users', users);
  });
  // Anyone holding another session (a lost laptop, a leaked cookie) is out.
  await signOutAll(uid, keepToken);
}

export function setLastWorkspace(uid: string, wid: string): Promise<void> {
  return locked(async () => {
    const users = await listUsers();
    const u = users.find((x) => x.id === uid);
    if (u && u.lastWorkspace !== wid) {
      u.lastWorkspace = wid;
      await write('users', users);
    }
  });
}

export function setOpenSignup(open: boolean): Promise<AuthConfig> {
  return locked(async () => {
    const c = { ...(await authConfig()), openSignup: !!open };
    await write('config', c);
    return c;
  });
}

// ── workspaces and members ─────────────────────────────────────────────

export function createWorkspace(uid: string, name: string): Promise<Workspace> {
  return locked(async () => {
    const w: Workspace = { id: id('w'), name: String(name ?? '').trim().slice(0, 80) || 'Team workspace', createdAt: now(), members: [{ user: uid, role: 'owner', addedAt: now() }] };
    await write('workspaces', [...(await listWorkspaces()), w]);
    await mkdir(workspaceDir(w.id), { recursive: true, mode: 0o700 });
    return w;
  });
}

async function mutateWorkspace<T>(wid: string, fn: (w: Workspace, all: Workspace[]) => T): Promise<T> {
  return locked(async () => {
    const all = await listWorkspaces();
    const w = all.find((x) => x.id === wid);
    if (!w) throw new AuthError(404, 'Workspace not found.');
    const out = fn(w, all);
    await write('workspaces', all);
    return out;
  });
}

export const renameWorkspace = (wid: string, name: string) =>
  mutateWorkspace(wid, (w) => {
    w.name = String(name ?? '').trim().slice(0, 80) || w.name;
    return w;
  });

const owners = (w: Workspace) => w.members.filter((m) => m.role === 'owner');

export const setMemberRole = (wid: string, target: string, role: Role, by: Role) =>
  mutateWorkspace(wid, (w) => {
    const m = w.members.find((x) => x.user === target);
    if (!m) throw new AuthError(404, 'Not a member of this workspace.');
    if (!ROLE_RANK[role]) throw new AuthError(400, 'Unknown role.');
    // Only owners make or unmake owners; admins manage editors and viewers.
    if ((role === 'owner' || m.role === 'owner' || m.role === 'admin' || role === 'admin') && by !== 'owner') throw new AuthError(403, 'Only an owner can change admin or owner roles.');
    if (m.role === 'owner' && role !== 'owner' && owners(w).length === 1) throw new AuthError(409, 'A workspace needs at least one owner — make someone else owner first.');
    if (w.personalOf && role !== 'owner' && target === w.personalOf) throw new AuthError(409, "You can't step down in your own personal workspace.");
    m.role = role;
    return w;
  });

export const removeMember = (wid: string, target: string, by: { user: string; role: Role }) =>
  mutateWorkspace(wid, (w) => {
    if (w.personalOf === target) throw new AuthError(409, "A personal workspace can't lose its owner.");
    const m = w.members.find((x) => x.user === target);
    if (!m) throw new AuthError(404, 'Not a member of this workspace.');
    const self = target === by.user;
    if (!self && ROLE_RANK[by.role] <= ROLE_RANK[m.role] && by.role !== 'owner') throw new AuthError(403, "You can't remove someone with the same or a higher role.");
    if (m.role === 'owner' && owners(w).length === 1) throw new AuthError(409, 'Hand ownership to someone else before the last owner leaves.');
    w.members = w.members.filter((x) => x.user !== target);
    return w;
  });

export function deleteWorkspace(wid: string): Promise<void> {
  return locked(async () => {
    const all = await listWorkspaces();
    const w = all.find((x) => x.id === wid);
    if (!w) throw new AuthError(404, 'Workspace not found.');
    if (w.personalOf) throw new AuthError(409, "Personal workspaces can't be deleted.");
    await write('workspaces', all.filter((x) => x.id !== wid));
    // The files are kept (renamed aside), never silently destroyed.
    if (existsSync(workspaceDir(wid))) await rename(workspaceDir(wid), `${workspaceDir(wid)}.deleted-${Date.now()}`);
  });
}

// ── invites ────────────────────────────────────────────────────────────

export const INVITE_DAYS = 7;

export function createInvite(wid: string, role: Invite['role'], by: string, email?: string): Promise<{ token: string; invite: Omit<Invite, 'hash'> }> {
  return locked(async () => {
    if (!['admin', 'editor', 'viewer'].includes(role)) throw new AuthError(400, 'Invite as admin, editor or viewer.');
    const w = (await listWorkspaces()).find((x) => x.id === wid);
    if (!w) throw new AuthError(404, 'Workspace not found.');
    if (w.personalOf) throw new AuthError(409, 'Personal workspaces are just yours — create a team workspace to invite people.');
    // Nobody hands out more than they have: admins invite editors and viewers; owners may invite admins.
    const mine = w.members.find((m) => m.user === by)?.role;
    if (!mine || (ROLE_RANK[role] >= ROLE_RANK[mine] && mine !== 'owner')) throw new AuthError(403, 'You can only invite people to a role below your own.');
    const token = randomBytes(24).toString('base64url');
    const inv: Invite = { hash: sha(token), workspace: wid, role, ...(email ? { email: normEmail(email) } : {}), by, createdAt: now(), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString() };
    await write('invites', [...(await read<Invite[]>('invites', [])), inv]);
    const { hash, ...rest } = inv;
    void hash;
    return { token, invite: rest };
  });
}

function inviteProblem(inv: Invite, email: string): string | null {
  if (inv.usedAt) return 'That invite has already been used.';
  if (Date.parse(inv.expiresAt) <= Date.now()) return 'That invite has expired — ask for a new one.';
  if (inv.email && inv.email !== normEmail(email)) return 'That invite was sent to a different email address.';
  return null;
}

/** An existing user joins a workspace with an invite. */
export function acceptInvite(token: string, uid: string): Promise<Workspace> {
  return locked(async () => {
    const invites = await read<Invite[]>('invites', []);
    const inv = invites.find((i) => i.hash === sha(token));
    if (!inv) throw new AuthError(404, 'That invite link is not valid.');
    const u = await getUser(uid);
    const problem = inviteProblem(inv, u?.email ?? '');
    if (problem) throw new AuthError(403, problem);
    const all = await listWorkspaces();
    const w = all.find((x) => x.id === inv.workspace);
    if (!w) throw new AuthError(404, 'That workspace no longer exists.');
    if (!w.members.some((m) => m.user === uid)) w.members.push({ user: uid, role: inv.role, addedAt: now() });
    inv.usedAt = now();
    inv.usedBy = uid;
    await write('workspaces', all);
    await write('invites', invites);
    return w;
  });
}

export async function invitesFor(wid: string) {
  return (await read<Invite[]>('invites', [])).filter((i) => i.workspace === wid && !i.usedAt && Date.parse(i.expiresAt) > Date.now()).map(({ hash, ...rest }) => ({ id: hash.slice(0, 12), ...rest }));
}
export function revokeInvite(wid: string, inviteId: string): Promise<boolean> {
  return locked(async () => {
    const all = await read<Invite[]>('invites', []);
    const left = all.filter((i) => !(i.workspace === wid && i.hash.startsWith(inviteId) && inviteId.length >= 8));
    await write('invites', left);
    return left.length < all.length;
  });
}

/** What an invite link is for, without using it up (for the join page). */
export async function inviteInfo(token: string): Promise<{ valid: boolean; problem?: string; workspace?: string; role?: string; email?: string }> {
  const inv = (await read<Invite[]>('invites', [])).find((i) => i.hash === sha(String(token)));
  if (!inv) return { valid: false, problem: 'That invite link is not valid.' };
  const problem = inv.usedAt ? 'That invite has already been used.' : Date.parse(inv.expiresAt) <= Date.now() ? 'That invite has expired — ask for a new one.' : undefined;
  const w = (await listWorkspaces()).find((x) => x.id === inv.workspace);
  return { valid: !problem && !!w, ...(problem ? { problem } : {}), workspace: w?.name, role: inv.role, ...(inv.email ? { email: inv.email } : {}) };
}

/**
 * Every workspace as a context for background work, run as its (first) owner. Before anyone has
 * signed up there are no workspaces: the root is the only one.
 */
export async function workContexts(): Promise<{ workspace?: string; user?: string; role?: Role }[]> {
  const ws = await listWorkspaces().catch(() => [] as Workspace[]);
  return ws.length ? ws.map((w) => ({ workspace: w.id, user: w.members.find((m) => m.role === 'owner')?.user, role: 'owner' as Role })) : [{}];
}

/** The install owner's personal workspace: where install-wide background work (the trend radar) runs. */
export async function primaryWorkspace(): Promise<string | undefined> {
  const owner = (await listUsers()).find((u) => u.installOwner);
  return owner ? (await listWorkspaces()).find((w) => w.personalOf === owner.id)?.id : undefined;
}
