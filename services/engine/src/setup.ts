import { setupChatterbox } from './chatterbox.ts';
import { existsSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { home } from './paths.ts';
import { run } from './exec.ts';

/**
 * Optional local engines Shipcast can set up for you. Each installs into
 * ~/.shipcast or a tool's own cache — never into system Python or global npm.
 */
export const voiceVenv = () => join(home(), 'voice');
export const voicePython = () => join(voiceVenv(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/** Env for Claude runs so HyperFrames finds Shipcast-managed engines. */
const voiceMarker = () => join(voiceVenv(), '.shipcast-ready');

/** Env for Claude runs and services so HyperFrames finds Shipcast-managed engines (only once setup succeeded). */
export function engineEnv(): Record<string, string> {
  return existsSync(voiceMarker()) ? { HYPERFRAMES_PYTHON: voicePython() } : {};
}

export async function voiceReady(): Promise<boolean> {
  const candidates = [voicePython(), 'python3'].filter((p) => p === 'python3' || existsSync(p));
  for (const py of candidates) if ((await run(py, ['-c', 'import kokoro_onnx, soundfile'], { timeoutMs: 20_000 })).code === 0) return true;
  return false;
}

export const SETUPS = {
  voice: {
    label: 'Kokoro voice',
    async run(): Promise<{ ok: boolean; log: string }> {
      let log = '';
      if (!existsSync(voicePython())) {
        await rm(voiceMarker(), { force: true });
      const v = await run('python3', ['-m', 'venv', voiceVenv()], { timeoutMs: 120_000 });
        log += v.stdout + v.stderr;
        if (v.code !== 0) return { ok: false, log: log + '\nPython 3 with the venv module is required.' };
      }
      const p = await run(voicePython(), ['-m', 'pip', 'install', '--upgrade', 'kokoro-onnx', 'soundfile'], { timeoutMs: 900_000 });
      log += p.stdout.slice(-2000) + p.stderr.slice(-2000);
      // espeak-ng silently ignores data paths of 160+ characters and falls back
      // to a path that doesn't exist, so catch that here with a clear message.
      const dp = await run(voicePython(), ['-c', 'import espeakng_loader as e; print(e.get_data_path())'], { timeoutMs: 20_000 });
      const dataPath = dp.stdout.trim();
      if (dataPath.length >= 159) {
        return { ok: false, log: `${log}\nThe voice data path is too long for espeak-ng (${dataPath.length} chars, limit 159):\n${dataPath}\nSet SHIPCAST_HOME to a shorter folder and run setup again.` };
      }
      const ok = p.code === 0 && (await voiceReady());
      if (ok) await writeFile(voiceMarker(), new Date().toISOString());
      return { ok, log };
    },
  },
  chatterbox: {
    label: 'Chatterbox voice (optional, ~2 GB)',
    run: () => setupChatterbox(),
  },
  chrome: {
    label: 'Headless Chrome',
    async run(): Promise<{ ok: boolean; log: string }> {
      const r = await run('npx', ['-y', '--prefer-offline', 'hyperframes', 'browser', 'ensure'], { timeoutMs: 900_000 });
      return { ok: r.code === 0, log: (r.stdout + r.stderr).slice(-3000) };
    },
  },
} as const;

export type SetupId = keyof typeof SETUPS;
