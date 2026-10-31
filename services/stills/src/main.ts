import { browser } from '@shipcast/engine';
import { createStillsService } from './index.ts';

const svc = createStillsService();
await svc.listen(Number(process.env.PORT) || undefined);
console.log(`[stills] listening on ${(svc.server.address() as { port: number }).port}`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => Promise.all([svc.close(), browser().close()]).then(() => process.exit(0)));
