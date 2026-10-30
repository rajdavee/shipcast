import { appendEvent, claimNext, recoverOrphans, runStep, updateStep, WORKER_ID } from '@shipcast/engine';

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
  let currentJob: { campaign: string; step: string } | null = null;

  const loop = async () => {
    await recoverOrphans().catch(() => 0);
    log(`[worker ${WORKER_ID}] ready`);
    while (!stopping) {
      const job = await claimNext().catch((e) => {
        log(`[worker] claim failed: ${e}`);
        return null;
      });
      if (!job) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      log(`[worker] ${job.campaign.id} → ${job.step.kind === 'brief' ? 'brief' : job.step.pack} (${job.step.id})`);
      currentJob = { campaign: job.campaign.id, step: job.step.id };
      current = runStep(job.campaign, job.step, { onSpawn: (k) => (killCurrent = k) });
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
        await updateStep(currentJob.campaign, currentJob.step, { status: 'queued', error: undefined, worker: undefined });
        await appendEvent(currentJob.campaign, { step: currentJob.step, type: 'log', text: 'Worker stopped — step requeued.' });
      }
    },
  };
}
