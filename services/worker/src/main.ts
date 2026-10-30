import { startWorker } from './index.ts';

const w = startWorker();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await w.stop();
    process.exit(0);
  });
}
