import type { IncomingMessage, ServerResponse } from 'node:http';
import { acceptInvite, AuthError, resolveRunToken, claudeConnection, forgetClaudeCredential, saveClaudeCredential, authConfig, can, changePassword, createInvite, createWorkspace, deleteWorkspace, getUser, hasUsers, inviteInfo, invitesFor, listUsers, publicUser, removeMember, renameWorkspace, revokeInvite, roleIn, sessionsOf, sessionUser, setLastWorkspace, setMemberRole, setOpenSignup, signIn, signOut, signOutAll, signUp, workspacesFor, type Action, type Role, type User } from '@shipcast/engine';
import { HttpError, readJson, type Router } from './http.ts';

/**
 * The gate in front of every API route: who is calling (session cookie),
 * which workspace they're working in (header, else their last one), whether
 * they're a member, and whether their role allows this kind of request.
 * Routes then run inside that workspace's context, so everything they read
 * or write is the workspace's own.
 */

export const COOKIE = 'shipcast_session';
const SESSION_SECONDS = 30 * 86_400;

export function cookieToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const secure = (req: IncomingMessage) => process.env.SHIPCAST_SECURE_COOKIE === '1' || req.headers['x-forwarded-proto'] === 'https';
export function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string) {
  res.setHeader('set-cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure(req) ? '; Secure' : ''}`);
}
export function clearSessionCookie(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
}

/** Routes anyone may call (signing in needs no session). */
const PUBLIC: [string, RegExp][] = [
  ['POST', /^\/api\/auth\/(signup|signin)$/],
  ['GET', /^\/api\/auth\/status$/],
  ['GET', /^\/api\/auth\/invite\/[^/]+$/],
];
/** Routes about the person, not a workspace: a session is enough. */
const PERSONAL = /^\/api\/(auth|account|workspaces)(\/|$)/;

/** Machine-wide changes (installs, the machine's own CLI logins, opening the file browser): only the install's owner. */
const INSTALL_OWNER: [string, RegExp][] = [
  ['POST', /^\/api\/setup\//],
  ['POST', /^\/api\/packs\/[^/]+\/install$/],
  ['*', /^\/api\/skills(\/|$)/],
  ['POST', /^\/api\/connect\/(github|claude)$/],
  ['POST', /^\/api\/campaigns\/[^/]+\/reveal$/],
  // Running a project's app executes its code on this machine.
  ['POST', /^\/api\/campaigns\/[^/]+\/app\/(start|stop|unlock)$/],
  // The machine's GitHub sign-in sees the owner's private repos.
  ['GET', /^\/api\/github\//],
];
/** Connections, keys, publishing and workspace settings: admins and owners. */
const MANAGE: [string, RegExp][] = [
  ['*', /^\/api\/publish\//],
  ['PUT', /^\/api\/settings$/],
  ['*', /^\/api\/(providers|broll)(\/|$)/],
  ['PUT', /^\/api\/voice$/],
  ['DELETE', /^\/api\/voice\//],
  ['PUT', /^\/api\/agents\//],
  // Running a background job spends the workspace owner's Claude.
  ['POST', /^\/api\/agents\/[^/]+\/run$/],
  ['*', /^\/api\/campaigns\/[^/]+\/env$/],
  // The website connection: choosing properties, syncing and settings (reading the status is for everyone).
  ['PUT', /^\/api\/site$/],
  // Sharing a report outside the workspace.
  ['POST', /^\/api\/reports\/[^/]+\/shares$/],
  ['DELETE', /^\/api\/reports\/[^/]+\/shares\//],
  ['*', /^\/api\/site\//],
];
const hit = (list: [string, RegExp][], method: string, path: string) => list.some(([m, re]) => (m === '*' || m === method) && re.test(path));

/** What a request needs: reads need read; writes need write; the lists above need more. */
/** POSTs that change nothing and spend nothing (scoring text against the brand voice): readers may use them. */
const READ_POSTS = [/^\/api\/tones\/score$/];

export function levelFor(method: string, path: string): Action | 'install' {
  if (method === 'POST' && READ_POSTS.some((re) => re.test(path))) return 'read';
  // A '*' entry lets everyone read (e.g. the skills list); an explicit GET entry is owner-only even to read.
  if (hit(INSTALL_OWNER, method, path)) return method === 'GET' && !INSTALL_OWNER.some(([m, re]) => m === 'GET' && re.test(path)) ? 'read' : 'install';
  if (hit(MANAGE, method, path)) return 'manage';
  return method === 'GET' || method === 'HEAD' ? 'read' : 'write';
}

export interface Caller {
  user: User;
  token: string;
  workspace?: string;
  role?: Role;
}

/**
 * Check a request. Returns null for public routes; throws 401/403/404 otherwise.
 * Writes must carry the `x-shipcast` header, which a page on another site can't set — a second guard against cross-site requests on top of the Origin check and SameSite cookies.
 */
export async function gate(req: IncomingMessage, method: string, path: string): Promise<Caller | null> {
  if (PUBLIC.some(([m, re]) => m === method && re.test(path))) return null;
  // A Claude run's helper scripts call with the run's token: they act as that person, in that workspace, with their current role.
  const run = String(req.headers['x-shipcast-run'] ?? '');
  if (run) {
    const t = await resolveRunToken(run);
    const user = t?.user ? await getUser(t.user) : undefined;
    const role = t?.workspace && user ? await roleIn(user.id, t.workspace) : null;
    if (!t?.workspace || !user || !role) throw new HttpError(401, 'run token not valid');
    const level = levelFor(method, path);
    if (level === 'install' || PERSONAL.test(path) || !can(role, level)) throw new HttpError(403, 'not allowed from a run');
    return { user, token: '', workspace: t.workspace, role };
  }
  if (method !== 'GET' && method !== 'HEAD' && !req.headers['x-shipcast']) throw new HttpError(403, 'missing request header');
  const token = cookieToken(req);
  const s = await sessionUser(token);
  if (!s) throw new HttpError(401, (await hasUsers()) ? 'Sign in to continue.' : 'Create the first account to set up Shipcast.');
  if (PERSONAL.test(path)) return { user: s.user, token: token! };
  const mine = await workspacesFor(s.user.id);
  const asked = String(req.headers['x-shipcast-workspace'] ?? '');
  const ws = mine.find((w) => w.id === asked) ?? (asked ? undefined : (mine.find((w) => w.id === s.user.lastWorkspace) ?? mine[0]));
  // Not "forbidden": someone else's workspace simply doesn't exist for you.
  if (!ws) throw new HttpError(404, 'workspace not found');
  const level = levelFor(method, path);
  if (level === 'install') {
    if (!s.user.installOwner) throw new HttpError(403, "Only the person who set up this Shipcast can change what's installed on this machine.");
  } else if (!can(ws.role, level)) throw new HttpError(403, ws.role === 'viewer' ? 'Viewers can look but not change things — ask an editor.' : 'Ask a workspace admin to do this.');
  return { user: s.user, token: token!, workspace: ws.id, role: ws.role };
}

const authErr = (e: unknown): never => {
  if (e instanceof AuthError) throw new HttpError(e.status, e.message);
  throw e;
};

/** Sign-up, sign-in, the account itself, and managing workspaces and members. */
export function registerAuthRoutes(router: Router, callerOf: (req: IncomingMessage) => Caller) {
  // x-forwarded-for is whatever the client says unless a proxy we trust sets it.
  const meta = (req: IncomingMessage) => ({ ip: String((process.env.SHIPCAST_TRUST_PROXY === '1' && req.headers['x-forwarded-for']) || req.socket.remoteAddress || '').split(',')[0].trim(), agent: String(req.headers['user-agent'] ?? '') });

  router.get('/api/auth/status', async (req) => {
    const s = await sessionUser(cookieToken(req));
    return { setUp: await hasUsers(), signedIn: !!s, openSignup: (await authConfig()).openSignup, ...(s ? { user: publicUser(s.user) } : {}) };
  });
  router.post('/api/auth/signup', async (req, res) => {
    const b = await readJson(req);
    const r = await signUp({ email: b.email, password: b.password, name: b.name, invite: typeof b.invite === 'string' ? b.invite : undefined }).catch(authErr);
    const { token } = await signIn(b.email, b.password, meta(req)).catch(authErr);
    setSessionCookie(req, res, token);
    return { user: publicUser(r.user), workspace: r.workspace.id, ...(r.migrated?.length ? { migrated: r.migrated } : {}) };
  });
  router.post('/api/auth/signin', async (req, res) => {
    const b = await readJson(req);
    const { token, user } = await signIn(String(b.email ?? ''), String(b.password ?? ''), meta(req)).catch(authErr);
    setSessionCookie(req, res, token);
    return { user: publicUser(user) };
  });
  router.post('/api/auth/signout', async (req, res) => {
    const c = callerOf(req);
    const { everywhere } = await readJson(req);
    if (everywhere) await signOutAll(c.user.id);
    else await signOut(c.token);
    clearSessionCookie(req, res);
    return { ok: true };
  });
  router.get('/api/auth/invite/:token', async (_q, _r, p) => inviteInfo(p.token));

  router.get('/api/account', async (req) => {
    const c = callerOf(req);
    return { user: publicUser(c.user), workspaces: (await workspacesFor(c.user.id)).map((w) => ({ id: w.id, name: w.name, role: w.role, personal: w.personalOf === c.user.id, members: w.members.length })), current: c.user.lastWorkspace, sessions: await sessionsOf(c.user.id, c.token) };
  });
  router.get('/api/account/claude', async (req) => claudeConnection(callerOf(req).user.id));
  router.put('/api/account/claude', async (req) => {
    const c = callerOf(req);
    try {
      await saveClaudeCredential(c.user.id, String((await readJson(req)).credential ?? ''));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return claudeConnection(c.user.id);
  });
  router.delete('/api/account/claude', async (req) => {
    const c = callerOf(req);
    await forgetClaudeCredential(c.user.id);
    return claudeConnection(c.user.id);
  });
  router.put('/api/account/password', async (req) => {
    const c = callerOf(req);
    const b = await readJson(req);
    await changePassword(c.user.id, String(b.current ?? ''), String(b.next ?? ''), c.token).catch(authErr);
    return { ok: true };
  });

  router.post('/api/workspaces', async (req) => {
    const c = callerOf(req);
    const { name } = await readJson(req);
    return createWorkspace(c.user.id, String(name ?? ''));
  });
  router.post('/api/workspaces/:id/switch', async (req, _r, p) => {
    const c = callerOf(req);
    if (!(await roleIn(c.user.id, p.id))) throw new HttpError(404, 'workspace not found');
    await setLastWorkspace(c.user.id, p.id);
    return { ok: true, workspace: p.id };
  });
  const need = async (req: IncomingMessage, wid: string, action: Action) => {
    const c = callerOf(req);
    const role = await roleIn(c.user.id, wid);
    if (!role) throw new HttpError(404, 'workspace not found');
    if (!can(role, action)) throw new HttpError(403, action === 'own' ? 'Only an owner can do this.' : 'Ask a workspace admin to do this.');
    return { c, role };
  };
  router.get('/api/workspaces/:id/members', async (req, _r, p) => {
    const { role } = await need(req, p.id, 'read');
    const w = (await workspacesFor(callerOf(req).user.id)).find((x) => x.id === p.id)!;
    const users = await listUsers();
    return {
      members: w.members.map((m) => {
        const u = users.find((x) => x.id === m.user);
        return { id: m.user, email: u?.email ?? '', name: u?.name ?? '', role: m.role, addedAt: m.addedAt };
      }),
      // Pending invites carry no tokens; only managers see them.
      invites: can(role, 'manage') ? await invitesFor(p.id) : [],
    };
  });
  router.post('/api/workspaces/:id/invites', async (req, _r, p) => {
    const { c } = await need(req, p.id, 'manage');
    const b = await readJson(req);
    const r = await createInvite(p.id, b.role, c.user.id, typeof b.email === 'string' && b.email ? b.email : undefined).catch(authErr);
    // The token is shown once, as a link, to the person who made it.
    return { link: `/#/join/${r.token}`, invite: r.invite };
  });
  router.delete('/api/workspaces/:id/invites/:invite', async (req, _r, p) => {
    await need(req, p.id, 'manage');
    if (!(await revokeInvite(p.id, p.invite))) throw new HttpError(404, 'invite not found');
    return { ok: true };
  });
  router.post('/api/workspaces/join/:token', async (req, _r, p) => {
    const c = callerOf(req);
    const w = await acceptInvite(p.token, c.user.id).catch(authErr);
    await setLastWorkspace(c.user.id, w.id);
    return { workspace: w.id, name: w.name };
  });
  router.put('/api/workspaces/:id', async (req, _r, p) => {
    await need(req, p.id, 'manage');
    return renameWorkspace(p.id, String((await readJson(req)).name ?? '')).catch(authErr);
  });
  router.put('/api/workspaces/:id/members/:user', async (req, _r, p) => {
    const { role } = await need(req, p.id, 'manage');
    return setMemberRole(p.id, p.user, (await readJson(req)).role, role).catch(authErr);
  });
  router.delete('/api/workspaces/:id/members/:user', async (req, _r, p) => {
    const c = callerOf(req);
    // Anyone may leave; removing others needs manage.
    const { role } = await need(req, p.id, p.user === c.user.id ? 'read' : 'manage');
    return removeMember(p.id, p.user, { user: c.user.id, role }).catch(authErr);
  });
  router.delete('/api/workspaces/:id', async (req, _r, p) => {
    await need(req, p.id, 'own');
    await deleteWorkspace(p.id).catch(authErr);
    return { ok: true };
  });
  router.put('/api/auth/open-signup', async (req) => {
    const c = callerOf(req);
    if (!c.user.installOwner) throw new HttpError(403, 'Only the person who set up this Shipcast can change sign-up.');
    return setOpenSignup(!!(await readJson(req)).open);
  });
  void getUser;
}
