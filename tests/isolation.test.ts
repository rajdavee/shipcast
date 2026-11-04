import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'iso-'));
process.env.SHIPCAST_HOME = root;
const E = await import('@shipcast/engine');
const { runAs, home, rootHome, isId, createCampaign, listCampaigns, readCampaign, savePost, listPosts, setSecret, getSecret, writeSettings, readSettings, saveTone, listTones } = E;

const A = 'wa1b2c3d4e5';
const B = 'wb9z8y7x6w5';
const asA = <T>(fn: () => Promise<T>) => runAs({ workspace: A, user: 'ua1b2c3d4e5' }, fn);
const asB = <T>(fn: () => Promise<T>) => runAs({ workspace: B, user: 'ub1b2c3d4e5' }, fn);
const camp = (name: string) => createCampaign({ name, source: { type: 'url', value: 'https://x.test' }, goal: '', audience: '', tone: '', notes: '', steps: [] });

test('home() follows the workspace in context; the root is untouched outside one', async () => {
  assert.equal(home(), root);
  assert.equal(await asA(async () => home()), join(root, 'workspaces', A));
  assert.equal(await asB(async () => rootHome()), root);
});

test('ids that could become paths are refused', () => {
  for (const bad of ['../etc', 'w..', 'w/abc12345', 'W12345678', '', 'x12345678', 'wabc']) assert.equal(isId(bad), false, bad);
  assert.throws(() => runAs({ workspace: '../../x' }, () => 1), /bad workspace/);
  assert.equal(isId(A), true);
});

test('projects, calendar, secrets, settings and voices never cross workspaces', async () => {
  const a = await asA(() => camp('A project'));
  await asB(() => camp('B project'));
  assert.deepEqual((await asA(() => listCampaigns())).map((c) => c.name), ['A project']);
  assert.deepEqual((await asB(() => listCampaigns())).map((c) => c.name), ['B project']);
  assert.equal(await asB(() => readCampaign(a.id)), null, "B can't open A's project by id");
  assert.deepEqual(await listCampaigns(), [], 'nothing leaked to the root');

  await asA(() => savePost({ title: 'A post', channels: [] }));
  assert.deepEqual((await asB(() => listPosts())).map((p) => p.title), []);
  assert.deepEqual((await asA(() => listPosts())).map((p) => p.title), ['A post']);

  await asA(() => setSecret('postiz', 'A-KEY'));
  assert.equal(await asB(() => getSecret('postiz')), undefined);
  assert.equal(await asA(() => getSecret('postiz')), 'A-KEY');

  await asA(() => writeSettings({ genCapPerMonth: 99 }));
  assert.notEqual((await asB(() => readSettings())).genCapPerMonth, 99);

  await asB(() => saveTone({ name: 'B voice' } as any));
  assert.ok(!(await asA(() => listTones())).some((t) => t.name === 'B voice'));
  assert.ok(existsSync(join(root, 'workspaces', A, 'campaigns')));
});

test('concurrent work in two workspaces keeps its context across awaits', async () => {
  const both = await Promise.all([asA(async () => { await new Promise((r) => setTimeout(r, 20)); return home(); }), asB(async () => home())]);
  assert.deepEqual(both, [join(root, 'workspaces', A), join(root, 'workspaces', B)]);
});
