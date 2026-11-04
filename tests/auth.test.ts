import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'auth-'));
process.env.SHIPCAST_HOME = root;
const A = await import('@shipcast/engine');
const { signUp, signIn, sessionUser, signOut, signOutAll, changePassword, createInvite, acceptInvite, createWorkspace, setMemberRole, removeMember, deleteWorkspace, workspacesFor, roleIn, can, hashPassword, verifyPassword, passwordProblem, setOpenSignup, resetRateLimits, listWorkspaces, invitesFor, revokeInvite, sessionsOf } = A;

const PW = 'correct horse battery';

test('passwords: scrypt, verified in constant time, weak ones refused', async () => {
  const h = await hashPassword(PW);
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword(PW, h), true);
  assert.equal(await verifyPassword('wrong password!!', h), false);
  assert.equal(await verifyPassword(PW, 'garbage'), false);
  assert.match(passwordProblem('short')!, /10 characters/);
  assert.match(passwordProblem('aaaaaaaaaaaa')!, /easy/);
  assert.match(passwordProblem('rajdavee-2026!', 'rajdavee@x.com')!, /email/);
  assert.equal(passwordProblem(PW), null);
});

test('the first account owns the install and inherits the existing single-user data', async () => {
  mkdirSync(join(root, 'campaigns', 'c1'), { recursive: true });
  writeFileSync(join(root, 'campaigns', 'c1', 'campaign.json'), '{}');
  writeFileSync(join(root, 'secrets.json'), '{"postiz":"k"}');
  mkdirSync(join(root, 'skills'), { recursive: true });
  const r = await signUp({ email: ' Owner@Example.com ', password: PW, name: 'Raj' });
  assert.equal(r.user.email, 'owner@example.com');
  assert.equal(r.user.installOwner, true);
  assert.equal(r.workspace.personalOf, r.user.id);
  assert.deepEqual(r.migrated?.sort(), ['campaigns', 'secrets.json']);
  assert.ok(existsSync(join(root, 'workspaces', r.workspace.id, 'campaigns', 'c1', 'campaign.json')));
  assert.ok(!existsSync(join(root, 'campaigns')));
  assert.ok(existsSync(join(root, 'skills')), 'machine-wide caches stay where they are');
  assert.equal(statSync(join(root, 'auth', 'users.json')).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(root, 'auth', 'users.json'), 'utf8').includes(PW));
  // Without an invite the answer doesn't reveal whether the email has an account.
  await assert.rejects(signUp({ email: 'owner@example.com', password: PW }), /invite/);
});

test('later sign-ups need an invite unless the owner opens sign-up', async () => {
  await assert.rejects(signUp({ email: 'stranger@example.com', password: PW }), /invite/);
  await setOpenSignup(true);
  const s = await signUp({ email: 'stranger@example.com', password: PW });
  assert.equal(s.user.installOwner, undefined);
  assert.equal(s.migrated, undefined);
  await setOpenSignup(false);
});

test('sign-in, sessions, sign-out and the rate limit', async () => {
  resetRateLimits();
  const { token, user } = await signIn('OWNER@example.com', PW, { ip: '1.2.3.4' });
  assert.equal((await sessionUser(token))?.user.id, user.id);
  assert.equal(await sessionUser('nope-nope-nope-nope-nope'), null);
  assert.ok(!readFileSync(join(root, 'auth', 'sessions.json'), 'utf8').includes(token), 'only the hash is stored');
  await assert.rejects(signIn('owner@example.com', 'wrong password!!'), /wrong/);
  await assert.rejects(signIn('nobody@example.com', PW), /wrong/, 'same message for unknown accounts');
  await signOut(token);
  assert.equal(await sessionUser(token), null);
  for (let i = 0; i < 10; i++) await signIn('owner@example.com', 'bad password 123', { ip: '9.9.9.9' }).catch(() => {});
  await assert.rejects(signIn('owner@example.com', PW, { ip: '9.9.9.9' }), /Too many/);
  resetRateLimits();
});

