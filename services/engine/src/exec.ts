import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a command and collect its output. On timeout the whole process group
 * gets SIGTERM, then SIGKILL; the promise always settles, even when a child
 * ignores signals or a grandchild keeps the pipes open (npx stuck on the
 * registry, for one). Never throws; missing binaries give code 127.
 */
export function spawnCollect(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string; cap?: number } = {}): Promise<ExecResult & { timedOut?: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: ExecResult & { timedOut?: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hard);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (e) {
      return resolve({ code: 127, stdout: '', stderr: String(e) });
    }
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {}
      }
    };
    let hard: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      killGroup('SIGTERM');
      hard = setTimeout(() => {
        killGroup('SIGKILL');
        // Settle even if 'close' never comes.
        setTimeout(() => finish({ code: 124, stdout, stderr: `${stderr}\n[timed out after ${opts.timeoutMs ?? 60_000} ms]`, timedOut: true }), 2000);
      }, 5000);
    }, opts.timeoutMs ?? 60_000);
    // Keep the tail only: installers can be very chatty.
    const cap = opts.cap ?? 1_000_000;
    const keep = (s: string) => (s.length > cap ? s.slice(-Math.floor(cap / 2)) : s);
    child.stdout!.on('data', (d) => (stdout = keep(stdout + d)));
    child.stderr!.on('data', (d) => (stderr = keep(stderr + d)));
    child.on('error', (e) => finish({ code: 127, stdout, stderr: stderr + String(e) }));
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));
    if (opts.input) child.stdin!.end(opts.input);
    else child.stdin!.end();
  });
}

/** Run a command without a shell. Never throws; missing binaries give code 127. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<ExecResult> {
  return spawnCollect(cmd, args, opts);
}

export async function which(bin: string): Promise<string | null> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [bin], { timeoutMs: 5000 });
  return r.code === 0 ? r.stdout.trim().split('\n')[0] : null;
}

/**
 * `npx -y <pkg>` that heals itself: an interrupted install can leave a half-written
 * entry in npm's npx cache, after which every call fails with ENOTEMPTY. Drop that
 * entry and try once more.
 */
export async function npxRun(args: string[], opts: Parameters<typeof spawnCollect>[2] = {}): Promise<ExecResult & { timedOut?: boolean }> {
  const go = () => spawnCollect('npx', ['-y', '--prefer-offline', ...args], opts);
  const r = await go();
  const m = /ENOTEMPTY[^\n]*?(\/[^\s'"]*\/_npx\/[0-9a-f]+)/.exec(r.stderr + r.stdout);
  if (r.code !== 0 && m) {
    const { rm } = await import('node:fs/promises');
    await rm(m[1], { recursive: true, force: true }).catch(() => {});
    return go();
  }
  return r;
}
