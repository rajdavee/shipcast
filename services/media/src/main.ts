import { createMediaService } from './index.ts';

const svc = createMediaService();
await svc.listen(Number(process.env.PORT) || undefined);
console.log(`[media] listening on ${(svc.server.address() as { port: number }).port}`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => svc.close().then(() => process.exit(0)));
