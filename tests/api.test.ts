import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

// Isolate the data dir and swap the claude CLI for a scripted fake.
const home = mkdtempSync(join(tmpdir(), 'shipcast-test-'));
const log = join(home, 'claude-calls.ndjson');
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_SKILLHUB = 'off';
process.env.SHIPCAST_CLAUDE_BIN = join(import.meta.dirname, 'fake-claude.mjs');
process.env.FAKE_CLAUDE_LOG = log;

const { createApp } = await import('@shipcast/api');
const { startWorker } = await import('@shipcast/worker');

let base = '';
const app = createApp({ serveWeb: false });
const worker = startWorker({ intervalMs: 50, log: () => {} });

before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(async () => {
  await worker.stop();
  app.close();
  rmSync(home, { recursive: true, force: true });
});

const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function waitFor(id: string, pred: (c: any) => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { body } = await api(`/api/campaigns/${id}`);
    if (pred(body)) return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

test('rejects bad input', async () => {
  assert.equal((await api('/api/campaigns', { method: 'POST', json: {} })).status, 400);
  assert.equal((await api('/api/campaigns', { method: 'POST', json: { source: { type: 'url', value: 'x.dev' }, deliverables: [] } })).status, 400);
  assert.equal((await api('/api/campaigns', { method: 'POST', json: { source: { type: 'url', value: 'x.dev' }, deliverables: [{ pack: 'nope' }] } })).status, 400);
  const bad = await api('/api/campaigns', { method: 'POST', json: { source: { type: 'url', value: 'x.dev' }, deliverables: [{ pack: 'carousel', options: { platform: 'myspace' } }] } });
  assert.equal(bad.status, 400);
});

test('blocks cross-site writes and foreign hosts', async () => {
  const r = await fetch(base + '/api/campaigns', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('lists packs with install status', async () => {
  const { body } = await api('/api/packs');
  const carousel = body.find((p: any) => p.id === 'carousel');
  assert.ok(carousel);
  assert.equal(carousel.prompt, undefined);
  assert.ok(Array.isArray(carousel.skills));
});

test('campaign runs brief then deliverable, then revises with --resume', async () => {
  const created = await api('/api/campaigns', {
    method: 'POST',
    json: { name: 'Demo', source: { type: 'url', value: 'example.com' }, goal: 'launch', deliverables: [{ pack: 'copy-kit', options: { voice: 'brand' } }] },
  });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.equal(created.body.source.value, 'https://example.com');
  assert.equal(created.body.steps[1].options.voice, 'brand');
  assert.equal(created.body.steps[1].options.channels, 'all');

  const done = await waitFor(id, (c) => c.steps.every((s: any) => s.status === 'done'));
  const step = done.steps[1];
  assert.deepEqual(step.outputs, ['out/NOTES.md', 'out/copy.json', 'out/copy.md']);
  assert.ok(step.sessionId);

  // Brief must run first, in the brief folder, with sub-agents blocked for this pack.
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls[0].cwd.endsWith('/brief'));
  assert.ok(calls[1].args.includes('--disallowedTools'));
  assert.ok(calls[1].args.includes('--plugin-dir'));

  // Files are served with a sandbox CSP and range support.
  const f = await fetch(`${base}/api/campaigns/${id}/files/deliverables/${step.id}/out/copy.md`, { headers: { range: 'bytes=0-1' } });
  assert.equal(f.status, 206);
  assert.equal(await f.text(), '# ');
  assert.match(f.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.equal((await fetch(`${base}/api/campaigns/${id}/files/../../settings.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/campaigns/${id}/files/%2e%2e%2f%2e%2e%2fx`)).status, 403);

  const rev = await api(`/api/campaigns/${id}/steps/${step.id}/revise`, { method: 'POST', json: { note: 'bigger headline' } });
  assert.equal(rev.status, 200);
  const revised = await waitFor(id, (c) => c.steps[1].status === 'done' && c.steps[1].revisions.length === 1);
  assert.equal(revised.steps[1].revisions[0].note, 'bigger headline');
  const last = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.equal(last.args[last.args.indexOf('--resume') + 1], step.sessionId);
  const notes = await fetch(`${base}/api/campaigns/${id}/files/deliverables/${step.id}/out/NOTES.md`);
  assert.equal(await notes.text(), 'revised');

  // Event log captured the stream.
  const sse = await fetch(`${base}/api/campaigns/${id}/events`);
  const reader = sse.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  assert.match(new TextDecoder().decode(value), /event: log/);
});

test('failed brief blocks deliverables; retry unblocks', async () => {
  process.env.FAKE_CLAUDE_MODE = 'fail';
  const { body } = await api('/api/campaigns', { method: 'POST', json: { source: { type: 'text', value: 'A todo app for cats' }, deliverables: [{ pack: 'copy-kit' }] } });
  const failed = await waitFor(body.id, (c) => c.steps[0].status === 'failed' && c.steps[1].status === 'blocked');
  assert.match(failed.steps[0].error, /boom/);
  delete process.env.FAKE_CLAUDE_MODE;
  await api(`/api/campaigns/${body.id}/steps/brief/retry`, { method: 'POST' });
  await waitFor(body.id, (c) => c.steps.every((s: any) => s.status === 'done'));
});

test('cancel stops a running step', async () => {
  process.env.FAKE_CLAUDE_MODE = 'hang';
  try {
    const { body } = await api('/api/campaigns', { method: 'POST', json: { source: { type: 'url', value: 'example.org' }, deliverables: [{ pack: 'thumbnails' }] } });
    await waitFor(body.id, (c) => c.steps[0].status === 'running');
    await api(`/api/campaigns/${body.id}/steps/brief/cancel`, { method: 'POST' });
    // Downstream steps are blocked just after the brief is marked canceled.
    const c = await waitFor(body.id, (x) => x.steps[0].status === 'canceled' && x.steps[1].status !== 'queued', 8000);
    assert.equal(c.steps[1].status, 'blocked');
  } finally {
    delete process.env.FAKE_CLAUDE_MODE;
  }
});

test('settings accept known fields only', async () => {
  const r = await api('/api/settings', { method: 'PUT', json: { subagents: 'never', model: 'sonnet', stepTimeoutMinutes: 2, bogus: 1 } });
  assert.equal(r.body.subagents, 'never');
  assert.equal(r.body.model, 'sonnet');
  assert.equal(r.body.stepTimeoutMinutes, 5);
  assert.equal(r.body.bogus, undefined);
  assert.equal((await api('/api/settings', { method: 'PUT', json: { subagents: 'always' } })).body.subagents, 'never');
});

test('files route refuses symlinks that point outside the campaign', async () => {
  const { symlinkSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { body } = await api('/api/campaigns', { method: 'POST', json: { source: { type: 'text', value: 'A tool that does something useful for people' }, deliverables: [{ pack: 'copy-kit' }] } });
  const secret = join(home, 'secret.txt');
  writeFileSync(secret, 'top secret');
  const dir = join(home, 'campaigns', body.id, 'uploads');
  mkdirSync(dir, { recursive: true });
  symlinkSync(secret, join(dir, 'link.txt'));
  assert.equal((await fetch(`${base}/api/campaigns/${body.id}/files/uploads/link.txt`)).status, 403);
  await waitFor(body.id, (c) => c.steps.every((s: any) => s.status === 'done'));
});

test('voice defaults to local Kokoro and never exposes a key', async () => {
  const v = await api('/api/voice');
  assert.equal(v.body.provider, 'kokoro');
  assert.equal(v.body.connected, false);
  assert.equal(JSON.stringify(v.body).includes('apiKey'), false);
  const off = await api('/api/voice/elevenlabs', { method: 'DELETE' });
  assert.equal(off.body.provider, 'kokoro');
  const s = await api('/api/settings');
  assert.equal(s.body.voiceProvider, 'kokoro');
  assert.equal(JSON.stringify(s.body).includes('sk_'), false);
});

test('brainstorm asks first, then offers directions', async () => {
  const source = { type: 'text', value: 'A habit tracker for remote teams' };
  const first = await api('/api/brainstorm', { method: 'POST', json: { source, formats: ['reel'] } });
  assert.equal(first.status, 200);
  assert.equal(first.body.questions[0].id, 'audience');
  assert.ok(first.body.questions[0].options.length >= 2);
  const second = await api('/api/brainstorm', { method: 'POST', json: { source, formats: ['reel'], asked: first.body.questions, answers: { audience: 'Team leads' } } });
  assert.equal(second.body.directions[0].title, 'The 30-second standup');
  assert.deepEqual(second.body.questions, []);
});

test('drawing board turns a direction into sketchable beats', async () => {
  const r = await api('/api/brainstorm/board', { method: 'POST', json: { source: { type: 'text', value: 'Voice standups' }, formats: ['reel'], direction: { id: 'd1', title: 'T', hook: 'H', angle: 'A', tone: 'warm' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.beats.map((b: any) => b.scene), ['kinetic', 'product', 'outro']);
});

test('background agents: list, switch off, change cadence, run now, settings', async () => {
  const list = await api('/api/agents');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.jobs.map((j: any) => j.id), ['learn', 'trends', 'golden']);
  assert.equal(list.body.cap, 6);
  const off = await api('/api/agents/trends', { method: 'PUT', json: { enabled: false, every: 5 } });
  const t = off.body.find((j: any) => j.id === 'trends');
  assert.equal(t.enabled, false);
  assert.equal(t.every, 30, 'cadence is clamped to at least 30 minutes');
  assert.equal((await api('/api/agents/learn/run', { method: 'POST' })).body.find((j: any) => j.id === 'learn').runNow, true);
  assert.equal((await api('/api/agents/nope/run', { method: 'POST' })).status, 404);
  const s = await api('/api/settings', { method: 'PUT', json: { agentsPaused: true, agentsQuietStart: '22:30', agentsMaxClaudeRunsPerDay: 3 } });
  assert.equal(s.body.agentsPaused, true);
  assert.equal(s.body.agentsQuietStart, '22:30');
  assert.equal((await api('/api/agents')).body.jobs[0].waiting, 'Background agents are paused.');
});

test('lessons: list with per-format stats, and switch one off', async () => {
  const r = await api('/api/lessons');
  assert.equal(r.status, 200);
  assert.ok(r.body.categories.some((c: any) => c.id === 'tiny-screenshot'));
  assert.deepEqual(r.body.lessons, []);
  assert.equal((await api('/api/lessons/nope', { method: 'PUT', json: { status: 'off' } })).status, 404);
  assert.equal((await api('/api/lessons/nope', { method: 'PUT', json: { status: 'kept' } })).status, 400);
});
