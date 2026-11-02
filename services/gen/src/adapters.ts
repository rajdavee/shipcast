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

/** Local placeholder: a labelled card (image) or a short labelled clip (video), with the prompt on it. */
export function fakeAdapter(workDir: string): Adapter {
  return {
    async upload(file) {
      return file;
    },
    async run(m, payload) {
      await mkdir(workDir, { recursive: true });
      const id = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 10);
      const video = ['i2v', 't2v', 's2v', 'lipsync', 'upscale-video'].includes(m.capability);
      const [w, h] = payload.aspect === '9:16' ? [720, 1280] : payload.aspect === '1:1' ? [1024, 1024] : [1280, 720];
      const label = String(payload.prompt ?? m.capability).replace(/[^\w ,.-]/g, ' ').slice(0, 80);
      const out = `${workDir}/fake-${m.capability}-${id}.${video ? 'mp4' : 'png'}`;
      const text = `drawtext=text='PLACEHOLDER  ${m.capability}':fontcolor=white:fontsize=${Math.round(h / 16)}:x=(w-text_w)/2:y=h/2-${Math.round(h / 10)},drawtext=text='${label.replace(/'/g, '')}':fontcolor=0xcfd6e4:fontsize=${Math.round(h / 36)}:x=(w-text_w)/2:y=h/2+${Math.round(h / 24)}`;
      const src = `color=c=0x1e2533:s=${w}x${h}${video ? `:d=${Math.min(10, Number(payload.seconds ?? payload.duration ?? 5) || 5)}` : ''}`;
      const args = video ? ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-vf', text, '-pix_fmt', 'yuv420p', out] : ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-vf', text, '-frames:v', '1', out];
      const r = await run('ffmpeg', args, { timeoutMs: 120_000 });
      if (r.code !== 0) {
        // drawtext needs a font; fall back to a plain card rather than failing the pipeline.
        const plain = video ? ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-pix_fmt', 'yuv420p', out] : ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-frames:v', '1', out];
        const r2 = await run('ffmpeg', plain, { timeoutMs: 120_000 });
        if (r2.code !== 0) throw new Error(`placeholder render failed: ${r2.stderr.slice(-200)}`);
      }
      return { files: [out] };
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
