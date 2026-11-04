import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { home, rootHome } from './paths.ts';
import { run, which } from './exec.ts';

/**
 * Chatterbox (Resemble AI, MIT) — an optional local voice that sounds closer
 * to a person than Kokoro, still free and offline. It needs PyTorch, so it
 * lives in its own venv, installed from Setup. One long-lived worker keeps
 * the model loaded; every voice line is a JSON request on its stdin.
 */

export const chatterboxVenv = () => join(rootHome(), 'chatterbox');
const py = () => join(chatterboxVenv(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const marker = () => join(chatterboxVenv(), '.shipcast-ready');

export const chatterboxReady = () => existsSync(marker()) && existsSync(py());

const WORKER = `
import sys, json
import torch, torchaudio as ta
from chatterbox.tts import ChatterboxTTS
dev = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
model = ChatterboxTTS.from_pretrained(device=dev)
print(json.dumps({"ready": True, "device": dev}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        wav = model.generate(req["text"], exaggeration=float(req.get("exaggeration", 0.5)), cfg_weight=float(req.get("cfg", 0.5)))
        ta.save(req["out"], wav, model.sr)
        print(json.dumps({"id": req["id"], "ok": True}), flush=True)
    except Exception as e:
        print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)[:300]}), flush=True)
`;

/** Create the venv and install Chatterbox (PyTorch included). */
export async function setupChatterbox(): Promise<{ ok: boolean; log: string }> {
  // PyTorch wheels trail new Python releases; prefer a mature interpreter when one exists.
  const candidates = ['python3.12', 'python3.11', 'python3.13', 'python3'];
  let base = '';
  for (const c of candidates) if (await which(c)) {
    base = c;
    break;
  }
  if (!base) return { ok: false, log: 'Python 3 is required (3.11 or 3.12 recommended for PyTorch).' };
  let log = `Using ${base}\n`;
  if (!existsSync(py())) {
    const v = await run(base, ['-m', 'venv', chatterboxVenv()], { timeoutMs: 120_000 });
    log += v.stdout + v.stderr;
    if (v.code !== 0) return { ok: false, log };
  }
  const p = await run(py(), ['-m', 'pip', 'install', '--upgrade', 'chatterbox-tts'], { timeoutMs: 1_800_000 });
  log += (p.stdout + p.stderr).slice(-3000);
  if (p.code !== 0) return { ok: false, log: `${log}\nChatterbox needs PyTorch; if this failed on your Python version, install Python 3.12 (e.g. brew install python@3.12) and run setup again.` };
  await mkdir(chatterboxVenv(), { recursive: true });
  await writeFile(join(chatterboxVenv(), 'worker.py'), WORKER);
  const t = await run(py(), ['-c', 'import chatterbox, torchaudio; print("ok")'], { timeoutMs: 120_000 });
  const ok = t.code === 0;
  if (ok) await writeFile(marker(), new Date().toISOString());
  return { ok, log: log + (t.stdout + t.stderr).slice(-500) };
}

let worker: { child: ChildProcess; pending: Map<string, (r: { ok: boolean; error?: string }) => void>; ready: Promise<void> } | null = null;

function startWorker() {
  const child = spawn(py(), [join(chatterboxVenv(), 'worker.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<string, (r: { ok: boolean; error?: string }) => void>();
  let markReady: () => void;
  let fail: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    markReady = res;
    fail = rej;
  });
  let err = '';
  child.stderr!.on('data', (d) => (err = (err + d).slice(-2000)));
  createInterface({ input: child.stdout! }).on('line', (l) => {
    try {
      const m = JSON.parse(l);
      if (m.ready) return markReady();
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    } catch {}
  });
  child.on('close', () => {
    fail(new Error(`Chatterbox worker stopped: ${err.trim().split('\n').at(-1) ?? ''}`));
    for (const cb of pending.values()) cb({ ok: false, error: 'Chatterbox worker stopped' });
    worker = null;
  });
  return { child, pending, ready };
}

/** Speak one line to a WAV file with the local Chatterbox model. */
export async function chatterboxSpeak(text: string, out: string, opts: { exaggeration?: number } = {}): Promise<void> {
  if (!chatterboxReady()) throw new Error('Chatterbox is not installed (Setup → Voiceover)');
  worker ??= startWorker();
  await worker.ready;
  const id = Math.random().toString(36).slice(2);
  const r = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    worker!.pending.set(id, resolve);
    worker!.child.stdin!.write(JSON.stringify({ id, text, out, exaggeration: opts.exaggeration ?? 0.5 }) + '\n');
  });
  if (!r.ok) throw new Error(r.error ?? 'Chatterbox failed');
}