test('changing the password signs out every other session', async () => {
  const a = await signIn('owner@example.com', PW);
  const b = await signIn('owner@example.com', PW);
  await assert.rejects(changePassword(a.user.id, 'not it at all!', 'new password here 1'), /current password/);
  await changePassword(a.user.id, PW, 'new password here 1', a.token);
  assert.ok(await sessionUser(a.token));
  assert.equal(await sessionUser(b.token), null);
  assert.equal((await sessionsOf(a.user.id, a.token)).filter((s) => s.current).length, 1);
  await changePassword(a.user.id, 'new password here 1', PW, a.token);
  await signOutAll(a.user.id);
  assert.equal(await sessionUser(a.token), null);
});

test('team workspaces: invites, roles and their limits', async () => {
  const owner = (await signIn('owner@example.com', PW)).user;
  const team = await createWorkspace(owner.id, 'Acme marketing');
  const inv = await createInvite(team.id, 'editor', owner.id, 'ed@example.com');
  assert.equal((await invitesFor(team.id)).length, 1);
  await assert.rejects(signUp({ email: 'other@example.com', password: PW, invite: inv.token }), /different email/);
  const ed = await signUp({ email: 'ed@example.com', password: PW, invite: inv.token });
  assert.equal(await roleIn(ed.user.id, team.id), 'editor');
  assert.deepEqual((await workspacesFor(ed.user.id)).map((w) => w.name).sort(), ["ed's workspace", 'Acme marketing'].sort());
  await assert.rejects(signUp({ email: 'ed2@example.com', password: PW, invite: inv.token }), /already been used|invite/);

  const v = await createInvite(team.id, 'viewer', owner.id);
  const stranger = (await signIn('stranger@example.com', PW)).user;
  await acceptInvite(v.token, stranger.id);
  assert.equal(await roleIn(stranger.id, team.id), 'viewer');
  await assert.rejects(acceptInvite(v.token, stranger.id), /already been used/);
  const x = await createInvite(team.id, 'viewer', owner.id);
  assert.ok(await revokeInvite(team.id, (await invitesFor(team.id))[0].id));
  await assert.rejects(acceptInvite(x.token, ed.user.id), /not valid/);

  assert.equal(can('viewer', 'read'), true);
  assert.equal(can('viewer', 'write'), false);
  assert.equal(can('editor', 'write'), true);
  assert.equal(can('editor', 'manage'), false);
  assert.equal(can('admin', 'manage'), true);
  assert.equal(can('admin', 'own'), false);
  assert.equal(can(null, 'read'), false);

  await assert.rejects(setMemberRole(team.id, ed.user.id, 'admin', 'admin'), /Only an owner/);
  await setMemberRole(team.id, ed.user.id, 'admin', 'owner');
  await assert.rejects(setMemberRole(team.id, owner.id, 'editor', 'owner'), /at least one owner/);
  await assert.rejects(removeMember(team.id, owner.id, { user: ed.user.id, role: 'admin' }), /same or a higher|last owner/);
  await removeMember(team.id, stranger.id, { user: ed.user.id, role: 'admin' });
  assert.equal(await roleIn(stranger.id, team.id), null, 'removed members lose access at once');
  await assert.rejects(removeMember(team.id, owner.id, { user: owner.id, role: 'owner' }), /last owner/);

  const personal = (await workspacesFor(owner.id)).find((w) => w.personalOf === owner.id)!;
  await assert.rejects(deleteWorkspace(personal.id), /Personal/);
  mkdirSync(join(root, 'workspaces', team.id), { recursive: true });
  await deleteWorkspace(team.id);
  assert.ok(!(await listWorkspaces()).some((w) => w.id === team.id));
  assert.equal(await roleIn(ed.user.id, team.id), null);
});
