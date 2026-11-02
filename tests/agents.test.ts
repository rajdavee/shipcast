import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'agents-'));
const { inQuietHours, pickDue, readJobs, updateJob, readRuns, writeSettings } = await import('@shipcast/engine');
const { tick } = await import('@shipcast/agents');

const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m);

test('quiet hours handle windows that cross midnight, and equal ends mean none', () => {
  assert.equal(inQuietHours(at(23, 30), '23:00', '07:00'), true);
  assert.equal(inQuietHours(at(3), '23:00', '07:00'), true);
  assert.equal(inQuietHours(at(7), '23:00', '07:00'), false);
  assert.equal(inQuietHours(at(13), '12:00', '14:00'), true);
  assert.equal(inQuietHours(at(13), '09:00', '09:00'), false);
});

test('"Run now" jumps the queue; otherwise the most overdue enabled job runs', async () => {
  const now = at(12);
  const jobs = await readJobs(now);
  const past = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const set = jobs.map((j) => ({ ...j, enabled: true, nextRun: j.id === 'learn' ? past(10) : j.id === 'trends' ? past(60) : past(5) }));
  assert.equal(pickDue(set, now)?.id, 'trends');
  assert.equal(pickDue(set.map((j) => (j.id === 'golden' ? { ...j, runNow: true } : j)), now)?.id, 'golden');
  assert.equal(pickDue(set.map((j) => ({ ...j, enabled: false })), now), undefined);
  assert.equal(pickDue(set.map((j) => ({ ...j, running: true })), now), undefined);
});

test('the scheduler waits for your work, quiet hours and the daily cap, then runs and books the next run', async () => {
  await writeSettings({ agentsQuietStart: '23:00', agentsQuietEnd: '07:00', agentsMaxClaudeRunsPerDay: 2, agentsPaused: false });
  const noon = at(12);
  await updateJob('learn', { enabled: true, nextRun: new Date(noon.getTime() - 60_000).toISOString() });
  await updateJob('trends', { enabled: false });
  let calls = 0;
  const handlers = { learn: async () => (calls++, { summary: '3 lessons', claudeRuns: 1 }) };
  const quiet = () => at(23, 30);

  assert.match((await tick({ now: () => noon, busy: async () => true, handlers, log: () => {} })).blocked ?? '', /campaign/);
  assert.match((await tick({ now: quiet, busy: async () => false, handlers, log: () => {} })).blocked ?? '', /Quiet/);
  const r = await tick({ now: () => noon, busy: async () => false, handlers, log: () => {} });
  assert.equal(r.ran, 'learn');
  assert.equal(calls, 1);
  const learn = (await readJobs(noon)).find((j) => j.id === 'learn')!;
  assert.equal(learn.lastResult?.ok, true);
  assert.equal(Date.parse(learn.nextRun), noon.getTime() + learn.every * 60_000);
  assert.equal((await readRuns(noon.toISOString().slice(0, 10)))[0].claudeRuns, 1);

  // Not due again yet; "Run now" makes it due, and the cap (2) still allows one more.
  assert.equal((await tick({ now: () => noon, busy: async () => false, handlers, log: () => {} })).ran, undefined);
  await updateJob('learn', { runNow: true });
  assert.equal((await tick({ now: () => noon, busy: async () => false, handlers, log: () => {} })).ran, 'learn');
  await updateJob('learn', { runNow: true });
  assert.match((await tick({ now: () => noon, busy: async () => false, handlers, log: () => {} })).blocked ?? '', /cap/);
});

test('a job with no body yet fails visibly and is rescheduled, and a throwing job is recorded as failed', async () => {
  const noon = at(12);
  await writeSettings({ agentsMaxClaudeRunsPerDay: 99 });
  await updateJob('golden', { runNow: true });
  const r = await tick({ now: () => noon, busy: async () => false, handlers: {}, log: () => {} });
  assert.equal(r.ran, 'golden');
  assert.equal(r.result?.ok, false);
  assert.match(r.result?.summary ?? '', /Not available/);
  await updateJob('trends', { runNow: true });
  const t = await tick({ now: () => noon, busy: async () => false, handlers: { trends: async () => { throw new Error('feed down'); } }, log: () => {} });
  assert.equal(t.result?.ok, false);
  assert.equal((await readJobs(noon)).find((j) => j.id === 'trends')?.running, false);
});

test('a new job keeps its first scheduled time across reads', async () => {
  const { rmSync } = await import('node:fs');
  const { agentsDir } = await import('@shipcast/engine');
  rmSync(agentsDir(), { recursive: true, force: true });
  const a = (await readJobs(at(9)))[0].nextRun;
  const b = (await readJobs(at(10)))[0].nextRun;
  assert.equal(a, b);
});
