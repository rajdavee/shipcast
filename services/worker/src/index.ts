import { appendEvent, claimNext, recoverOrphans, roleIn, runAs, runStep, updateStep, WORKER_ID, workContexts, type WorkContext } from '@shipcast/engine';

export { workContexts };


export interface Worker {
  stop: () => Promise<void>;
}

/**
 * Poll the data dir for queued steps and run them one at a time. One at a
 * time is deliberate: renders are CPU-heavy and Claude subscriptions have
 * usage windows. Start a second worker process if you want parallelism.
 */
export function startWorker({ intervalMs = 1500, log = console.log } = {}): Worker {
  let stopping = false;
  let current: Promise<void> | null = null;
  let killCurrent: (() => void) | null = null;
  let currentJob: { campaign: string; step: string; ctx: WorkContext } | null = null;
  let turn = 0;

  const loop = async () => {
    for (const ctx of await workContexts()) await runAs(ctx, () => recoverOrphans()).catch(() => 0);
    log(`[worker ${WORKER_ID}] ready`);
    while (!stopping) {
      // Take turns between workspaces so one busy team can't starve the others.
      const ctxs = await workContexts();
      let job: Awaited<ReturnType<typeof claimNext>> = null;
      let ctx: WorkContext = {};
      for (let i = 0; i < ctxs.length && !job; i++) {
        ctx = ctxs[(turn + i) % ctxs.length];
        job = await runAs(ctx, () => claimNext()).catch((e) => {
          log(`[worker] claim failed: ${e}`);
          return null;
        });
      }
      turn++;
      if (!job) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      const j = job;
      log(`[worker] ${ctx.workspace ? `${ctx.workspace}/` : ''}${j.campaign.id} → ${j.step.kind === 'brief' ? 'brief' : j.step.pack} (${j.step.id})`);
      currentJob = { campaign: j.campaign.id, step: j.step.id, ctx };
      // A step runs as the person who queued it while they're still a member, else the workspace's owner.
      const by = j.step.by && ctx.workspace && (await roleIn(j.step.by, ctx.workspace)) ? j.step.by : undefined;
      current = runAs({ ...ctx, ...(by ? { user: by } : {}) }, () => runStep(j.campaign, j.step, { onSpawn: (k) => (killCurrent = k) }));
      await current;
      current = null;
      killCurrent = null;
      if (!stopping) currentJob = null;
    }
  };
  const running = loop();

  return {
    async stop() {
      stopping = true;
      killCurrent?.();
      await running;
      // A step interrupted by shutdown goes back in the queue instead of failing.
      if (currentJob) {
        const { campaign, step, ctx } = currentJob;
        await runAs(ctx, async () => {
          await updateStep(campaign, step, { status: 'queued', error: undefined, worker: undefined });
          await appendEvent(campaign, { step, type: 'log', text: 'Worker stopped — step requeued.' });
        });
      }
    },
  };
}
