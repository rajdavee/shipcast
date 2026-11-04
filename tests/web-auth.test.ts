import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialKind, decideError, deviceLabel, initials, inviteRoles, passwordHints, perms, removal, roleChoices } from '../apps/web/src/auth-model.ts';
import { passwordProblem, credentialKind as serverKind } from '@shipcast/engine';

test('each role can do what the server allows, and no more', () => {
  const pick = (r: Parameters<typeof perms>[0]) => {
    const p = perms(r);
    return [p.read, p.write, p.manage, p.own].map(Number).join('');
  };
  assert.equal(pick('viewer'), '1000');
  assert.equal(pick('editor'), '1100');
  assert.equal(pick('admin'), '1110');
  assert.equal(pick('owner'), '1111');
  assert.equal(pick(null), '0000');
  assert.equal(pick('nonsense' as never), '0000', 'an unknown role gets nothing');
  assert.equal(perms('viewer', true).install, true, 'installing is about the person, not the workspace role');
  assert.equal(perms('owner').install, false);
});

test('role menus offer only the changes the server would accept', () => {
  assert.deepEqual(roleChoices('owner', 'viewer'), ['owner', 'admin', 'editor', 'viewer']);
  assert.deepEqual(roleChoices('admin', 'editor'), ['editor', 'viewer'], 'admins move people between editor and viewer');
  assert.deepEqual(roleChoices('admin', 'admin'), [], "admins can't touch other admins");
  assert.deepEqual(roleChoices('admin', 'owner'), []);
  assert.deepEqual(roleChoices('editor', 'viewer'), [], 'editors manage nobody');
  assert.deepEqual(roleChoices('owner', 'owner', { owners: 1 }), [], 'the last owner stays owner');
  assert.deepEqual(roleChoices('owner', 'owner', { owners: 2, self: true }), ['owner', 'admin', 'editor', 'viewer']);
  assert.deepEqual(roleChoices('owner', 'owner', { owners: 1, personal: true }), []);
  assert.deepEqual(roleChoices('admin', 'admin', { self: true }), [], 'nobody but an owner changes their own role');
  assert.deepEqual(inviteRoles('owner'), ['admin', 'editor', 'viewer']);
  assert.deepEqual(inviteRoles('admin'), ['editor', 'viewer']);
  assert.deepEqual(inviteRoles('editor'), []);
});

test('remove and leave mirror the server: outrank to remove, anyone may leave, the last owner stays', () => {
  assert.equal(removal('admin', 'editor'), 'remove');
  assert.equal(removal('admin', 'admin'), null);
  assert.equal(removal('owner', 'owner', { owners: 2 }), 'remove');
  assert.equal(removal('owner', 'owner', { owners: 1 }), null);
  assert.equal(removal('viewer', 'viewer', { self: true }), 'leave');
  assert.equal(removal('editor', 'viewer'), null);
  assert.equal(removal('owner', 'owner', { self: true, personal: true }), null, "a personal workspace can't be left");
});

test('what a failed request means for the screen', () => {
  assert.deepEqual(decideError(401, 'Sign in to continue.', '/api/campaigns'), { kind: 'signin' });
  assert.deepEqual(decideError(401, 'Create the first account to set up Shipcast.', '/api/campaigns'), { kind: 'setup' });
  assert.equal(decideError(401, 'Email or password is wrong.', '/api/auth/signin').kind, 'error', "a wrong password isn't a lost session");
  assert.equal(decideError(401, 'Your current password is wrong.', '/api/account/password').kind, 'error');
  assert.deepEqual(decideError(404, 'workspace not found', '/api/calendar/posts'), { kind: 'workspace-gone' });
  assert.deepEqual(decideError(404, 'Workspace not found.', '/api/workspaces/w1/members'), { kind: 'workspace-gone' });
  assert.deepEqual(decideError(404, 'campaign not found', '/api/campaigns/x'), { kind: 'error', message: 'campaign not found' });
  assert.deepEqual(decideError(403, 'Ask a workspace admin to do this.'), { kind: 'forbidden', message: 'Ask a workspace admin to do this.' });
  assert.match((decideError(403, 'missing request header') as { message: string }).message, /reload/, 'the internal guard message is never shown raw');
  assert.deepEqual(decideError(429, 'Too many attempts — wait a few minutes and try again.', '/api/auth/signin'), { kind: 'error', message: 'Too many attempts — wait a few minutes and try again.' });
  assert.deepEqual(decideError(500, ''), { kind: 'error', message: 'Request failed (500)' });
});

test('password hints agree with the server on every rule', () => {
  const cases: [string, string][] = [
    ['short', ''],
    ['aaaaaaaaaaaa', ''],
    ['password12345', ''],
    ['rajdavee-2026!', 'rajdavee@x.com'],
    ['correct horse battery', 'ana@test.dev'],
    ['x'.repeat(201), ''],
    ['a long test password', 'someone@example.com'],
  ];
  for (const [pw, email] of cases) assert.equal(passwordHints(pw, email).problem, passwordProblem(pw, email), `${pw.slice(0, 20)} / ${email}`);
  const h = passwordHints('correct horse battery', 'ana@test.dev').hints;
  assert.ok(h.every((x) => x.ok));
  assert.deepEqual(passwordHints('', '').hints.map((x) => x.ok), [false, false, false], 'nothing is ticked before typing');
  assert.equal(passwordHints('short', '').hints.find((x) => x.id === 'length')!.ok, false);
});

test('pasted Claude credentials are recognised like the server does', () => {
  for (const v of ['sk-ant-oat01-' + 'a'.repeat(40), ' sk-ant-api03-' + 'b_'.repeat(20) + ' ', 'sk-ant-oat01-short', 'hello', '']) assert.equal(credentialKind(v), serverKind(v), v);
});

test('devices and initials read like people wrote them', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'), 'Chrome on macOS');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iOS');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/133.0'), 'Firefox on Windows');
  assert.equal(deviceLabel(''), 'Unknown device');
  assert.equal(initials('Ana Lopez'), 'AL');
  assert.equal(initials("ben's workspace"), 'BW');
  assert.equal(initials(''), '?');
});
