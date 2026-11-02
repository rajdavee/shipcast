import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { home } from './paths.ts';

/**
 * Service kit: every capability service (render, stills, media, qa) is a tiny
 * HTTP process with the same contract, so they can run on one laptop, in
 * separate containers, or on a bigger box, and be swapped independently.
 *
 *   GET  /health            → { name, ok, version, kinds, queued, running }
 *   POST /jobs  {kind,input} → Job            (async; poll or wait)
 *   GET  /jobs/:id          → Job
 *   GET  /jobs/:id/wait     → Job            (long-poll up to 55 s)
 *   POST /run   {kind,input} → Job            (submit + wait until finished)
 *
 * Jobs persist as JSON under ~/.shipcast/services/<name>/jobs so a restart
 * re-queues work that was in flight.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job<I = unknown, O = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  input: I;
  output?: O;
  error?: string;
  progress?: number;
  message?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface JobContext {
  id: string;
  /** Scratch dir for this job (inside the service's data dir). */
  dir: string;
  progress: (fraction: number, message?: string) => void;
}

export type Handler = (input: any, ctx: JobContext) => Promise<unknown>;

export interface ServiceOptions {
  name: string;
  port: number;
  version?: string;
  handlers: Record<string, Handler>;
  /** Jobs run at once. Renders are heavy; default 1. */
  concurrency?: number;
  /** Extra info merged into /health (e.g. engine availability). */
  health?: () => Promise<Record<string, unknown>>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Files a service may read or write must live under the Shipcast data dir. */
export function assertInHome(p: string, label = 'path'): string {
  const abs = resolve(p);
  const root = resolve(home());
  if (abs !== root && !abs.startsWith(root + sep)) throw new ServiceError(400, `${label} must be inside ${root}`);
  return abs;
}

export class ServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createService(opts: ServiceOptions) {
  const dataDir = join(home(), 'services', opts.name);
  const jobsDir = join(dataDir, 'jobs');
  const jobs = new Map<string, Job>();
  const waiters = new Map<string, Set<() => void>>();
  let running = 0;
  const concurrency = opts.concurrency ?? 1;

  const persist = async (job: Job) => {
    const file = join(jobsDir, `${job.id}.json`);
    const tmp = `${file}.${randomBytes(2).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(job));
    await rename(tmp, file);
  };
  const notify = (id: string) => {
    for (const w of waiters.get(id) ?? []) w();
    waiters.delete(id);
  };

  async function load() {
    await mkdir(jobsDir, { recursive: true });
    for (const f of await readdir(jobsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const job = JSON.parse(await readFile(join(jobsDir, f), 'utf8')) as Job;
        if (job.status === 'running') job.status = 'queued';
        // Keep a day of history in memory; older finished jobs stay on disk only.
        if (job.status === 'queued' || Date.now() - Date.parse(job.createdAt) < 86_400_000) jobs.set(job.id, job);
      } catch {
        /* skip corrupt file */
      }
    }
  }

  function pump() {
    while (running < concurrency) {
      const next = [...jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next) return;
      running++;
      void execute(next).finally(() => {
        running--;
        pump();
      });
    }
  }

  async function execute(job: Job) {
    const handler = opts.handlers[job.kind];
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    await persist(job);
    const dir = join(dataDir, 'work', job.id);
    await mkdir(dir, { recursive: true });
    let lastWrite = 0;
    const ctx: JobContext = {
      id: job.id,
      dir,
      progress: (fraction, message) => {
        job.progress = Math.max(0, Math.min(1, fraction));
        if (message) job.message = message;
        if (Date.now() - lastWrite > 500) {
          lastWrite = Date.now();
          void persist(job);
        }
      },
    };
    try {
      job.output = await handler(job.input, ctx);
      job.status = 'done';
      job.progress = 1;
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      console.error(`[${opts.name}] ${job.kind} ${job.id} failed:`, process.env.SHIPCAST_DEBUG && e instanceof Error ? e.stack : job.error);
    }
    job.endedAt = new Date().toISOString();
    await persist(job);
    notify(job.id);
  }

  async function submit(kind: string, input: unknown): Promise<Job> {
    if (!Object.hasOwn(opts.handlers, kind)) throw new ServiceError(400, `unknown kind "${kind}" (have: ${Object.keys(opts.handlers).join(', ')})`);
    const job: Job = { id: `${opts.name}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, kind, status: 'queued', input, createdAt: new Date().toISOString() };
    jobs.set(job.id, job);
    await persist(job);
    pump();
    return job;
  }

