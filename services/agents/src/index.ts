import { blockedReason, createService, currentContext, primaryWorkspace, runAs, workContexts, foregroundBusy, learnOnce, logRun, refreshPlaybook, refreshTrends, runGolden, redactSecrets, runPublisher, runMetrics, syncSiteIfDue, reportTick, pickDue, readJobs, readSettings, updateJob, type AgentJob, type AgentKind, type MetricsReport, type PublisherReport } from '@shipcast/engine';

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
  // The playbook (what works for you) is rebuilt from the latest numbers on the same schedule.
  let extra = 0;
  if (!(await ctx.shouldYield())) {
    const pb = await refreshPlaybook().catch(() => null);
    const ready = pb?.channels.filter((c) => c.ready).length ?? 0;
    if (pb?.channels.some((c) => c.narrative?.length)) extra = 1;
    if (ready) parts.push(`playbook ready on ${ready} channel${ready === 1 ? '' : 's'}`);
  }
  return { summary: parts.join(' · '), claudeRuns: r.claudeRuns + extra };
});

registerAgent('golden', async () => runGolden());

registerAgent('trends', async (ctx) => {
  // Market data is the same for everyone: refresh it once, in the install owner's workspace.
  const primary = await primaryWorkspace();
  const here = currentContext()?.workspace;
  if (primary && here && here !== primary) return { summary: 'Trends are refreshed once for the whole install.', claudeRuns: 0 };
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

/**
 * The publisher is not a Claude job: it runs on every tick, beside the
 * scheduler, ignoring quiet hours and the Claude cap (a post booked for 23:30
 * should go out at 23:30) but obeying "publishing paused". Its own lock keeps
 * a slow upload from overlapping the next tick.
 */
let lastPublish: { at: string; report?: PublisherReport; error?: string } | undefined;
export async function publishTick(): Promise<PublisherReport | undefined> {
  try {
    const report = await runPublisher();
    lastPublish = { at: new Date().toISOString(), report };
    return report;
  } catch (e) {
    lastPublish = { at: new Date().toISOString(), error: (e as Error).message.slice(0, 200) };
    console.error('[publisher] pass failed:', lastPublish.error);
  }
}

/**
 * The metrics job is not a Claude job either: on every tick it reads numbers
 * back for posts that reached 1 d / 3 d / 7 d / 30 d (YouTube, the Postiz
 * queue) and asks for the rest, obeying "metrics paused". Like the
 * publisher, a pass still going makes the next tick skip it.
 */
let lastMetrics: { at: string; report?: MetricsReport; error?: string } | undefined;
export async function metricsTick(): Promise<MetricsReport | undefined> {
  try {
    const report = await runMetrics();
    lastMetrics = { at: new Date().toISOString(), report };
    return report;
  } catch (e) {
    lastMetrics = { at: new Date().toISOString(), error: (await redactSecrets((e as Error).message ?? '')).slice(0, 200) };
    console.error('[metrics] pass failed:', lastMetrics.error);
  }
}

/** Website numbers (Google Analytics, Search Console): every six hours when set up; no Claude. */
export async function siteTick() {
  try {
    return await syncSiteIfDue();
  } catch (e) {
    console.error('[site] sync failed:', (await redactSecrets((e as Error).message ?? '')).slice(0, 200));
  }
}

export function createAgentsService() {
  let timer: ReturnType<typeof setInterval> | undefined;
  let busyTick = false;
  const svc = createService({
    name: 'agents',
    port: AGENTS_PORT,
    version: '0.1.0',
    concurrency: 1,
    health: async () => ({ jobs: (await readJobs()).map((j) => ({ id: j.id, enabled: j.enabled, nextRun: j.nextRun, running: !!j.running })), publisher: lastPublish ?? null, metrics: lastMetrics ?? null }),
    handlers: {
      tick: async () => tick(),
      publish: async () => publishTick(),
      metrics: async () => metricsTick(),
    },
  });
  let busyFast = false;
  const start = async () => {
    // A crash mid-job leaves "running" set; clear it so the job can run again.
    for (const ctx of await workContexts()) await runAs(ctx, async () => { for (const j of await readJobs()) if (j.running) await updateJob(j.id, { running: false }); });
    timer = setInterval(async () => {
      // Every workspace in its own context. Publishing and reading numbers are quick and time-critical,
      // so they get their own pass that a long Claude job can't hold up.
      if (!busyFast) {
        busyFast = true;
        (async () => {
          for (const ctx of await workContexts()) {
            await runAs(ctx, () => publishTick());
            await runAs(ctx, () => metricsTick());
            await runAs(ctx, () => siteTick());
          }
        })().finally(() => (busyFast = false));
      }
      if (busyTick) return;
      busyTick = true;
      (async () => {
        for (const ctx of await workContexts()) {
          await runAs(ctx, () => tick()).catch((e) => console.error(`[agents] tick failed${ctx.workspace ? ` (${ctx.workspace})` : ''}:`, e));
          // The scheduled report (and the day-before reminder for missing numbers).
          await runAs(ctx, () => reportTick()).catch(async (e) => console.error(`[reports] scheduled report failed${ctx.workspace ? ` (${ctx.workspace})` : ''}:`, (await redactSecrets((e as Error).message ?? '')).slice(0, 200)));
        }
      })().finally(() => (busyTick = false));
    }, 20_000);
  };
  const close = svc.close.bind(svc);
  return Object.assign(svc, { start, close: async () => (clearInterval(timer), close()) });
}
