import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { run } from '@shipcast/engine';
import type { ModelInfo } from './registry.ts';

/**
 * Provider adapters behind one shape: upload local inputs, submit, wait,
 * return result URLs. fal and Replicate are hosted; "fake" draws a labelled
 * placeholder locally so whole pipelines run (and can be reviewed and tested)
 * before anyone pays for generation.
 */

export interface Adapter {
  upload(file: string): Promise<string>;
  run(m: ModelInfo, payload: Record<string, unknown>, onStatus?: (s: string) => void): Promise<any>;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function falAdapter(key: string): Adapter {
  const auth = { Authorization: `Key ${key}` };
  return {
    async upload(file) {
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const buf = await readFile(file);
      // fal's CDN upload: ask for a signed URL, PUT the bytes, use the public file URL.
      try {
        const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ content_type: type, file_name: basename(file) }), signal: AbortSignal.timeout(30_000) });
        if (init.ok) {
          const { upload_url, file_url } = (await init.json()) as { upload_url: string; file_url: string };
          const put = await fetch(upload_url, { method: 'PUT', headers: { 'content-type': type }, body: buf, signal: AbortSignal.timeout(300_000) });
          if (put.ok) return file_url;
        }
      } catch {}
      if (buf.length > 8 * 1024 * 1024) throw new Error(`Couldn't upload ${basename(file)} to fal (and it's too big to inline).`);
      return `data:${type};base64,${buf.toString('base64')}`;
    },
    async run(m, payload, onStatus) {
      const sub = await fetch(`https://queue.fal.run/${m.endpoint}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
      const j = (await sub.json().catch(() => ({}))) as any;
      if (sub.status === 401 || sub.status === 403) throw new Error('fal rejected the API key (Setup → Media engines).');
      if (!sub.ok) throw new Error(`fal rejected the request (${sub.status}): ${JSON.stringify(j).slice(0, 300)}`);
      const t0 = Date.now();
      for (;;) {
        if (Date.now() - t0 > 25 * 60_000) throw new Error(`${m.label} took longer than 25 minutes`);
        await sleep(3000);
        const st = (await fetch(j.status_url, { headers: auth }).then((r) => r.json()).catch(() => ({}))) as any;
        if (st.status) onStatus?.(st.status === 'IN_QUEUE' ? `queued (position ${st.queue_position ?? '?'})` : st.status.toLowerCase());
        if (st.status === 'COMPLETED') break;
        if (st.status === 'FAILED' || st.error) throw new Error(`${m.label} failed: ${JSON.stringify(st.error ?? st).slice(0, 300)}`);
      }
      const res = await fetch(j.response_url, { headers: auth });
      const out = (await res.json()) as any;
      if (!res.ok) throw new Error(`${m.label} failed: ${JSON.stringify(out).slice(0, 300)}`);
      if (out?.has_nsfw_concepts?.some?.(Boolean)) throw new Error('The provider\'s safety checker blocked the result.');
      return out;
    },
  };
}

export function replicateAdapter(key: string): Adapter {
  const auth = { Authorization: `Bearer ${key}` };
  return {
    async upload(file) {
      const buf = await readFile(file);
      const form = new FormData();
      form.append('content', new Blob([buf], { type: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' }), basename(file));
      const r = await fetch('https://api.replicate.com/v1/files', { method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new Error(`Replicate upload failed (${r.status})`);
      return ((await r.json()) as any).urls.get;
    },
    async run(m, payload, onStatus) {
      const r = await fetch(`https://api.replicate.com/v1/models/${m.endpoint}/predictions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', Prefer: 'wait=60' }, body: JSON.stringify({ input: payload }) });
      let p = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) throw new Error(`Replicate rejected the request (${r.status}): ${JSON.stringify(p).slice(0, 300)}`);
      const t0 = Date.now();
      while (p.status !== 'succeeded') {
        if (p.status === 'failed' || p.status === 'canceled') throw new Error(`Replicate ${p.status}: ${String(p.error).slice(0, 300)}`);
        if (Date.now() - t0 > 25 * 60_000) throw new Error('Replicate took longer than 25 minutes');
        onStatus?.(p.status);
        await sleep(3000);
        p = await fetch(p.urls.get, { headers: auth }).then((x) => x.json());
      }
      return { output: p.output };
    },
  };
}

