#!/usr/bin/env node
// Shipcast media engines for any kind of video. Zero dependencies (Node 22+).
//
//   node media.mjs status
//   node media.mjs stock video "rain on a tram window at night" --seconds 6 --orientation landscape --out work/assets
//   node media.mjs stock image "misty pine forest at dawn" --orientation landscape --out work/assets [--provider pixabay|unsplash|pexels]
//   node media.mjs gen image "<cinematographer prompt>" --aspect 16:9 --out work/assets [--model fal-ai/flux/schnell]
//   node media.mjs gen video "<prompt>" --seconds 5 --aspect 16:9 [--image start.png] [--end-image last.png] [--audio voice.wav] --out work/assets [--model …] [--tier draft|standard|premium] [--placeholder] [--takes 1-3 --label "scene 2 hero"]
//   node media.mjs sfx "magic sparkle whoosh" --seconds 4 --out work/assets
//
// Keys come from Shipcast's Setup page (stored in $SHIPCAST_HOME/secrets.json); nothing is
// generated or downloaded without the user's own key. Every file prints one JSON line
// {file, credit, url} and credits are appended to <out>/credits.txt.

import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';

// Inside a run, this workspace's own folder (its keys); otherwise the install as before.
const home = process.env.SHIPCAST_WORKSPACE_HOME || process.env.SHIPCAST_HOME || join(homedir(), '.shipcast');
const secrets = (() => {
  try {
    return JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const key = (name) => process.env[`SHIPCAST_${name.toUpperCase()}_KEY`] || secrets[name] || '';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  else pos.push(argv[i]);
}
const out = resolve(String(flags.out || 'work/assets'));
const emit = (o) => console.log(JSON.stringify(o));
const die = (msg, code = 1) => {
  console.error(JSON.stringify({ error: msg }));
  process.exit(code);
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';

// Providers refuse these too; we refuse first and say why.
const BLOCK = /\b(nude|naked|nsfw|porn|sexual|sex scene|explicit|erotic|hentai|lingerie|topless|genitals?|deepfake)\b/i;
const guard = (text) => {
  if (BLOCK.test(text)) die('This prompt asks for sexual or explicit content (or a deepfake), which Shipcast does not make.', 3);
};

async function download(url, file, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  await mkdir(out, { recursive: true });
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
async function credit(line) {
  await mkdir(out, { recursive: true });
  await appendFile(join(out, 'credits.txt'), line + '\n');
}

// ── status ───────────────────────────────────────────────────────────────
async function status() {
  const comfy = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  const s = {
    stock: (() => {
      const video = STOCK_ORDER.video.filter((p) => key(p));
      const image = STOCK_ORDER.image.filter((p) => key(p));
      return { available: image.length > 0, video: video.length > 0, providers: { video, image }, note: video.length ? 'real footage and photos' : image.length ? 'real photos only (add Pixabay for footage)' : 'add a free Pixabay key in Setup to use real footage and photos' };
    })(),
    generative: {
      available: !!(key('fal') || key('replicate')),
      provider: key('fal') ? 'fal' : key('replicate') ? 'replicate' : null,
      video: !!key('fal') || !!key('replicate'),
      note: key('fal') || key('replicate') ? 'generated images and video clips (paid per clip on your account)' : 'connect fal.ai or Replicate in Setup for generated shots; otherwise use motion graphics, the cartoon kit or stock',
      localComfyUI: comfy,
    },
    sfx: { available: !!key('freesound'), provider: 'freesound', note: key('freesound') ? 'CC0 sound effects' : 'no Freesound key — synthesize SFX in the music bed instead' },
    always: ['motion (HyperFrames + GSAP)', 'cartoon-kit (original characters, worlds, effects)', 'type (word-synced text)', 'data (charts, maps, timelines)', 'capture (film any website)', 'local voice (Kokoro)'],
  };
  console.log(JSON.stringify(s, null, 2));
}

// ── stock: footage Pixabay → Pexels; photos Unsplash (2400 px) → Pixabay (1280 px) → Pexels ──
// Pixabay: videos + photos, free for commercial use, no attribution required (we still credit).
// Unsplash: photos only; its guidelines ask for credit and a ping to download_location.
// Hotlinking is not allowed by Pixabay, so every file is downloaded into --out.
const STOCK_ORDER = { video: ['pixabay', 'pexels'], image: ['unsplash', 'pixabay', 'pexels'] };
const fits = (w, h, orientation) => (orientation === 'portrait' ? h > w : orientation === 'square' ? Math.abs(w - h) / Math.max(w, h) < 0.2 : w > h);

const STOCK = {
  async pixabay(kind, query, k, { orientation, seconds, count }) {
    const q = encodeURIComponent(query.slice(0, 100));
    if (kind === 'video') {
      const r = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(k)}&q=${q}&per_page=30&safesearch=true`, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`Pixabay search failed (${r.status})`);
      const hits = ((await r.json()).hits || []).filter((v) => v.duration >= Math.min(seconds, 20));
      // Long side closest to 1920: full HD whichever way it's shot, so a landscape clip can still be cropped to vertical.
      const pickFile = (v) => Object.values(v.videos || {}).filter((f) => f && f.url && f.width).sort((a, b) => Math.abs(Math.max(a.width, a.height) - 1920) - Math.abs(Math.max(b.width, b.height) - 1920))[0];
      const ranked = [...hits.filter((v) => { const f = pickFile(v); return f && fits(f.width, f.height, orientation); }), ...hits];
      const seen = new Set();
      const outFiles = [];
      for (const v of ranked) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        const f = pickFile(v);
        if (!f) continue;
        const file = join(out, `${slug(query)}-pixabay-${v.id}-${f.width}.mp4`);
        if (!existsSync(file)) await download(f.url, file);
        outFiles.push({ file, credit: `Video by ${v.user || 'a Pixabay creator'} on Pixabay — ${v.pageURL}`, url: v.pageURL, width: f.width, height: f.height, duration: v.duration });
        if (outFiles.length >= count) break;
      }
      return outFiles;
    }
    const o = orientation === 'portrait' ? 'vertical' : orientation === 'square' ? 'all' : 'horizontal';
    const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(k)}&q=${q}&image_type=photo&orientation=${o}&per_page=20&safesearch=true`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Pixabay search failed (${r.status})`);
    const hits = (await r.json()).hits || [];
    const outFiles = [];
    for (const p of hits.slice(0, count)) {
      const file = join(out, `${slug(query)}-pixabay-${p.id}.jpg`);
      if (!existsSync(file)) await download(p.largeImageURL || p.webformatURL, file);
      outFiles.push({ file, credit: `Photo by ${p.user || 'a Pixabay creator'} on Pixabay — ${p.pageURL}`, url: p.pageURL, width: p.imageWidth, height: p.imageHeight });
    }
    return outFiles;
  },
  async unsplash(kind, query, k, { orientation, count }) {
    if (kind !== 'image') return [];
    const o = orientation === 'portrait' ? 'portrait' : orientation === 'square' ? 'squarish' : 'landscape';
    const auth = { Authorization: `Client-ID ${k}` };
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${o}&per_page=15&content_filter=high`, { headers: auth, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Unsplash search failed (${r.status})`);
    const outFiles = [];
    for (const p of ((await r.json()).results || []).slice(0, count)) {
      const file = join(out, `${slug(query)}-unsplash-${p.id}.jpg`);
      if (!existsSync(file)) {
        await download(`${p.urls.raw}&w=2400&q=85&fm=jpg`, file);
        // Unsplash API guidelines: count the download.
        await fetch(p.links.download_location, { headers: auth }).catch(() => {});
      }
      const by = p.user?.name || 'an Unsplash photographer';
      outFiles.push({ file, credit: `Photo by ${by} on Unsplash — ${p.links.html}`, url: p.links.html, width: p.width, height: p.height });
    }
    return outFiles;
  },
  async pexels(kind, query, k, { orientation, seconds, count }) {
    const outFiles = [];
    if (kind === 'video') {
      const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&size=medium&per_page=20`, { headers: { Authorization: k }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`Pexels search failed (${r.status})`);
      const want = orientation === 'portrait' ? 1080 : 1920;
      for (const v of ((await r.json()).videos || []).filter((v) => v.duration >= Math.min(seconds, 20))) {
        const f = (v.video_files || []).filter((x) => x.file_type === 'video/mp4' && x.width).sort((a, b) => Math.abs(a.width - want) - Math.abs(b.width - want))[0];
        if (!f) continue;
        const file = join(out, `${slug(query)}-${v.id}.mp4`);
        if (!existsSync(file)) await download(f.link, file);
        outFiles.push({ file, credit: `Video by ${v.user?.name || 'a Pexels creator'} on Pexels — ${v.url}`, url: v.url, width: f.width, height: f.height, duration: v.duration });
        if (outFiles.length >= count) break;
      }
      return outFiles;
    }
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=15`, { headers: { Authorization: k }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Pexels search failed (${r.status})`);
    for (const p of ((await r.json()).photos || []).slice(0, count)) {
      const file = join(out, `${slug(query)}-${p.id}.jpg`);
      if (!existsSync(file)) await download(p.src.large2x || p.src.original, file);
      outFiles.push({ file, credit: `Photo by ${p.photographer} on Pexels — ${p.url}`, url: p.url, width: p.width, height: p.height });
    }
    return outFiles;
  },
};

async function stock(kind, query) {
  guard(query);
  const order = STOCK_ORDER[kind].filter((p) => key(p) && (!flags.provider || flags.provider === p));
  if (!order.length) die(`No stock ${kind === 'video' ? 'footage' : 'photo'} key. Add a free Pixabay key${kind === 'image' ? ' (or Unsplash)' : ''} in Shipcast Setup → Stock footage, or use another engine.`, 2);
  const opts = { orientation: String(flags.orientation || 'landscape'), seconds: Number(flags.seconds) || 5, count: Math.min(5, Number(flags.count) || 1) };
  const errors = [];
  for (const p of order) {
    try {
      const files = await STOCK[p](kind, query, key(p), opts);
      if (!files.length) {
        errors.push(`${p}: nothing for "${query}"`);
        continue;
      }
      for (const f of files) {
        await credit(f.credit);
        emit({ ...f, provider: p });
      }
      return;
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  die(`No stock ${kind} for "${query}" (${errors.join('; ')}) — try a more concrete query`, 4);
}

// ── generative (fal.ai queue API, or Replicate) ──────────────────────────
const FAL_SIZE = { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd', '4:5': 'portrait_4_3', '4:3': 'landscape_4_3' };

async function asDataUri(path) {
  const buf = await readFile(path);
  const ext = extname(path).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext || 'png'};base64,${buf.toString('base64')}`;
}

async function falRun(model, input) {
  const k = key('fal');
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${k}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const j = await sub.json().catch(() => ({}));
  if (!sub.ok) die(`fal rejected the request (${sub.status}): ${JSON.stringify(j).slice(0, 300)}`);
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 20 * 60_000) die('fal took longer than 20 minutes');
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(j.status_url, { headers: { Authorization: `Key ${k}` } }).then((r) => r.json()).catch(() => ({}));
    if (st.status === 'COMPLETED') break;
    if (st.status === 'FAILED' || st.error) die(`fal failed: ${JSON.stringify(st).slice(0, 300)}`);
  }
  return fetch(j.response_url, { headers: { Authorization: `Key ${k}` } }).then((r) => r.json());
}

async function replicateRun(model, input) {
  const k = key('replicate');
  const r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'content-type': 'application/json', Prefer: 'wait=60' }, body: JSON.stringify({ input }) });
  let p = await r.json().catch(() => ({}));
  if (!r.ok) die(`Replicate rejected the request (${r.status}): ${JSON.stringify(p).slice(0, 300)}`);
  const t0 = Date.now();
  while (p.status !== 'succeeded') {
    if (p.status === 'failed' || p.status === 'canceled') die(`Replicate ${p.status}: ${String(p.error).slice(0, 300)}`);
    if (Date.now() - t0 > 20 * 60_000) die('Replicate took longer than 20 minutes');
    await new Promise((res) => setTimeout(res, 4000));
    p = await fetch(p.urls.get, { headers: { Authorization: `Bearer ${k}` } }).then((x) => x.json());
  }
  return p.output;
}

const firstUrl = (o) => {
  if (!o) return null;
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return firstUrl(o[0]);
  return o.video?.url || o.images?.[0]?.url || o.image?.url || o.url || null;
};

/**
 * Prefer the Shipcast gen service: one place for model routing, budgets, the
 * safety guard, caching and disclosure. Falls back to calling fal/Replicate
 * directly when the service isn't running.
 */
async function genViaService(kind, prompt) {
  const base = process.env.SHIPCAST_GEN_URL || 'http://127.0.0.1:4324';
  const up = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  if (!up) return false;
  const campaign = resolve('.').match(/campaigns\/([^/]+)/)?.[1];
  const capability = kind === 'image' ? (flags.image ? 'edit' : 't2i') : flags.audio ? 's2v' : flags.image ? 'i2v' : 't2v';
  const input = {
    capability,
    prompt,
    aspect: String(flags.aspect || '16:9'),
    ...(flags.seconds ? { seconds: Number(flags.seconds) } : {}),
    ...(flags.image ? (capability === 'edit' ? { images: String(flags.image).split(',').map((f) => resolve(f)) } : { image: resolve(String(flags.image)) }) : {}),
    ...(flags['end-image'] ? { endImage: resolve(String(flags['end-image'])) } : {}),
    ...(flags.audio ? { audio: resolve(String(flags.audio)) } : {}),
    ...(flags.model ? { model: String(flags.model) } : {}),
    ...(flags.tier ? { tier: String(flags.tier) } : {}),
    ...(flags.placeholder ? { provider: 'fake' } : {}),
    ...(flags.takes ? { takes: Math.min(3, Math.max(1, Number(flags.takes))) } : {}),
    budgetKey: campaign ?? 'adhoc',
    out: join(out, `gen-${kind}-${slug(prompt)}-${Date.now().toString(36)}`),
  };
  const r = await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.SHIPCAST_RUN_TOKEN ? { 'x-shipcast-run': process.env.SHIPCAST_RUN_TOKEN } : {}) }, body: JSON.stringify({ kind: 'generate', input }) });
  const j = await r.json().catch(() => ({}));
  if (j.status !== 'done') die(j.error || `generation failed (${r.status})`, /cap|budget/i.test(j.error || '') ? 5 : 1);
  const takes = j.output.takes ?? [j.output];
  for (const o of takes) {
    const c = `Generated with ${o.model}${o.cached ? ' (cached)' : ''} — ${(o.disclosure || ['AI-generated']).join(', ')}`;
    await credit(c);
    emit({ file: o.file, poster: o.poster, credit: c, model: o.model, usd: o.usd, cached: o.cached, prompt: o.prompt, disclosure: o.disclosure });
  }
  if (takes.length > 1) {
    // Record the alternatives so the person can swap takes on the campaign page without another Claude run.
    // One file per shot: parallel gen calls can't overwrite each other's takes (the API merges them).
    const id = `${slug(prompt)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await mkdir(resolve('out', 'takes'), { recursive: true });
    await writeFile(resolve('out', 'takes', `${id}.json`), JSON.stringify({ id, label: String(flags.label || prompt).slice(0, 80), kind, files: takes.map((t) => t.file), posters: takes.map((t) => t.poster ?? t.file), chosen: 0 }, null, 2));
  }
  return true;
}

async function gen(kind, prompt) {
  guard(prompt);
  if (await genViaService(kind, prompt)) return;
  if (!key('fal') && !key('replicate')) die('No generative engine connected. Add a fal.ai or Replicate key in Shipcast Setup → Media engines, or use motion graphics, the cartoon kit or stock instead.', 2);
  const aspect = String(flags.aspect || '16:9');
  const useFal = !!key('fal') && flags.provider !== 'replicate';
  let output;
  let model;
  if (kind === 'image') {
    model = String(flags.model || (useFal ? 'fal-ai/flux/schnell' : 'black-forest-labs/flux-schnell'));
    output = useFal ? await falRun(model, { prompt, image_size: FAL_SIZE[aspect] || 'landscape_16_9', num_images: 1, enable_safety_checker: true }) : await replicateRun(model, { prompt, aspect_ratio: aspect, output_format: 'png' });
  } else {
    const img = flags.image ? await asDataUri(String(flags.image)) : null;
    if (useFal) {
      model = String(flags.model || (img ? 'fal-ai/wan-i2v' : 'fal-ai/wan-t2v'));
      output = await falRun(model, { prompt, aspect_ratio: aspect, ...(img ? { image_url: img } : {}), ...(flags.seconds ? { duration: String(flags.seconds) } : {}), enable_safety_checker: true });
    } else {
      if (!flags.model) die('Replicate video needs --model owner/name (pick a video model from replicate.com/collections/text-to-video).', 2);
      model = String(flags.model);
      output = await replicateRun(model, { prompt, aspect_ratio: aspect, ...(img ? { image: img } : {}) });
    }
  }
  const url = firstUrl(output);
  if (!url) die(`The model returned no file: ${JSON.stringify(output).slice(0, 300)}`);
  const ext = kind === 'image' ? (extname(new URL(url).pathname) || '.png') : '.mp4';
  const file = join(out, `gen-${kind}-${slug(prompt)}-${Date.now().toString(36)}${ext}`);
  await download(url, file);
  const c = `Generated with ${model} via ${useFal ? 'fal.ai' : 'Replicate'} (the user's account)`;
  await credit(c);
  emit({ file, credit: c, model, prompt });
}

// ── sound effects (Freesound, CC0 only) ──────────────────────────────────
async function sfx(query) {
  const k = key('freesound');
  if (!k) die('No Freesound key. Add one in Setup → Media engines, or build the sound into the music bed.', 2);
  const max = Number(flags.seconds) || 6;
  const u = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}&filter=${encodeURIComponent(`license:"Creative Commons 0" duration:[0.2 TO ${max}]`)}&fields=id,name,username,previews,url,duration&sort=rating_desc&page_size=5&token=${encodeURIComponent(k)}`;
  const r = await fetch(u);
  if (!r.ok) die(`Freesound search failed (${r.status})`);
  const res = (await r.json()).results || [];
  if (!res.length) die(`No CC0 sound for "${query}"`, 4);
  const count = Math.min(3, Number(flags.count) || 1);
  for (const s of res.slice(0, count)) {
    const file = join(out, `sfx-${slug(query)}-${s.id}.mp3`);
    if (!existsSync(file)) await download(s.previews['preview-hq-mp3'], file);
    const c = `"${s.name}" by ${s.username} (CC0) — ${s.url}`;
    await credit(c);
    emit({ file, credit: c, url: s.url, duration: s.duration });
  }
}

const [cmd, sub, ...rest] = pos;
try {
  if (cmd === 'status') await status();
  else if (cmd === 'stock' && (sub === 'video' || sub === 'image')) await stock(sub, rest.join(' '));
  else if (cmd === 'gen' && (sub === 'video' || sub === 'image')) await gen(sub, rest.join(' '));
  else if (cmd === 'sfx') await sfx([sub, ...rest].join(' '));
  else die('usage: media.mjs status | stock video|image "<query>" | gen image|video "<prompt>" | sfx "<query>"  [--out dir] [--aspect 16:9] [--seconds N] [--orientation landscape|portrait|square] [--image file] [--model id]', 64);
} catch (e) {
  die(e.message || String(e));
}
