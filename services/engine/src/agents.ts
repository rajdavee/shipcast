import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { home } from './paths.ts';
import { listCampaigns } from './store.ts';
import type { Settings } from './types.ts';

/**
 * Background agents: scheduled jobs that work while you don't — learning from
 * past runs, watching marketing trends. State is plain files under
 * ~/.shipcast/agents so the API can show and toggle jobs and the agents
 * service runs them. Foreground work always wins: Claude-backed jobs only
 * start when no campaign step is queued or running, stay out of quiet hours,
 * and share a small daily cap.
 */

export type AgentKind = 'learn' | 'trends' | 'golden';

export interface AgentJob {
  id: AgentKind;
  title: string;
  about: string;
  /** Minutes between runs. */
  every: number;
  enabled: boolean;
  /** Spends Claude runs (counts against the daily cap and waits for idle). */
  usesClaude: boolean;
  nextRun: string;
  lastRun?: string;
  lastResult?: { ok: boolean; summary: string; ms: number };
  /** Set by "Run now"; the scheduler clears it when it starts the job. */
  runNow?: boolean;
  running?: boolean;
}

export const DEFAULT_JOBS: Omit<AgentJob, 'nextRun'>[] = [
  { id: 'learn', title: 'Learn from past runs', about: 'Reads quality checks, revisions and eval scores, and turns repeat problems into lessons every format follows.', every: 24 * 60, enabled: true, usesClaude: true },
  { id: 'trends', title: 'Trend radar', about: 'Checks what formats, hooks and topics are rising in marketing and refreshes the Trending page.', every: 12 * 60, enabled: true, usesClaude: true },
  { id: 'golden', title: 'Nightly quality check', about: 'Re-makes a fixed set of sample pieces and scores them, so a drop in quality shows up the next morning.', every: 24 * 60, enabled: false, usesClaude: true },
];

export const agentsDir = () => join(home(), 'agents');
const jobsFile = () => join(agentsDir(), 'jobs.json');
const runsFile = (day: string) => join(agentsDir(), 'runs', `${day}.jsonl`);

async function writeAtomic(file: string, data: unknown) {
  await mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, file);
}

/** Every known job, stored state merged over the defaults (new kinds appear automatically). */
export async function readJobs(now = new Date()): Promise<AgentJob[]> {
  let stored: Partial<AgentJob>[] = [];
  try {
    stored = JSON.parse(await readFile(jobsFile(), 'utf8'));
  } catch {}
  const jobs = DEFAULT_JOBS.map((d) => {
    const s = stored.find((x) => x.id === d.id) ?? {};
    // First run a few minutes after install, not all at once.
    const stagger = (DEFAULT_JOBS.indexOf(d) + 1) * 5 * 60_000;
    return { ...d, nextRun: new Date(now.getTime() + stagger).toISOString(), ...s, title: d.title, about: d.about, usesClaude: d.usesClaude } as AgentJob;
  });
  // Pin the first schedule of any new job, or it would slide forward on every read.
  if (jobs.some((j) => !stored.some((x) => x.id === j.id))) await saveJobs(jobs).catch(() => {});
  return jobs;
}

export const saveJobs = (jobs: AgentJob[]) => writeAtomic(jobsFile(), jobs);

/** Change one job; returns the updated list. */
export async function updateJob(id: string, patch: Partial<Pick<AgentJob, 'enabled' | 'every' | 'runNow' | 'nextRun' | 'lastRun' | 'lastResult' | 'running'>>): Promise<AgentJob[]> {
  const jobs = await readJobs();
  const j = jobs.find((x) => x.id === id);
  if (!j) throw new Error(`no background job "${id}"`);
  if (patch.every !== undefined) patch.every = Math.min(7 * 24 * 60, Math.max(30, Math.round(Number(patch.every) || j.every)));
  Object.assign(j, patch);
  await saveJobs(jobs);
  return jobs;
}

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : -1;
};

/** Inside quiet hours (local time)? Windows may cross midnight; equal start and end means none. */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const a = minutes(start);
  const b = minutes(end);
  if (a < 0 || b < 0 || a === b) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** The job to start now, if any: "Run now" first, then the most overdue enabled job. */
export function pickDue(jobs: AgentJob[], now: Date): AgentJob | undefined {
  const ready = jobs.filter((j) => !j.running && (j.runNow || (j.enabled && Date.parse(j.nextRun) <= now.getTime())));
  return ready.sort((a, b) => Number(!!b.runNow) - Number(!!a.runNow) || Date.parse(a.nextRun) - Date.parse(b.nextRun))[0];
}

export interface AgentRun {
  job: AgentKind;
  at: string;
  ok: boolean;
  summary: string;
  ms: number;
  claudeRuns: number;
}

export async function logRun(r: AgentRun): Promise<void> {
  const f = runsFile(r.at.slice(0, 10));
  await mkdir(join(f, '..'), { recursive: true });
  await appendFile(f, JSON.stringify(r) + '\n');
}

export async function readRuns(day = new Date().toISOString().slice(0, 10)): Promise<AgentRun[]> {
  try {
    return (await readFile(runsFile(day), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function claudeRunsToday(now = new Date()): Promise<number> {
  return (await readRuns(now.toISOString().slice(0, 10))).reduce((a, r) => a + (r.claudeRuns || 0), 0);
}

/** Is someone's own work in flight? Background Claude jobs wait for it. */
export async function foregroundBusy(): Promise<boolean> {
  return (await listCampaigns()).some((c) => c.steps.some((s) => s.status === 'running' || s.status === 'queued'));
}

/** Why a job can't start right now, or '' when it can. "Run now" skips quiet hours but not the busy check or cap. */
export async function blockedReason(job: AgentJob, s: Pick<Settings, 'agentsPaused' | 'agentsQuietStart' | 'agentsQuietEnd' | 'agentsMaxClaudeRunsPerDay'>, now = new Date(), busy?: () => Promise<boolean>): Promise<string> {
  if (s.agentsPaused && !job.runNow) return 'Background agents are paused.';
  if (!job.runNow && inQuietHours(now, s.agentsQuietStart, s.agentsQuietEnd)) return 'Quiet hours.';
  if (!job.usesClaude) return '';
  if (await (busy ?? foregroundBusy)()) return 'Waiting for your campaign to finish.';
  if ((await claudeRunsToday(now)) >= s.agentsMaxClaudeRunsPerDay) return `Daily cap of ${s.agentsMaxClaudeRunsPerDay} background runs reached.`;
  return '';
}
