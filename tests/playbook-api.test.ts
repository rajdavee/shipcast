import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const home = mkdtempSync(join(tmpdir(), 'shipcast-playbook-api-'));
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_SKILLHUB = 'off';
process.env.SHIPCAST_CLAUDE_BIN = join(import.meta.dirname, 'fake-claude.mjs');

const { createApp } = await import('@shipcast/api');

let base = '';
const app = createApp({ serveWeb: false });
let S: Awaited<ReturnType<typeof import('./helpers/session.ts').signedIn>>;
before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
  S = await (await import('./helpers/session.ts')).signedIn(base, home);
  // Direct engine calls in these tests work in the same workspace as the API.
  (await import('@shipcast/engine')).setProcessContext({ workspace: S.workspace, user: S.user });
});
after(() => {
  app.close();
  rmSync(home, { recursive: true, force: true });
});

const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...S.headers }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('playbook API: empty state, refresh from numbers, forecast a draft, scheduled posts are scored', async () => {
  assert.deepEqual((await api('/api/metrics/playbook')).body, { computedAt: null, channels: [] });
  assert.equal((await api('/api/metrics/forecast/nope')).status, 404);

  // Ten LinkedIn posts a day apart: PDF carousels reach about twice as many people as text posts.
  for (let i = 0; i < 10; i++) {
    const sent = new Date(Date.UTC(2026, 8, 1 + i, 4)).toISOString();
    const pdf = i % 2 === 0;
    const p = (await api('/api/calendar/posts', { method: 'POST', json: { title: `p${i}`, at: sent, status: 'published', channels: [{ channel: 'linkedin', caption: `How to ship launch ${i}`, hashtags: [], media: pdf ? ['out/deck.pdf'] : [], via: 'manual', state: 'sent', sentAt: sent }] } })).body;
    const reach = (pdf ? 2000 : 1000) + i * 37;
    const r = await api('/api/metrics/snapshots', { method: 'POST', json: { post: p.id, channel: 'linkedin', reach, likes: Math.round(reach / 20), at: new Date(Date.parse(sent) + 168 * 3_600_000).toISOString() } });
    assert.equal(r.status, 200);
  }
  const pb = (await api('/api/metrics/playbook/refresh', { method: 'POST', json: { narrative: false } })).body;
  const li = pb.channels.find((c: any) => c.channel === 'linkedin');
  assert.ok(li.ready);
  assert.equal(li.n, 10);
  assert.equal(li.wins[0].level, 'pdf-carousel');
  assert.equal(li.wins[0].posts.length, 5);
  assert.deepEqual(li.model.boot, [], 'bootstrap draws stay on disk');
  assert.ok((await api('/api/metrics/playbook')).body.computedAt);
  assert.ok(JSON.parse(readFileSync(join(S.dir, 'metrics', 'playbook.json'), 'utf8')).channels[0].model.boot.length > 0);

  const at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const draft = (await api('/api/calendar/posts', { method: 'POST', json: { title: 'draft', at, status: 'draft', channels: [{ channel: 'linkedin', caption: 'How to plan a launch', hashtags: [], media: ['out/deck.pdf'], via: 'manual' }, { channel: 'x', caption: 'short', hashtags: [], media: [], via: 'manual' }] } })).body;
  const f = (await api(`/api/metrics/forecast/${draft.id}`)).body;
  const fl = f.forecasts.find((x: any) => x.channel === 'linkedin').forecast;
  assert.ok(fl.lift > 1 && fl.lo < fl.lift && fl.hi > fl.lift);
  assert.match(fl.label, /^likely .+× your usual$/);
  assert.equal(f.forecasts.find((x: any) => x.channel === 'x').forecast, null, 'no X model yet');

  assert.equal((await api(`/api/calendar/posts/${draft.id}`, { method: 'PUT', json: { status: 'scheduled' } })).status, 200);
  const stored = JSON.parse(readFileSync(join(S.dir, 'metrics', 'forecasts.json'), 'utf8'));
  assert.deepEqual(stored.map((s: any) => [s.post, s.channel]), [[draft.id, 'linkedin']]);
  const cal = (await api('/api/metrics/calibration')).body;
  assert.deepEqual({ n: cal.n, inside: cal.inside, rank: cal.rank }, { n: 0, inside: null, rank: null }, 'nothing to score until it has numbers');
});
