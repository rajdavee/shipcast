import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const home = mkdtempSync(join(tmpdir(), 'gate-'));
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_SKILLHUB = 'off';
process.env.SHIPCAST_NOTIFY = 'off';
for (const s of ['RENDER', 'STILLS', 'MEDIA', 'QA', 'GEN', 'AGENTS']) process.env[`SHIPCAST_${s}_URL`] = 'http://127.0.0.1:9';
process.env.SHIPCAST_SERVICE_RETRY_MS = '500';
const { createApp } = await import('@shipcast/api');
const { resetRateLimits } = await import('@shipcast/engine');

let base = '';
const app = createApp({ serveWeb: false });
before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.close();
  rmSync(home, { recursive: true, force: true });
});

type Who = { cookie: string; ws?: string };
const call = async (who: Who | null, method: string, path: string, json?: unknown, extra: Record<string, string> = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (who) {
    headers.cookie = who.cookie;
    if (who.ws) headers['x-shipcast-workspace'] = who.ws;
  }
  if (method !== 'GET' && !('x-shipcast' in extra)) headers['x-shipcast'] = '1';
  const r = await fetch(base + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status, body, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], setCookie: r.headers.get('set-cookie') ?? '' };
};
const PW = 'a long test password';
let ana: Who, ben: Who, anaTeam: Who, benTeam: Who;
let teamId = '';
let anaProject = '';

test('nothing but sign-up and status works without a session', async () => {
  assert.equal((await call(null, 'GET', '/api/campaigns')).status, 401);
  assert.match((await call(null, 'GET', '/api/campaigns')).body.error, /first account/);
  assert.equal((await call(null, 'GET', '/api/auth/status')).body.setUp, false);
  const s = await call(null, 'POST', '/api/auth/signup', { email: 'ana@test.dev', password: PW, name: 'Ana' });
  assert.equal(s.status, 200);
  assert.match(s.setCookie, /HttpOnly/);
  assert.match(s.setCookie, /SameSite=Lax/);
  ana = { cookie: s.cookie, ws: s.body.workspace };
  assert.equal((await call(null, 'POST', '/api/auth/signup', { email: 'ben@test.dev', password: PW })).status, 403, 'the second account needs an invite');
  assert.equal((await call(null, 'GET', '/api/calendar.ics')).status, 401);
  assert.equal((await call(null, 'GET', '/oauth/linkedin/callback?state=forged&code=x')).status, 400, 'an unknown OAuth state is refused');
});

test('writes need the request header, so another site cannot forge them', async () => {
  const r = await call(ana, 'POST', '/api/campaigns', { source: { type: 'url', value: 'https://a.test' }, deliverables: [{ pack: 'carousel' }] }, { 'x-shipcast': '' });
  assert.equal(r.status, 403);
});

