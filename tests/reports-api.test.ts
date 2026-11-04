import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const home = mkdtempSync(join(tmpdir(), 'shipcast-reports-api-'));
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_SKILLHUB = 'off';
process.env.SHIPCAST_CLAUDE_BIN = join(import.meta.dirname, 'fake-claude.mjs');

const { createApp } = await import('@shipcast/api');
const app = createApp({ serveWeb: false });
let base = '';
before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.close();
  rmSync(home, { recursive: true, force: true });
});

type Who = { cookie: string; ws: string };
const call = async (who: Who | null, method: string, path: string, json?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) Object.assign(headers, { cookie: who.cookie, 'x-shipcast-workspace': who.ws });
  if (method !== 'GET') headers['x-shipcast'] = '1';
  const r = await fetch(base + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const PW = 'a long test password';
const D = 86_400_000;

test('reports: an editor makes, edits and acts on a report; a viewer reads; other workspaces see nothing', async () => {
  const s = await call(null, 'POST', '/api/auth/signup', { email: 'ana@test.dev', password: PW, name: 'Ana' });
  const cookie = (await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@test.dev', password: PW }) })).headers.get('set-cookie')!.split(';')[0];
  const ana: Who = { cookie, ws: s.body.workspace };

  // A week of posts with numbers (and three older ones so lifts exist).
  const mk = async (title: string, daysAgo: number, reach: number) => {
    const sent = new Date(Date.now() - daysAgo * D).toISOString();
    const p = (await call(ana, 'POST', '/api/calendar/posts', { title, at: sent, status: 'published', channels: [{ channel: 'linkedin', caption: `${title}?`, hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: sent }] })).body;
    const r = await call(ana, 'POST', '/api/metrics/snapshots', { post: p.id, channel: 'linkedin', source: 'manual', reach, likes: Math.round(reach / 40), at: new Date(Date.parse(sent) + 2 * D).toISOString() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return p;
  };
  for (const [i, r] of [500, 450, 550].entries()) await mk(`Old ${i}`, 30 + i, r);
  const star = await mk('Big win', 4, 2500);
  await mk('Quiet one', 3, 300);

  assert.equal((await call(ana, 'PUT', '/api/reports/goals', { goals: [{ metric: 'posts', target: 12, per: 'month' }, { metric: 'bogus', target: 3, per: 'week' }] })).body.length, 1, 'unknown metrics are dropped');
  const note = await call(ana, 'POST', '/api/reports/notes', { date: new Date(Date.now() - 2 * D).toISOString().slice(0, 10), text: 'Pricing page launched' });
  assert.equal(note.status, 200);
  assert.equal((await call(ana, 'POST', '/api/reports/notes', { date: 'yesterday', text: 'x' })).status, 400);

  const made = await call(ana, 'POST', '/api/reports', { kind: 'last7', audience: 'team', writer: 'template' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const rep = made.body;
  assert.equal(rep.facts.totals.posts, 2);
  assert.equal(rep.facts.top[0].post, star.id);
  assert.equal(rep.facts.goals[0].metric, 'posts');
  assert.ok(rep.sections.find((x: any) => x.id === 'why').lines.some((l: string) => /Pricing page launched/.test(l)), 'the team note explains');
  assert.equal(rep.by, s.body.user.id);
  assert.equal((await call(ana, 'GET', '/api/reports')).body[0].id, rep.id);

  const edited = await call(ana, 'PUT', `/api/reports/${rep.id}`, { headline: 'A strong week', intro: 'Hi team —' });
  assert.equal(edited.body.headline, 'A strong week');
  assert.equal((await call(ana, 'GET', `/api/reports/${rep.id}/versions`)).body.length, 1);
  const rw = await call(ana, 'POST', `/api/reports/${rep.id}/rewrite`, { audience: 'boss', writer: 'template' });
  assert.equal(rw.body.audience, 'boss');
  assert.equal((await call(ana, 'POST', `/api/reports/${rep.id}/restore`, { version: 2 })).body.headline, 'A strong week');
  assert.equal((await call(ana, 'POST', `/api/reports/${rep.id}/restore`, { version: 99 })).status, 404);

  const more = rep.recommendations.find((r: any) => r.kind === 'more-like-this');
  assert.ok(more, JSON.stringify(rep.recommendations));
  const act = await call(ana, 'POST', `/api/reports/${rep.id}/actions/${more.id}`);
  assert.equal(act.status, 200, JSON.stringify(act.body));
  assert.equal(act.body.created[0].status, 'idea');
  assert.equal((await call(ana, 'POST', `/api/reports/${rep.id}/actions/r9`)).status, 404);

  // A viewer in a team workspace reads but can't make or change reports.
  const team = (await call(ana, 'POST', '/api/workspaces', { name: 'Acme' })).body.id;
  const anaTeam: Who = { cookie, ws: team };
  const teamRep = (await call(anaTeam, 'POST', '/api/reports', { kind: 'last30', writer: 'template' })).body;
  assert.equal(teamRep.facts.totals.posts, 0, 'the team workspace has its own (empty) data');
  const inv = await call(anaTeam, 'POST', `/api/workspaces/${team}/invites`, { role: 'viewer', email: 'ben@test.dev' });
  const b = await call(null, 'POST', '/api/auth/signup', { email: 'ben@test.dev', password: PW, invite: inv.body.link.split('/').pop() });
  const benCookie = (await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ben@test.dev', password: PW }) })).headers.get('set-cookie')!.split(';')[0];
  const benTeam: Who = { cookie: benCookie, ws: team };
  assert.equal(b.status, 200);
  assert.equal((await call(benTeam, 'GET', `/api/reports/${teamRep.id}`)).status, 200);
  assert.equal((await call(benTeam, 'POST', '/api/reports', { writer: 'template' })).status, 403);
  assert.equal((await call(benTeam, 'PUT', `/api/reports/${teamRep.id}`, { headline: 'x' })).status, 403);
  assert.equal((await call(benTeam, 'DELETE', `/api/reports/${teamRep.id}`)).status, 403);
  assert.equal((await call(benTeam, 'GET', `/api/reports/${rep.id}`)).status, 404, "Ana's personal report means nothing in the team");
  assert.equal((await call(anaTeam, 'GET', `/api/reports/${rep.id}`)).status, 404);
  assert.equal((await call(ana, 'GET', '/api/reports/..%2F..%2Fauth%2Fusers')).status, 404);

  assert.equal((await call(ana, 'DELETE', `/api/reports/${rep.id}`)).status, 200);
  assert.equal((await call(ana, 'GET', `/api/reports/${rep.id}`)).status, 404);
});

test('reports: Claude writes the words when it can (fake Claude here), checked against the facts', async () => {
  const cookie = (await fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@test.dev', password: PW }) })).headers.get('set-cookie')!.split(';')[0];
  const ws = (await call({ cookie, ws: '' }, 'GET', '/api/account')).body.workspaces.find((w: any) => w.personal).id;
  const r = await call({ cookie, ws }, 'POST', '/api/reports', { kind: 'last7' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(['claude', 'mixed', 'template'].includes(r.body.writer));
  assert.ok(r.body.headline.length > 0);
});
