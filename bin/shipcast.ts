#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createApp } from '@shipcast/api';
import { startWorker } from '@shipcast/worker';
import { doctor, ROOT } from '@shipcast/engine';

const [cmd = 'start', ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const port = Number(process.env.PORT ?? 4317);

async function serve({ withWorker }: { withWorker: boolean }) {
  const app = createApp();
  await new Promise<void>((r) => app.listen(port, '127.0.0.1', r));
  console.log(`\n  ▲ Shipcast studio  →  http://localhost:${port}\n`);
  const worker = withWorker ? startWorker() : null;
  const shutdown = async () => {
    app.close();
    await worker?.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

switch (cmd) {
  case 'start':
    await serve({ withWorker: !flag('no-worker') });
    break;
  case 'api':
    await serve({ withWorker: false });
    break;
  case 'dev': {
    await serve({ withWorker: true });
    const vite = spawn('npm', ['run', 'dev', '-w', 'apps/web'], { cwd: ROOT, stdio: 'inherit' });
    process.on('exit', () => vite.kill());
    break;
  }
  case 'doctor': {
    const checks = await doctor();
    for (const c of checks) {
      const mark = c.ok ? '\x1b[32m✓\x1b[0m' : c.required ? '\x1b[31m✗\x1b[0m' : '\x1b[33m○\x1b[0m';
      console.log(`  ${mark} ${c.label.padEnd(26)} ${c.detail}${!c.ok && c.hint ? `\n      → ${c.hint}` : ''}`);
    }
    process.exit(checks.some((c) => c.required && !c.ok) ? 1 : 0);
  }
  default:
    console.log(`usage: shipcast [start|dev|api|doctor]

  start        studio + worker on http://localhost:${port} (default)
  start --no-worker   studio only; run \`npm run worker\` separately
  dev          same, plus the Vite dev server with hot reload
  doctor       check Claude Code, GitHub CLI, FFmpeg, Chrome, voice + captions`);
}