test("two people's workspaces never see each other", async () => {
  const p = await call(ana, 'POST', '/api/campaigns', { name: 'Ana launch', source: { type: 'url', value: 'https://a.test' }, deliverables: [{ pack: 'carousel' }] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  anaProject = p.body.id;
  await call(ana, 'POST', '/api/calendar/posts', { title: 'Ana post', channels: [] });
  await call(ana, 'PUT', '/api/publish/postiz', { url: 'http://127.0.0.1:9', apiKey: 'ANA-SECRET' }).catch(() => null);

  const team = await call(ana, 'POST', '/api/workspaces', { name: 'Acme' });
  teamId = team.body.id;
  const inv = await call(ana, 'POST', `/api/workspaces/${teamId}/invites`, { role: 'viewer', email: 'ben@test.dev' });
  const token = inv.body.link.split('/').pop();
  assert.equal((await call(null, 'GET', `/api/auth/invite/${token}`)).body.workspace, 'Acme');
  const b = await call(null, 'POST', '/api/auth/signup', { email: 'ben@test.dev', password: PW, invite: token });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const benAccount = await call({ cookie: b.cookie }, 'GET', '/api/account');
  const benPersonal = benAccount.body.workspaces.find((w: any) => w.personal).id;
  ben = { cookie: b.cookie, ws: benPersonal };
  benTeam = { cookie: b.cookie, ws: teamId };
  anaTeam = { cookie: ana.cookie, ws: teamId };

  assert.deepEqual((await call(ben, 'GET', '/api/campaigns')).body, []);
  assert.equal((await call(ben, 'GET', `/api/campaigns/${anaProject}`)).status, 404, "Ana's project id means nothing in Ben's workspace");
  assert.equal((await call(ben, 'GET', `/api/campaigns/${anaProject}/files/brief/brief.md`)).status, 404);
  assert.deepEqual((await call(ben, 'GET', '/api/calendar/posts')).body, []);
  assert.equal((await call({ cookie: b.cookie, ws: ana.ws }, 'GET', '/api/campaigns')).status, 404, "naming Ana's personal workspace gets nothing");
  const conns = JSON.stringify((await call(ben, 'GET', '/api/publish/connections')).body);
  assert.ok(!conns.includes('ANA-SECRET'));
  assert.equal((await call(ana, 'GET', '/api/campaigns')).body.length, 1);
});

test('roles: a viewer reads, an editor writes, only admins manage, only the install owner installs', async () => {
  assert.equal((await call(benTeam, 'GET', '/api/campaigns')).status, 200);
  assert.equal((await call(benTeam, 'POST', '/api/calendar/posts', { title: 'nope', channels: [] })).status, 403);
  const members = (await call(anaTeam, 'GET', `/api/workspaces/${teamId}/members`)).body.members;
  const benId = members.find((m: any) => m.email === 'ben@test.dev').id;
  assert.equal((await call(benTeam, 'GET', `/api/workspaces/${teamId}/members`)).body.invites.length, 0, 'viewers see no invites');
  assert.equal((await call(anaTeam, 'PUT', `/api/workspaces/${teamId}/members/${benId}`, { role: 'editor' })).status, 200);
  assert.equal((await call(benTeam, 'POST', '/api/calendar/posts', { title: 'team post', channels: [] })).status, 200);
  assert.equal((await call(benTeam, 'PUT', '/api/settings', { genCapPerMonth: 1 })).status, 403, 'editors cannot change settings');
  assert.equal((await call(benTeam, 'PUT', '/api/publish/postiz', { url: 'http://x', apiKey: 'k' })).status, 403);
  assert.equal((await call(benTeam, 'POST', `/api/workspaces/${teamId}/invites`, { role: 'viewer' })).status, 403);
  assert.equal((await call(benTeam, 'POST', '/api/setup/voice', {})).status, 403, 'installs are machine-wide: install owner only');
  assert.equal((await call(benTeam, 'PUT', '/api/auth/open-signup', { open: true })).status, 403);
  assert.equal((await call(anaTeam, 'PUT', `/api/workspaces/${teamId}/members/${benId}`, { role: 'admin' })).status, 200);
  assert.equal((await call(benTeam, 'PUT', '/api/settings', { genCapPerMonth: 7 })).status, 200);
  assert.equal((await call(benTeam, 'DELETE', `/api/workspaces/${teamId}`)).status, 403, 'only owners delete');
  // The team's posts are shared; Ana's personal ones are not.
  assert.deepEqual((await call(anaTeam, 'GET', '/api/calendar/posts')).body.map((p: any) => p.title), ['team post']);
  assert.ok(!(await call(benTeam, 'GET', '/api/calendar/posts')).body.some((p: any) => p.title === 'Ana post'));
  // Removed: access ends at once.
  assert.equal((await call(anaTeam, 'DELETE', `/api/workspaces/${teamId}/members/${benId}`)).status, 200);
  assert.equal((await call(benTeam, 'GET', '/api/calendar/posts')).status, 404);
});

test('sign-in is rate limited; signing out ends the session; a changed password ends the others', async () => {
  resetRateLimits();
  for (let i = 0; i < 10; i++) await call(null, 'POST', '/api/auth/signin', { email: 'ana@test.dev', password: 'wrong wrong wrong' });
  assert.equal((await call(null, 'POST', '/api/auth/signin', { email: 'ana@test.dev', password: PW })).status, 429);
  resetRateLimits();
  const one = await call(null, 'POST', '/api/auth/signin', { email: 'ben@test.dev', password: PW });
  const two = await call(null, 'POST', '/api/auth/signin', { email: 'ben@test.dev', password: PW });
  assert.equal((await call({ cookie: one.cookie }, 'GET', '/api/account')).status, 200);
  assert.equal((await call({ cookie: one.cookie }, 'PUT', '/api/account/password', { current: PW, next: 'another long password' })).status, 200);
  assert.equal((await call({ cookie: two.cookie }, 'GET', '/api/account')).status, 401);
  const out = await call({ cookie: one.cookie }, 'POST', '/api/auth/signout', {});
  assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await call({ cookie: one.cookie }, 'GET', '/api/account')).status, 401);
  void ben;
});

test("each person's Claude: their own credential, isolated config, never someone else's", async () => {
  const E = await import('@shipcast/engine');
  const users = await E.listUsers();
  const anaU = users.find((u) => u.email === 'ana@test.dev')!;
  const benU = users.find((u) => u.email === 'ben@test.dev')!;
  // Ana set the install up: without her own token she uses the machine's sign-in.
  assert.deepEqual(E.runAs({ workspace: ana.ws!, user: anaU.id }, () => E.claudeEnv()), {});
  // Ben didn't, and has nothing connected: his runs are refused, not handed Ana's or the machine's.
  assert.throws(() => E.runAs({ workspace: ben.ws!, user: benU.id }, () => E.claudeEnv()), /Connect your Claude account/);
  const signed = await call(null, 'POST', '/api/auth/signin', { email: 'ben@test.dev', password: 'another long password' });
  const me = { cookie: signed.cookie };
  assert.equal((await call(me, 'GET', '/api/account/claude')).body.method, 'none');
  assert.equal((await call(me, 'PUT', '/api/account/claude', { credential: 'not a token' })).status, 400);
  const tok = 'sk-ant-oat01-' + 'x'.repeat(40);
  const saved = await call(me, 'PUT', '/api/account/claude', { credential: tok });
  assert.equal(saved.body.method, 'token');
  assert.ok(!JSON.stringify(saved.body).includes(tok), 'the token never comes back');
  const env = E.runAs({ workspace: ben.ws!, user: benU.id }, () => E.claudeEnv());
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, tok);
  assert.equal(env.CLAUDE_CONFIG_DIR, join(home, 'users', benU.id, 'claude'));
  assert.equal(env.ANTHROPIC_API_KEY, '', 'a machine-wide API key is blanked for his runs');
  const { statSync } = await import('node:fs');
  assert.equal(statSync(join(home, 'users', benU.id, 'claude.json')).mode & 0o777, 0o600);
  // A run that would use nobody's Claude never starts.
  const r = E.runAs({ workspace: ana.ws!, user: 'u000000000000' }, () => E.runClaude({ prompt: 'x', cwd: home, allowedTools: [], onEvent: () => {} }));
  assert.match((await r.done).stderr, /Connect your Claude account/);
  assert.equal((await call(me, 'POST', '/api/connect/claude', {})).status, 403, "signing this machine's Claude in is for the install owner only");
  assert.equal((await call(me, 'DELETE', '/api/account/claude')).body.method, 'none');
});
