import { readFile, rm } from 'node:fs/promises';
import { run } from '@shipcast/engine';
import type { SceneCtx, SceneDef } from './scenes.ts';

/** Frames per second of the level track (matches the render's fps). */
export const LEVEL_FPS = 30;

/**
 * Loudness per video frame, 0–1, measured from the real audio: decoded to mono
 * PCM, RMS per 1/30 s window, in dB relative to the clip's own loud parts (so a
 * quiet recording still moves), with a quick attack and a slower release so
 * bars fall like a meter instead of flickering. Pure function of the file:
 * the scene indexes it by time, so any seek order renders the same frame.
 */
export async function audioLevels(file: string, scratch: string, fps = LEVEL_FPS): Promise<number[]> {
  const rate = 8000;
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', scratch], { timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`could not read audio levels: ${r.stderr.slice(-200)}`);
  const buf = await readFile(scratch);
  await rm(scratch, { force: true });
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const win = rate / fps;
  const db: number[] = [];
  for (let f = 0; f * win < pcm.length; f++) {
    let sum = 0;
    const a = Math.floor(f * win);
    const b = Math.min(pcm.length, Math.floor((f + 1) * win));
    for (let i = a; i < b; i++) sum += (pcm[i] / 32768) ** 2;
    db.push(20 * Math.log10(Math.sqrt(sum / Math.max(1, b - a)) + 1e-9));
  }
  if (!db.length) return [];
  const loud = [...db].sort((x, y) => x - y)[Math.floor(db.length * 0.95)] ?? -20;
  const ref = Math.max(loud, -45);
  let prev = 0;
  return db.map((d) => {
    const v = Math.min(1, Math.max(0, (d - (ref - 36)) / 36));
    prev = v >= prev ? v : Math.max(v, prev * 0.82);
    return Math.round(prev * 1000) / 1000;
  });
}

type Helpers = {
  frame: (c: SceneCtx) => { u: number; vertical: boolean; pad: { t: number; r: number; b: number; l: number }; S: string };
  bg: (c: SceneCtx, mode?: 'dark' | 'brand' | 'light') => { markup: string; css: string; js: string };
  words: (text: unknown, cls?: string) => string;
  fit: (text: unknown, u: number, steps: [number, number][], min: number) => number;
  img: (src: unknown, c: SceneCtx) => string;
  headCss: (S: string) => string;
  has: (sel: string, code: string) => string;
  wordIn: (S: string, sel: string, at: number, cls?: string) => string;
  esc: (s: unknown) => string;
};

