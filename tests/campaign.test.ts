import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

// Full-campaign flows against a scripted Claude: ask-and-resume, secrets, plan → jobs → hub, usage limits.
const home = mkdtempSync(join(tmpdir(), 'shipcast-campaign-'));
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_SKILLHUB = 'off';
process.env.SHIPCAST_NOTIFY = 'off';
process.env.SHIPCAST_CLAUDE_BIN = join(import.meta.dirname, 'fake-claude.mjs');
delete process.env.TEST_LICENSE_KEY;

const { createApp } = await import('@shipcast/api');
const { startWorker } = await import('@shipcast/worker');

let base = '';
const app = createApp({ serveWeb: false });
const worker = startWorker({ intervalMs: 50, log: () => {} });
const src = mkdtempSync(join(tmpdir(), 'shipcast-src-'));

before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(async () => {
  await worker.stop();
  app.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
});

const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
async function waitFor(id: string, pred: (c: any) => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const c = (await api(`/api/campaigns/${id}`)).body;
    if (pred(c)) return c;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${JSON.stringify((await api(`/api/campaigns/${id}`)).body.steps.map((s: any) => [s.pack, s.status, s.error]))}`);
}
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);

test('an app step asks for a secret, resumes with it, and the secret never lands in outputs', async () => {
  const c = await api('/api/campaigns', { method: 'POST', json: { name: 'Ask', source: { type: 'local', value: src }, deliverables: [{ pack: 'app-run' }] } });
  assert.equal(c.status, 200);
  const id = c.body.id;
  const asked = await waitFor(id, (x) => x.steps[1].status === 'needs-input');
  const step = asked.steps[1];
  assert.equal(step.question.text, 'Paste the licence key');
  assert.deepEqual(step.question.fields.map((f: any) => [f.key, f.secret]), [['TEST_LICENSE_KEY', true]]);

  const secret = 'th_live_supersecret42';
  const ans = await api(`/api/campaigns/${id}/steps/${step.id}/answer`, { method: 'POST', json: { values: { TEST_LICENSE_KEY: secret } } });
  assert.equal(ans.status, 200);
  const env = await api(`/api/campaigns/${id}/env`);
  assert.deepEqual(env.body.keys, ['TEST_LICENSE_KEY']);
  assert.ok(!JSON.stringify(env.body).includes(secret), 'env API returns names only');

  const done = await waitFor(id, (x) => x.steps[1].status === 'done');
  assert.ok(done.steps[1].outputs.includes('out/app.json'));
  const dir = join(home, 'campaigns', id);
  const setup = readFileSync(join(dir, 'deliverables', step.id, 'out', 'setup.md'), 'utf8');
  assert.ok(setup.includes('•••') && !setup.includes(secret), 'secret scrubbed from outputs');
  for (const f of walk(join(dir, 'deliverables')).concat(join(dir, 'campaign.json'), join(dir, 'events.ndjson'))) {
    if (f.endsWith('secrets.env')) continue;
    assert.ok(!readFileSync(f, 'utf8').includes(secret), `secret leaked into ${f}`);
  }
});

test('a campaign plan becomes one job per valid asset, then a hub that packages them', async () => {
  const c = await api('/api/campaigns', { method: 'POST', json: { name: 'Plan', source: { type: 'url', value: 'example.com' }, deliverables: [{ pack: 'campaign-plan', options: { size: 'focused' } }] } });
  const id = c.body.id;
  const done = await waitFor(id, (x) => x.steps.length >= 4 && x.steps.every((s: any) => s.status === 'done'), 30_000);
  const packs = done.steps.map((s: any) => s.pack).filter(Boolean);
  assert.deepEqual(packs, ['campaign-plan', 'copy-kit', 'campaign-hub'], 'unknown packs dropped, hub last');
  const copy = done.steps.find((s: any) => s.pack === 'copy-kit');
  assert.equal(copy.options._title, 'Launch copy');
  assert.equal(copy.options.voice, 'brand');
  assert.equal(copy.options.bogus, undefined, 'unknown options dropped');
  const hub = done.steps.find((s: any) => s.pack === 'campaign-hub');
  const index = hub.outputs.find((o: string) => o.endsWith('index.html'));
  assert.ok(index && hub.outputs.some((o: string) => o.endsWith('.zip')));
  const html = readFileSync(join(home, 'campaigns', id, 'deliverables', hub.id, index), 'utf8');
  assert.ok(html.includes('One line.') && html.includes('Launch copy') && html.includes('Calendar'));
  assert.ok(existsSync(join(home, 'campaigns', id, 'brief', 'CAMPAIGN-BRIEF.md')), 'campaign brief promoted for later steps');

  // Nothing here has a spec to re-render.
  assert.equal((await api(`/api/campaigns/${id}/rerender`, { method: 'POST', json: {} })).status, 400);
});

test("Claude's usage limit pauses the step until the window resets instead of failing it", async () => {
  process.env.FAKE_CLAUDE_MODE = 'limit';
  const c = await api('/api/campaigns', { method: 'POST', json: { name: 'Limit', source: { type: 'url', value: 'example.com' }, deliverables: [{ pack: 'copy-kit' }] } });
  const id = c.body.id;
  const paused = await waitFor(id, (x) => x.steps[0].status === 'queued' && !!x.steps[0].notBefore);
  delete process.env.FAKE_CLAUDE_MODE;
  const brief = paused.steps[0];
  assert.ok(Date.parse(brief.notBefore) > Date.now() + 30 * 60_000, 'waits for the reset');
  assert.ok(String(brief.pendingNote).startsWith('[resume]'), 'resumes its own session');
  assert.ok(existsSync(join(home, 'usage-pause.json')));
  rmSync(join(home, 'usage-pause.json'));
  await api(`/api/campaigns/${id}/steps/brief/cancel`, { method: 'POST', json: {} });
});

test('the app can be started and stopped from its recorded commands, with the campaign env', async () => {
  const list = (await api('/api/campaigns')).body;
  const c = list.find((x: any) => x.name === 'Ask');
  const step = c.steps.find((s: any) => s.pack === 'app-run');
  const dir = join(home, 'campaigns', c.id, 'deliverables', step.id);
  const port = 40000 + Math.floor(Math.random() * 20000);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'work', 'app'), { recursive: true });
  // The server only starts with the user's secret, like a real app would.
  writeFileSync(join(dir, 'work', 'app', 'server.mjs'), `if (!process.env.TEST_LICENSE_KEY) process.exit(1); (await import('node:http')).createServer((q, r) => r.end('ok')).listen(${port});`);
  writeFileSync(join(dir, 'out', 'app.json'), JSON.stringify({ url: `http://127.0.0.1:${port}`, start: [`mkdir -p work/pids work/logs && (nohup node work/app/server.mjs > work/logs/web.log 2>&1 & echo $! > work/pids/web.pid)`], stop: ['kill $(cat work/pids/*.pid) 2>/dev/null; true'] }));
  assert.equal((await api(`/api/campaigns/${c.id}/app`)).body.up, false);
  const started = await api(`/api/campaigns/${c.id}/app/start`, { method: 'POST', json: {} });
  assert.equal(started.body.up, true, started.body.log?.join(' | '));
  const stopped = await api(`/api/campaigns/${c.id}/app/stop`, { method: 'POST', json: {} });
  assert.equal(stopped.body.up, false);
  // Deleting the campaign must not leave anything behind either.
  assert.equal((await api(`/api/campaigns/${c.id}`, { method: 'DELETE' })).status, 200);
});
