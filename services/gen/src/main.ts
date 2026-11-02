import { createGenService } from './index.ts';

const svc = createGenService();
await svc.listen(Number(process.env.PORT) || undefined);
console.log(`[gen] listening on ${(svc.server.address() as { port: number }).port}`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => svc.close().then(() => process.exit(0)));