/**
 * Local placeholder: a labelled card drawn by the stills service (Chrome), so it
 * shows what the shot will be — capability, prompt, aspect — and for video the
 * same card held for the clip's length. Falls back to a plain card if stills is down.
 */
export function fakeAdapter(workDir: string): Adapter {
  return {
    async upload(file) {
      return file;
    },
    async run(m, payload) {
      await mkdir(workDir, { recursive: true });
      const id = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 10);
      const video = ['i2v', 't2v', 's2v', 'lipsync', 'upscale-video'].includes(m.capability);
      const [w, h] = payload.aspect === '9:16' ? [720, 1280] : payload.aspect === '1:1' ? [1024, 1024] : payload.aspect === '4:5' ? [1024, 1280] : [1280, 720];
      const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      const kind = { t2i: 'Generated image', edit: 'Edited image', i2v: 'Generated clip', t2v: 'Generated clip', s2v: 'Talking presenter', lipsync: 'Lip-synced clip', upscale: 'Upscaled image', 'upscale-video': 'Upscaled clip', cutout: 'Cut-out' }[m.capability];
      const said = String(payload.prompt ?? '');
      const shown = said.length > 160 ? `${said.slice(0, 160).replace(/\s+\S*$/, '')}…` : said;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}body{display:grid;place-items:center;background:repeating-linear-gradient(135deg,#1d2433 0 22px,#212a3b 22px 44px);font-family:-apple-system,Helvetica,Arial,sans-serif;color:#e8ecf4}.c{max-width:78%;text-align:center;display:grid;gap:${Math.round(h / 40)}px}.k{font-weight:800;letter-spacing:.16em;text-transform:uppercase;font-size:${Math.round(h / 34)}px;color:#9fb0cc}.p{font-size:${Math.round(h / 22)}px;line-height:1.3;font-weight:600}.n{font-size:${Math.round(h / 44)}px;color:#8a97ad}</style></head><body><div class="c"><div class="k">Placeholder · ${esc(kind)}</div><div class="p">${esc(shown)}</div><div class="n">Connect a generation key in Setup to make it real · ${w}×${h}</div></div></body></html>`;
      const card = `${workDir}/fake-${m.capability}-${id}.html`;
      const png = `${workDir}/fake-${m.capability}-${id}.png`;
      await writeFile(card, html);
      let drawn = false;
      try {
        const base = process.env.SHIPCAST_STILLS_URL ?? 'http://127.0.0.1:4321';
        const r = await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'html', input: { file: card, out: png, width: w, height: h } }), signal: AbortSignal.timeout(60_000) });
        drawn = r.ok && ((await r.json()) as { status?: string }).status === 'done';
      } catch {}
      if (!drawn) {
        const r = await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x1e2533:s=${w}x${h}`, '-frames:v', '1', png], { timeoutMs: 60_000 });
        if (r.code !== 0) throw new Error(`placeholder render failed: ${r.stderr.slice(-200)}`);
      }
      if (!video) return { files: [png] };
      const secs = Math.min(10, Number(payload.seconds ?? payload.duration ?? 5) || 5);
      const mp4 = `${workDir}/fake-${m.capability}-${id}.mp4`;
      // Talking-presenter stand-ins keep the voice track so the edit's timing and sound are real.
      const audio = typeof payload.audio === 'string' && !/^https?:/.test(payload.audio) ? payload.audio : '';
      const args = ['-y', '-v', 'error', '-loop', '1', '-i', png, ...(audio ? ['-i', audio] : []), '-t', String(secs), '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', ...(audio ? ['-c:a', 'aac', '-shortest'] : []), mp4];
      const r = await run('ffmpeg', args, { timeoutMs: 120_000 });
      if (r.code !== 0) throw new Error(`placeholder clip failed: ${r.stderr.slice(-200)}`);
      return { files: [mp4] };
    },
  };
}

/** Download a result into place (or copy a local placeholder). */
export async function fetchTo(url: string, file: string): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  if (!/^https?:/.test(url)) {
    await writeFile(file, await readFile(url));
    return file;
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

export async function fileHash(file: string): Promise<string> {
  const s = await stat(file);
  if (s.size > 200 * 1024 * 1024) return `${s.size}-${s.mtimeMs}`;
  return createHash('sha1').update(await readFile(file)).digest('hex');
}
