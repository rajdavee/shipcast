import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command without a shell. Never throws; missing binaries give code 127. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: 127, stdout: '', stderr: String(e) });
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 60_000);
    // Keep the tail only: installers can be very chatty.
    const cap = (s: string) => (s.length > 1_000_000 ? s.slice(-500_000) : s);
    child.stdout.on('data', (d) => (stdout = cap(stdout + d)));
    child.stderr.on('data', (d) => (stderr = cap(stderr + d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function which(bin: string): Promise<string | null> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [bin], { timeoutMs: 5000 });
  return r.code === 0 ? r.stdout.trim().split('\n')[0] : null;
}
