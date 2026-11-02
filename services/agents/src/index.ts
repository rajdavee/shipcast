import { blockedReason, createService, foregroundBusy, learnOnce, logRun, refreshTrends, runGolden, pickDue, readJobs, readSettings, updateJob, type AgentJob, type AgentKind } from '@shipcast/engine';

/**
 * The agents service: wakes every 20 seconds, starts at most one background
 * job when it's allowed to (see blockedReason), records the result and books
 * the next run. Job bodies are registered per kind; a kind without one is
 * reported as not available rather than silently skipped.
 */

export const AGENTS_PORT = 4325;

export interface AgentContext {
  now: Date;
  /** True once someone's own campaign work starts: wrap up and return early. */
  shouldYield: () => Promise<boolean>;
  log: (text: string) => void;
}
export interface AgentOutcome {
  summary: string;
  /** Check back sooner than the job's schedule (work it started is still going). */
  nextInMinutes?: number;
  /** Claude runs this job used (counts toward the daily cap). */
  claudeRuns?: number;
}
export type AgentHandler = (ctx: AgentContext) => Promise<AgentOutcome>;

export const HANDLERS: Partial<Record<AgentKind, AgentHandler>> = {};

export function registerAgent(kind: AgentKind, h: AgentHandler) {
  HANDLERS[kind] = h;
}

registerAgent('learn', async (ctx) => {
  const r = await learnOnce({ now: ctx.now, shouldYield: ctx.shouldYield });
  const parts = [`${r.incidents} incidents read`];
  if (r.added.length) parts.push(`${r.added.length} new lesson${r.added.length === 1 ? '' : 's'}`);
  if (r.kept.length) parts.push(`${r.kept.length} kept`);
  if (r.retired.length) parts.push(`${r.retired.length} retired`);
  return { summary: parts.join(' · '), claudeRuns: r.claudeRuns };
});

registerAgent('golden', async () => runGolden());

registerAgent('trends', async (ctx) => {
  const r = await refreshTrends({ now: ctx.now, shouldYield: ctx.shouldYield });
  const src = Object.entries(r.sources).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ');
  return { summary: r.claudeRuns ? `${r.fresh} trends found · ${r.live} live · from ${src || 'web search'}` : 'Paused for your campaign', claudeRuns: r.claudeRuns };
});

export interface TickDeps {
  now?: () => Date;
  busy?: () => Promise<boolean>;
  handlers?: Partial<Record<AgentKind, AgentHandler>>;
  log?: (text: string) => void;
}

/** One scheduler pass. Returns what happened (for tests and logs). */
export async function tick(deps: TickDeps = {}): Promise<{ ran?: AgentKind; blocked?: string; result?: AgentOutcome & { ok: boolean } }> {
  const now = (deps.now ?? (() => new Date()))();
  const handlers = deps.handlers ?? HANDLERS;
  const log = deps.log ?? ((t) => console.log(`[agents] ${t}`));
  const jobs = await readJobs(now);
  if (jobs.some((j) => j.running)) return { blocked: 'A background job is already running.' };
  const job = pickDue(jobs, now);
  if (!job) return {};
  const why = await blockedReason(job, await readSettings(), now, deps.busy);
  if (why) return { blocked: why };
  return { ran: job.id, result: await runJob(job, now, handlers[job.id], deps.busy, log) };
}

async function runJob(job: AgentJob, now: Date, handler: AgentHandler | undefined, busy: (() => Promise<boolean>) | undefined, log: (t: string) => void) {
  const t0 = Date.now();
  await updateJob(job.id, { running: true, runNow: false });
  let ok = true;
  let out: AgentOutcome;
  try {
    if (!handler) throw new Error('Not available in this version yet.');
    log(`${job.title}: started`);
    out = await handler({ now, shouldYield: busy ?? foregroundBusy, log: (t) => log(`${job.title}: ${t}`) });
  } catch (e) {
    ok = false;
    out = { summary: (e as Error).message.slice(0, 400), claudeRuns: 0 };
  }
  const ms = Date.now() - t0;
  const next = new Date(now.getTime() + (ok && out.nextInMinutes ? Math.max(5, out.nextInMinutes) : job.every) * 60_000).toISOString();
  await updateJob(job.id, { running: false, lastRun: now.toISOString(), nextRun: next, lastResult: { ok, summary: out.summary, ms } });
  await logRun({ job: job.id, at: now.toISOString(), ok, summary: out.summary, ms, claudeRuns: out.claudeRuns ?? 0 });
  log(`${job.title}: ${ok ? 'done' : 'failed'} — ${out.summary}`);
  return { ...out, ok };
}

export function createAgentsService() {
  let timer: ReturnType<typeof setInterval> | undefined;
  let busyTick = false;
  const svc = createService({
    name: 'agents',
    port: AGENTS_PORT,
    version: '0.1.0',
    concurrency: 1,
    health: async () => ({ jobs: (await readJobs()).map((j) => ({ id: j.id, enabled: j.enabled, nextRun: j.nextRun, running: !!j.running })) }),
    handlers: {
      tick: async () => tick(),
    },
  });
  const start = async () => {
    // A crash mid-job leaves "running" set; clear it so the job can run again.
    for (const j of await readJobs()) if (j.running) await updateJob(j.id, { running: false });
    timer = setInterval(async () => {
      if (busyTick) return;
      busyTick = true;
      await tick().catch((e) => console.error('[agents] tick failed:', e)).finally(() => (busyTick = false));
    }, 20_000);
  };
  const close = svc.close.bind(svc);
  return Object.assign(svc, { start, close: async () => (clearInterval(timer), close()) });
}
