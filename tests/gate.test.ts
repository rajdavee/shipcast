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
  const r = E.runAs({ workspace: ana.ws!, user: 'u000000000000' }, () => E.runClaude({ prompt: 'x', cwd: home, allowedTools: [], onEvent: () => {} } as any));
  assert.match((await r.done).stderr, /Connect your Claude account/);
  assert.equal((await call(me, 'POST', '/api/connect/claude', {})).status, 403, "signing this machine's Claude in is for the install owner only");
  assert.equal((await call(me, 'DELETE', '/api/account/claude')).body.method, 'none');
});

test('review fixes: no path escapes through ids or file names, no secrets through the files route', async () => {
  const s = await call(null, 'POST', '/api/auth/signin', { email: 'ana@test.dev', password: PW });
  const me = { cookie: s.cookie, ws: ana.ws };
  for (const id of ['..%2F..%2F..', '..%2F..%2F..%2Fauth', '%2e%2e', 'a%2Fb'])
    assert.equal((await call(me, 'GET', `/api/campaigns/${id}/files/auth/users.json`)).status, 404, id);
  assert.equal((await call(me, 'GET', '/api/campaigns/..%2F..%2F..%2Fusers/files/x/claude.json')).status, 404);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(home, 'workspaces', ana.ws!, 'campaigns', anaProject, 'secrets.env'), 'API_KEY=shh');
  writeFileSync(join(home, 'workspaces', ana.ws!, 'campaigns', anaProject, '.env.local'), 'X=1');
  assert.equal((await call(me, 'GET', `/api/campaigns/${anaProject}/files/secrets.env`)).status, 403);
  assert.equal((await call(me, 'GET', `/api/campaigns/${anaProject}/files/.env.local`)).status, 403);
});

