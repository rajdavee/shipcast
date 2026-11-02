#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { doctor, ROOT, SERVICE_PORTS, serviceHealth, type ServiceName } from '@shipcast/engine';

const [cmd = 'start', ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const apiPort = Number(process.env.PORT ?? 4317);

const SERVICES: Record<string, { entry: string; port?: number }> = {
  api: { entry: 'services/api/src/main.ts', port: apiPort },
  worker: { entry: 'services/worker/src/main.ts' },
  render: { entry: 'services/render/src/main.ts', port: SERVICE_PORTS.render },
  stills: { entry: 'services/stills/src/main.ts', port: SERVICE_PORTS.stills },
  media: { entry: 'services/media/src/main.ts', port: SERVICE_PORTS.media },
  qa: { entry: 'services/qa/src/main.ts', port: SERVICE_PORTS.qa },
  gen: { entry: 'services/gen/src/main.ts', port: SERVICE_PORTS.gen },
  agents: { entry: 'services/agents/src/main.ts', port: SERVICE_PORTS.agents },
};

const COLORS: Record<string, string> = { api: '36', worker: '35', render: '33', stills: '32', media: '34', qa: '31', gen: '95', agents: '96' };

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function freePort(start: number): Promise<number> {
  for (let p = start; p < start + 50; p++) if (await portFree(p)) return p;
  throw new Error(`no free port near ${start}`);
}

/**
 * Supervisor: one process per service, restarted with backoff if it dies.
 * Busy default ports are moved and every service is told where the others
 * live through SHIPCAST_<NAME>_URL.
 */
async function supervise(names: string[]) {
  const env: Record<string, string> = {};
  const ports: Record<string, number> = {};
  for (const n of names) {
    const want = SERVICES[n].port;
    if (!want) continue;
    const port = n === 'api' ? want : await freePort(want);
    if (n === 'api' && !(await portFree(port))) throw new Error(`port ${port} is in use — set PORT to use another`);
    ports[n] = port;
    if (n !== 'api') env[`SHIPCAST_${n.toUpperCase()}_URL`] = `http://127.0.0.1:${port}`;
  }
  const children = new Map<string, ChildProcess>();
  // One restart in flight per service: the exit handler and the watchdog both
  // restart, and without this each crash added another chain (277 renders once).
  const pending = new Map<string, NodeJS.Timeout>();
  let stopping = false;
  const later = (n: string, attempt: number, why: string) => {
    if (stopping || pending.has(n)) return;
    const wait = Math.min(30_000, 500 * 2 ** attempt);
    process.stdout.write(`\x1b[${COLORS[n]}m${n.padEnd(6)}\x1b[0m │ ${why}; restarting in ${(wait / 1000).toFixed(1)}s\n`);
    pending.set(n, setTimeout(() => {
      pending.delete(n);
      void launch(n, attempt);
    }, wait));
  };
  const starting = new Set<string>();
  const launch = async (n: string, attempt = 0) => {
    if (stopping || children.has(n) || starting.has(n)) return;
    starting.add(n);
    // Something else (often a leftover copy) holds the port: wait for it instead of spawning a copy that dies at once.
    const taken = !!ports[n] && !(await portFree(ports[n]));
    starting.delete(n);
    if (taken) return later(n, Math.min(attempt + 1, 6), `port ${ports[n]} is taken by another process`);
    if (stopping || children.has(n)) return;
    const c = spawn(process.execPath, [join(ROOT, SERVICES[n].entry)], {
      env: { ...process.env, ...env, ...(ports[n] ? { PORT: String(ports[n]) } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tag = `\x1b[${COLORS[n]}m${n.padEnd(6)}\x1b[0m │ `;
    const pipe = (s: NodeJS.ReadableStream) => s.on('data', (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, tag)));
    pipe(c.stdout!);
    pipe(c.stderr!);
    const started = Date.now();
    c.on('exit', (code) => {
      if (children.get(n) === c) children.delete(n);
      later(n, Date.now() - started > 30_000 ? 0 : attempt + 1, `exited (${code})`);
    });
    children.set(n, c);
  };
  for (const n of names) void launch(n);

  // Watchdog: exit events can be missed (signals to process groups, wedged
  // pipes). Every 5 s make sure each child is alive and its port answers.
  const misses = new Map<string, number>();
  setInterval(async () => {
    if (stopping) return;
    for (const n of names) {
      if (pending.has(n) || starting.has(n)) continue;
      const c = children.get(n);
      const alive = !!c?.pid && c.exitCode === null && (() => { try { process.kill(c.pid!, 0); return true; } catch { return false; } })();
      let healthy = alive;
      if (alive && ports[n]) {
        const path = n === 'api' ? '/api/status' : '/health';
        healthy = await fetch(`http://127.0.0.1:${ports[n]}${path}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok, () => false);
      }
      const m = healthy ? 0 : (misses.get(n) ?? 0) + 1;
      misses.set(n, m);
      if (!alive || m >= 3) {
        process.stdout.write(`\x1b[${COLORS[n]}m${n.padEnd(6)}\x1b[0m │ ${alive ? 'not answering' : 'gone'} — relaunching\n`);
        misses.set(n, 0);
        if (c) {
          c.removeAllListeners('exit');
          c.kill('SIGKILL');
        }
        children.delete(n);
        void launch(n);
      }
    }
  }, 5000).unref();
  if (names.includes('api')) console.log(`\n  ▲ Shipcast studio  →  http://localhost:${ports.api}\n`);
  const shutdown = () => {
    stopping = true;
    for (const t of pending.values()) clearTimeout(t);
    for (const c of children.values()) c.kill('SIGTERM');
    setTimeout(() => process.exit(0), 4000).unref();
    if (!children.size) process.exit(0);
    let left = children.size;
    for (const c of children.values()) c.on('exit', () => --left === 0 && process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

switch (cmd) {
  case 'start': {
    const only = opt('only')?.split(',').map((s) => s.trim());
    const skip = new Set(opt('skip')?.split(',') ?? []);
    if (flag('no-worker')) skip.add('worker');
    const names = (only ?? Object.keys(SERVICES)).filter((n) => SERVICES[n] && !skip.has(n));
    await supervise(names);
    break;
  }
  case 'dev': {
    await supervise(Object.keys(SERVICES));
    const vite = spawn('npm', ['run', 'dev', '-w', 'apps/web'], { cwd: ROOT, stdio: 'inherit' });
    process.on('exit', () => vite.kill());
    break;
  }
  case 'status': {
    for (const n of Object.keys(SERVICE_PORTS) as ServiceName[]) {
      const h = await serviceHealth(n);
      console.log(`  ${h ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m'} ${n.padEnd(7)} ${h ? `queued ${h.queued} · running ${h.running}` : 'not reachable'}`);
    }
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
    console.log(`usage: shipcast <command>

  start                      every service, supervised (studio on http://localhost:${apiPort})
  start --only api,worker    just these services (others can run elsewhere)
  start --skip render        everything except these
  dev                        start + Vite hot reload for the studio UI
  status                     health of the capability services
  doctor                     check Claude Code, GitHub CLI, FFmpeg, Chrome, voice, captions

services: ${Object.keys(SERVICES).join(', ')}
point a service elsewhere with SHIPCAST_<NAME>_URL (e.g. SHIPCAST_RENDER_URL=http://gpu-box:4320)`);
}