export function audiogramScenes(h: Helpers): SceneDef[] {
  const { frame, bg, words, fit, img, headCss, has, wordIn, esc } = h;
  return [
    {
      id: 'audiogram',
      label: 'Audiogram (speaker + live waveform)',
      use: 'A spoken segment — founder voiceover (`vo`) or a podcast/interview clip from the brief (`audio`) — with bars driven by the real audio, the speaker lower-third, logo and optional cover art. Captions burn in automatically. One scene per clip; 30–90 s.',
      minSeconds: 3,
      fields: [
        { id: 'name', type: 'text', label: 'Speaker name', max: 40 },
        { id: 'title', type: 'text', label: 'Speaker title', optional: true, max: 60, help: 'e.g. "Founder, Shipcast" or "Host, The Build Show"' },
        { id: 'headline', type: 'text', label: 'Topic line', optional: true, max: 70, help: 'What the clip is about, ≤ 10 words; *wrap* the key word' },
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 32, help: 'e.g. "Podcast · Ep 12"' },
        { id: 'cover', type: 'image', label: 'Cover art or speaker photo', optional: true },
        { id: 'audio', type: 'image', label: 'Audio file from the brief (instead of vo)', optional: true, help: 'Path relative to the brief folder (.mp3/.wav/.m4a, or a video); give the scene no vo line' },
        { id: 'from', type: 'number', label: 'Start at (s into the audio)', optional: true },
        { id: 'to', type: 'number', label: 'End at (s into the audio)', optional: true },
        { id: 'style', type: 'text', label: 'Waveform (bars/wave)', optional: true },
        { id: 'theme', type: 'text', label: 'Ground (dark/light/brand)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, S } = frame(c);
        const mode = f.theme === 'light' || f.theme === 'brand' ? f.theme : 'dark';
        const b = bg(c, mode);
        const L = c.levels ?? [];
        const wave = f.style === 'wave';
        const n = vertical ? 29 : 37;
        const cover = String(f.cover ?? '').trim();
        const art = Math.round((vertical ? 210 : 190) * u);
        const waveH = Math.round((vertical ? 150 : 140) * u);
        // Bars further from the centre show slightly older levels, so speech ripples outward; a fixed
        // envelope and per-bar jitter (seeded by index) keep it from reading as a pyramid.
        const env = Array.from({ length: n }, (_, k) => {
          const d = Math.abs(k - (n - 1) / 2) / ((n - 1) / 2);
          return +((1 - 0.45 * d * d) * (0.82 + 0.18 * Math.abs(Math.sin(k * 12.9898) * 43758.5453 % 1))).toFixed(3);
        });
        const plate = `<div class="who">${cover ? `<img class="art" src="${img(cover, c)}" alt="" style="width:${art}px;height:${art}px">` : ''}<div class="lt" style="padding:${Math.round(18 * u)}px ${Math.round(26 * u)}px"><b style="font-size:${Math.round(46 * u)}px">${esc(f.name)}</b>${f.title ? `<span style="font-size:${Math.round(30 * u)}px">${esc(f.title)}</span>` : ''}</div></div>`;
        const visual = wave
          ? `<svg class="wv" viewBox="0 0 1000 200" preserveAspectRatio="none" style="height:${waveH}px"><path d="M0 100 L1000 100"/></svg>`
          : `<div class="bars" style="height:${waveH}px">${env.map(() => '<i></i>').join('')}</div>`;
        const inner = `<div class="top">${c.brand.logo ? `<img class="logo" src="${img(c.brand.logo, c)}" alt="" style="height:${Math.round(54 * u)}px">` : `<span class="logo wm" style="font-size:${Math.round(40 * u)}px">${esc(c.brand.name)}</span>`}${f.kicker ? `<span class="kicker acc" style="font-size:${Math.round(28 * u)}px">${esc(f.kicker)}</span>` : ''}</div>
${f.headline ? `<h2 style="font-size:${fit(f.headline, u, vertical ? [[24, 76], [44, 64], [70, 54]] : [[24, 68], [44, 58], [70, 50]], 46)}px">${words(f.headline)}</h2>` : ''}
${plate}${visual}<div class="prog"><i></i></div>`;
        const { pad } = frame(c);
        const markup = b.markup + `<div class="stage ag" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px;gap:${Math.round(30 * u)}px">${inner}</div>`;
        const ink = mode === 'dark' ? '#f4f5f8' : mode === 'brand' ? 'var(--brand-on-primary)' : 'currentColor';
        const css =
          b.css +
          headCss(S) +
          `${S} .ag{justify-content:flex-end;align-items:stretch}
${S} .top{display:flex;align-items:center;gap:${Math.round(22 * u)}px;margin-bottom:auto}${S} .top .logo{width:auto}${S} .wm{font-family:var(--font-display);font-weight:800;letter-spacing:-.03em}
${S} .who{display:flex;align-items:center;gap:${Math.round(24 * u)}px}
${S} .art{flex:none;object-fit:cover;border-radius:${Math.round(24 * u)}px;box-shadow:0 ${Math.round(18 * u)}px ${Math.round(40 * u)}px -${Math.round(14 * u)}px rgba(0,0,0,.55)}
${S} .lt{display:flex;flex-direction:column;gap:${Math.round(6 * u)}px;min-width:0;border-left:${Math.round(8 * u)}px solid var(--brand-primary);background:${mode === 'light' ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.08)'};border-radius:0 ${Math.round(18 * u)}px ${Math.round(18 * u)}px 0}
${S} .lt b{font-family:var(--font-display);font-weight:800;letter-spacing:-.02em;line-height:1.1}${S} .lt span{opacity:.75;font-weight:500;line-height:1.25}
${S} .bars{display:flex;align-items:center;justify-content:space-between;gap:${Math.round(6 * u)}px}
${S} .bars i{flex:1;height:100%;border-radius:999px;background:${ink};transform:scaleY(.06);transform-origin:50% 50%}
${S} .bars i:nth-child(odd){background:var(--brand-primary)}
${S} .wv{width:100%;display:block}${S} .wv path{fill:var(--brand-primary);stroke:${ink};stroke-width:3;vector-effect:non-scaling-stroke}
${S} .prog{height:${Math.max(4, Math.round(6 * u))}px;border-radius:999px;background:${mode === 'light' ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.16)'};overflow:hidden}${S} .prog i{display:block;height:100%;background:var(--brand-primary);transform:scaleX(0);transform-origin:0 50%}`;
        // One tween over the whole scene drives the meter from the level track by time: seek-safe.
        const draw = wave
          ? `const p=document.querySelector("${S} .wv path");const M=120;const draw=(t)=>{const f=Math.floor(t*${LEVEL_FPS});let top="",bot="";for(let k=0;k<=M;k++){const i=f-(M-k);const v=Math.max(.03,i>=0&&i<L.length?L[i]:0)*92;const x=(k*1000/M).toFixed(1);top+=(k?"L":"M")+x+" "+(100-v).toFixed(1);bot="L"+x+" "+(100+v).toFixed(1)+bot;}p.setAttribute("d",top+bot+"Z");};`
          : `const bs=[...document.querySelectorAll("${S} .bars i")];const E=${JSON.stringify(env)};const C=${(n - 1) / 2};const draw=(t)=>{const f=Math.floor(t*${LEVEL_FPS});for(let k=0;k<bs.length;k++){const i=f-Math.round(Math.abs(k-C)*1.5);const v=i>=0&&i<L.length?L[i]:0;bs[k].style.transform="scaleY("+Math.max(.06,v*E[k]).toFixed(3)+")";}};`;
        const js =
          b.js +
          `const L=${JSON.stringify(L)};${draw}draw(0);const st={t:0};tl.fromTo(st,{t:0},{t:${c.duration},duration:${c.duration},ease:"none",onUpdate:()=>draw(st.t)},0);
tl.fromTo("${S} .prog i",{scaleX:0},{scaleX:1,duration:${c.duration},ease:"none"},0);
tl.fromTo("${S} .top",{opacity:0,y:${-20 * u}},{opacity:1,y:0,duration:.6,ease:"expo.out"},.05);` +
          wordIn(S, 'h2', 0.15) +
          has(`${S} .art`, `tl.fromTo("${S} .art",{scale:.6,opacity:0},{scale:1,opacity:1,duration:.7,ease:"back.out(1.6)"},.25);`) +
          `tl.fromTo("${S} .lt",{x:${-40 * u},opacity:0},{x:0,opacity:1,duration:.7,ease:"expo.out"},.35);`;
        return { markup, css, js };
      },
    },
  ];
}
