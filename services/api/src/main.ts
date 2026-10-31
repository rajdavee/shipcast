import { createApp } from './index.ts';

const port = Number(process.env.PORT ?? 4317);
const app = createApp();
app.listen(port, process.env.SHIPCAST_BIND ?? '127.0.0.1', () => console.log(`[api] listening on ${port}`));
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => app.close(() => process.exit(0)));
