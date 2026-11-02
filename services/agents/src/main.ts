import { createAgentsService } from './index.ts';

const svc = createAgentsService();
await svc.listen(Number(process.env.PORT) || undefined);
await svc.start();
console.log(`[agents] listening on ${(svc.server.address() as { port: number }).port}`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => svc.close().then(() => process.exit(0)));
