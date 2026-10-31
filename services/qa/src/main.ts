import { createQaService } from './index.ts';

const svc = createQaService();
await svc.listen(Number(process.env.PORT) || undefined);
console.log(`[qa] listening on ${(svc.server.address() as { port: number }).port}`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => svc.close().then(() => process.exit(0)));