  function wait(id: string, ms: number): Promise<void> {
    const job = jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'failed') return Promise.resolve();
    return new Promise((r) => {
      const set = waiters.get(id) ?? new Set();
      const done = () => r();
      set.add(done);
      waiters.set(id, set);
      setTimeout(() => {
        set.delete(done);
        r();
      }, ms);
    });
  }

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 5_000_000) throw new ServiceError(413, 'body too large');
      chunks.push(c);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      throw new ServiceError(400, 'invalid JSON');
    }
  };

  const server: Server = createServer(async (req, res) => {
    try {
      if (!/^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+)(:\d+)?$/.test(req.headers.host ?? '')) throw new ServiceError(403, 'bad host');
      // Services are called by other services, never by browsers.
      if (req.headers.origin) throw new ServiceError(403, 'browser requests are not accepted');
      const url = new URL(req.url ?? '/', 'http://x');
      const m = url.pathname.match(/^\/jobs\/([\w-]+)(\/wait)?$/);
      if (req.method === 'GET' && url.pathname === '/health') {
        const queued = [...jobs.values()].filter((j) => j.status === 'queued').length;
        return send(res, 200, { name: opts.name, ok: true, version: opts.version ?? '0', kinds: Object.keys(opts.handlers), queued, running, ...(await opts.health?.()) });
      }
      if (req.method === 'POST' && (url.pathname === '/jobs' || url.pathname === '/run')) {
        const b = await body(req);
        const job = await submit(String(b.kind ?? ''), b.input ?? {});
        if (url.pathname === '/run') {
          while (job.status === 'queued' || job.status === 'running') await wait(job.id, 55_000);
        }
        return send(res, 200, job);
      }
      if (req.method === 'GET' && m) {
        const job = jobs.get(m[1]) ?? (existsSync(join(jobsDir, `${m[1]}.json`)) ? JSON.parse(await readFile(join(jobsDir, `${m[1]}.json`), 'utf8')) : null);
        if (!job) throw new ServiceError(404, 'no such job');
        if (m[2]) await wait(job.id, 55_000);
        return send(res, 200, jobs.get(m[1]) ?? job);
      }
      throw new ServiceError(404, 'not found');
    } catch (e) {
      send(res, e instanceof ServiceError ? e.status : 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  return {
    server,
    dataDir,
    submit,
    async listen(port = opts.port, host = process.env.SHIPCAST_BIND ?? '127.0.0.1') {
      await load();
      await new Promise<void>((r) => server.listen(port, host, r));
      pump();
      return server;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ── client ───────────────────────────────────────────────────────────────

export const SERVICE_PORTS = { render: 4320, stills: 4321, media: 4322, qa: 4323, gen: 4324, agents: 4325 } as const;
export type ServiceName = keyof typeof SERVICE_PORTS;

export function serviceUrl(name: ServiceName): string {
  return process.env[`SHIPCAST_${name.toUpperCase()}_URL`] ?? `http://127.0.0.1:${SERVICE_PORTS[name]}`;
}

/** Submit a job and wait for it. Throws with the job's error on failure. */
/** fetch that rides out a service restart: connection errors are retried for up to `forMs`. */
async function fetchRetry(url: string, init: RequestInit | undefined, forMs: number): Promise<Response> {
  const t0 = Date.now();
  for (;;) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (Date.now() - t0 > forMs) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function callService<O = any>(name: ServiceName, kind: string, input: unknown, { timeoutMs = 3_600_000 } = {}): Promise<O> {
  const base = serviceUrl(name);
  // Jobs are persisted and resumed by the service, so a restart mid-call is survivable.
  const res = await fetchRetry(`${base}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, input }) }, 90_000).catch(() => {
    throw new Error(`The ${name} service isn't reachable at ${base}. Start it with \`shipcast start\` or \`npm run service:${name}\`.`);
  });
  let job = (await res.json()) as Job<unknown, O> & { error?: string };
  if (!res.ok) throw new Error(job.error ?? `${name} rejected the job`);
  const t0 = Date.now();
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() - t0 > timeoutMs) throw new Error(`${name}/${kind} timed out`);
    job = (await (await fetchRetry(`${base}/jobs/${job.id}/wait`, undefined, 120_000)).json()) as Job<unknown, O>;
  }
  if (job.status === 'failed') throw new Error(`${name}/${kind}: ${job.error}`);
  return job.output as O;
}

export async function serviceHealth(name: ServiceName): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${serviceUrl(name)}/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export { sleep };