test('other people\'s runs are sandboxed to their own workspace (macOS sandbox-exec)', { skip: process.platform !== 'darwin' && 'macOS only here' }, async () => {
  const E = await import('@shipcast/engine');
  const { writeFileSync, mkdirSync, realpathSync } = await import('node:fs');
  const users = await E.listUsers();
  const benU = users.find((u) => u.email === 'ben@test.dev')!;
  const anaU = users.find((u) => u.email === 'ana@test.dev')!;
  const benWs = (await E.workspacesFor(benU.id)).find((w) => w.personalOf === benU.id)!.id;
  await E.saveClaudeCredential(benU.id, 'sk-ant-oat01-' + 'y'.repeat(40));
  mkdirSync(join(home, 'workspaces', benWs), { recursive: true });
  writeFileSync(join(home, 'workspaces', benWs, 'mine.txt'), 'MINE');
  // A stand-in for the CLI that tries to read what it shouldn't and reports to stderr.
  const probe = join(mkdtempSync(join(tmpdir(), 'probe-')), 'probe.mjs');
  writeFileSync(probe, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const r = (p) => { try { return readFileSync(p, 'utf8').slice(0, 20); } catch (e) { return 'DENIED'; } };
process.stderr.write(JSON.stringify({ own: r(${JSON.stringify(join(realpathSync(home), 'workspaces', benWs, 'mine.txt'))}), accounts: r(${JSON.stringify(join(realpathSync(home), 'auth', 'users.json'))}), other: r(${JSON.stringify(join(realpathSync(home), 'workspaces', ana.ws!, 'secrets.json'))}), anaClaude: r(${JSON.stringify(join(realpathSync(home), 'users', anaU.id, 'claude.json'))}) }));
`);
  const { chmodSync } = await import('node:fs');
  chmodSync(probe, 0o755);
  const prev = process.env.SHIPCAST_CLAUDE_BIN;
  process.env.SHIPCAST_CLAUDE_BIN = probe;
  try {
    writeFileSync(join(home, 'workspaces', ana.ws!, 'secrets.json'), '{"fal":"ANA"}');
    const r = E.runAs({ workspace: benWs, user: benU.id }, () => E.runClaude({ prompt: 'x', cwd: join(home, 'workspaces', benWs), allowedTools: [], onEvent: () => {} } as any));
    const out = (await r.done).stderr;
    const seen = JSON.parse(out);
    assert.deepEqual(seen, { own: 'MINE', accounts: 'DENIED', other: 'DENIED', anaClaude: 'DENIED' });
    // The person who set the install up is not sandboxed.
    const o = E.runAs({ workspace: ana.ws!, user: anaU.id }, () => E.runClaude({ prompt: 'x', cwd: home, allowedTools: [], onEvent: () => {} } as any));
    assert.notEqual(JSON.parse((await o.done).stderr).accounts, 'DENIED');
  } finally {
    if (prev === undefined) delete process.env.SHIPCAST_CLAUDE_BIN;
    else process.env.SHIPCAST_CLAUDE_BIN = prev;
  }
});

test('review fixes: non-owners get no local folders, app runs, machine GitHub or owner details; invites and roles stay capped', async () => {
  const E = await import('@shipcast/engine');
  const s = await call(null, 'POST', '/api/auth/signin', { email: 'ben@test.dev', password: 'another long password' });
  const acct = await call({ cookie: s.cookie }, 'GET', '/api/account');
  const benWs = acct.body.workspaces.find((w: any) => w.personal).id;
  const me = { cookie: s.cookie, ws: benWs };
  assert.equal((await call(me, 'POST', '/api/campaigns', { source: { type: 'local', value: home }, deliverables: [{ pack: 'carousel' }] })).status, 403);
  assert.equal((await call(me, 'POST', '/api/campaigns', { source: { type: 'url', value: 'https://b.test' }, deliverables: [{ pack: 'app-run' }] })).status, 403);
  assert.equal((await call(me, 'GET', '/api/github/repos')).status, 403);
  const st = (await call(me, 'GET', '/api/status')).body;
  assert.deepEqual(st.logins, {});
  assert.equal(st.github.loggedIn, false);
  // Even the install owner can't make Shipcast's own data a source.
  const a = await call(null, 'POST', '/api/auth/signin', { email: 'ana@test.dev', password: PW });
  assert.equal((await call({ cookie: a.cookie, ws: ana.ws }, 'POST', '/api/campaigns', { source: { type: 'local', value: home }, deliverables: [{ pack: 'carousel' }] })).status, 400);
  // Invites: none to personal workspaces; nobody invites at or above their own role (owners may invite admins).
  assert.equal((await call({ cookie: a.cookie, ws: ana.ws }, 'POST', `/api/workspaces/${ana.ws}/invites`, { role: 'viewer' })).status, 409);
  const team = (await call({ cookie: a.cookie }, 'POST', '/api/workspaces', { name: 'Two' })).body.id;
  assert.equal((await call({ cookie: a.cookie }, 'POST', `/api/workspaces/${team}/invites`, { role: 'admin' })).status, 200);
});

test('review fixes: services take a workspace only from Shipcast itself or a run token; renders read only your files', async () => {
  const E = await import('@shipcast/engine');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const benU = (await E.listUsers()).find((u) => u.email === 'ben@test.dev')!;
  const benWs = (await E.workspacesFor(benU.id)).find((w) => w.personalOf === benU.id)!.id;
  mkdirSync(join(home, 'workspaces', benWs), { recursive: true });
  writeFileSync(join(home, 'workspaces', benWs, 'pic.png'), 'x');
  writeFileSync(join(home, 'workspaces', ana.ws!, 'secret.png'), 'x');
  E.runAs({ workspace: benWs, user: benU.id }, () => {
    assert.equal(E.readableAsset(join(home, 'workspaces', benWs, 'pic.png')), true);
    assert.equal(E.readableAsset(join(home, 'workspaces', ana.ws!, 'secret.png')), false, "another workspace's file");
    assert.equal(E.readableAsset(join(home, 'auth', 'users.json')), false);
    assert.equal(E.readableAsset(join(process.cwd(), 'docs', 'assets', 'mark.svg')), true, "Shipcast's own files");
    assert.throws(() => E.assertInHome(join(home, 'workspaces', ana.ws!, 'out')), /must be inside/);
  });
  // A run token stands for exactly its workspace and person.
  const tok = E.runAs({ workspace: benWs, user: benU.id }, () => E.mintRunToken({ workspace: benWs, user: benU.id }))!;
  assert.deepEqual(await E.resolveRunToken(tok), { workspace: benWs, user: benU.id });
  assert.equal(await E.resolveRunToken('forged-token-value'), null);
  // Through the API, a run token acts as that person in that workspace, and can't reach account routes.
  assert.equal((await call(null, 'GET', '/api/calendar/posts', undefined, { 'x-shipcast-run': tok })).status, 200);
  assert.equal((await call(null, 'GET', '/api/account', undefined, { 'x-shipcast-run': tok })).status, 403);
  assert.equal((await call(null, 'GET', '/api/calendar/posts', undefined, { 'x-shipcast-run': 'forged-token-value' })).status, 401);
});

test('review fixes: parallel wrong passwords still hit the limit; a spoofed forwarded address does not reset it', async () => {
  const { resetRateLimits } = await import('@shipcast/engine');
  resetRateLimits();
  const tries = await Promise.all(Array.from({ length: 30 }, () => call(null, 'POST', '/api/auth/signin', { email: 'ana@test.dev', password: 'nope nope nope' })));
  assert.ok(tries.some((r) => r.status === 429), 'some of 30 parallel guesses are refused');
  const spoof = await call(null, 'POST', '/api/auth/signin', { email: 'zed@test.dev', password: 'nope nope nope' }, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(spoof.status, 429, 'the real address is still over the limit');
  resetRateLimits();
});
