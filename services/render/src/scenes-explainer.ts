import { existsSync, readFileSync } from 'node:fs';
import type { SceneCtx, SceneDef } from './scenes.ts';

/**
 * Explainer and product-walkthrough scenes: the grammar of a good feature
 * video. Real UI with a camera that travels between the parts that matter,
 * a highlight drawn around each one and a caption chip naming it; plus the
 * diagrams that explain rules (a ladder of levels, a worked example, a flow,
 * a tree, a who-does-what matrix, a recap) and rebuilt UI for promos (a form
 * filling itself, an option being picked).
 */

export interface Kit {
  frame: (c: SceneCtx) => { u: number; vertical: boolean; pad: { t: number; r: number; b: number; l: number }; S: string };
  bg: (c: SceneCtx, mode?: 'dark' | 'brand' | 'light') => { markup: string; css: string; js: string };
  words: (text: unknown, cls?: string) => string;
  fit: (text: unknown, u: number, steps: [number, number][], min: number) => number;
  img: (src: unknown, c: SceneCtx) => string;
  headCss: (S: string) => string;
  has: (sel: string, code: string) => string;
  wordIn: (S: string, sel: string, at: number, cls?: string) => string;
  list: (v: unknown) => string[];
  esc: (s: unknown) => string;
  readableOnDark: (hex: string, ground?: string) => string;
}

export const MONO = `ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace`;

/** Pixel size of a PNG or JPEG, read from its header. */
export function imageSize(file: string): { w: number; h: number } | null {
  try {
    const b = readFileSync(file);
    if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch {}
  return null;
}

/** Where a scene's image field points on disk (before it's copied into the project). */
export function srcPath(src: unknown, c: SceneCtx): string {
  const s = String(src ?? '').trim();
  return s.startsWith('/') ? s : `${c.assetsDir ?? ''}/${s}`;
}

/** `*x*` → accent, `+x+` → positive (green), `~x~` → muted. Escapes everything else. */
export const rich = (esc: (s: unknown) => string, s: unknown) =>
  esc(s)
    .replace(/\*([^*]+)\*/g, '<b class="acc">$1</b>')
    .replace(/\+([^+]+)\+/g, '<b class="pos">$1</b>')
    .replace(/~([^~]+)~/g, '<span class="mut">$1</span>');

/** "a — b — c" → parts (also accepts " | "). */
const parts = (line: string) => line.split(/\s+[—|]\s+|\s+-\s+/).map((x) => x.trim());

export interface WalkStep {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  text: string;
  click: boolean;
  zoom?: number;
}

/** "x,y,w,h | LABEL | caption | click" — box as 0–1 fractions of the screenshot. */
export function parseSteps(v: unknown, list: (v: unknown) => string[]): WalkStep[] {
  const out: WalkStep[] = [];
  for (const line of list(v)) {
    const seg = line.split('|').map((s) => s.trim());
    const nums = (seg[0] ?? '').split(/[ ,]+/).map(Number);
    if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) continue;
    const [x, y, w, h] = nums.map((n) => Math.min(Math.max(n, 0), 1));
    const flags = seg.slice(3).join(' ').toLowerCase();
    const z = /zoom\s*=?\s*([\d.]+)/.exec(flags);
    out.push({ x, y, w: Math.max(w, 0.01), h: Math.max(h, 0.01), label: seg[1] ?? '', text: seg[2] ?? '', click: /click/.test(flags), zoom: z ? Number(z[1]) : undefined });
  }
  return out.slice(0, 6);
}

const cursorSvg = (u: number) => `<div class="cursor"><svg viewBox="0 0 24 24" width="${Math.round(46 * u)}" height="${Math.round(46 * u)}"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><i class="ripple"></i></div>`;
const cursorCss = (S: string, u: number) => `${S} .cursor{position:absolute;left:0;top:0;opacity:0;z-index:20;filter:drop-shadow(0 6px 10px rgba(0,0,0,.4))}
${S} .ripple{position:absolute;left:${Math.round(-28 * u)}px;top:${Math.round(-28 * u)}px;width:${Math.round(60 * u)}px;height:${Math.round(60 * u)}px;border-radius:50%;border:${Math.max(2, Math.round(4 * u))}px solid var(--brand-primary);opacity:0}`;
const clickJs = (S: string, at: number) => `tl.to("${S} .cursor svg",{scale:.8,duration:.09,yoyo:true,repeat:1,ease:"power2.out",transformOrigin:"10% 10%"},${at.toFixed(2)});
tl.fromTo("${S} .ripple",{scale:.3,opacity:.9},{scale:1.8,opacity:0,duration:.6,ease:"expo.out"},${(at + 0.03).toFixed(2)});`;

export function explainerScenes(k: Kit): SceneDef[] {
  const { frame, bg, words, fit, img, headCss, has, wordIn, list, esc, readableOnDark } = k;
  const R = (s: unknown) => rich(esc, s);
  /** Diagrams sit on a big landscape frame with little else in it: run their type larger there. */
  const big = (c: SceneCtx) => {
    const fr = frame(c);
    return { ...fr, u: fr.u * (c.width > c.height * 1.2 ? 1.3 : 1.08) };
  };
  /** Mono kicker + heading used by every diagram scene. */
  const head = (f: Record<string, any>, c: SceneCtx, size: number) => `${f.kicker ? `<div class="kick">${esc(f.kicker)}</div>` : ''}${f.title ? `<h2 class="ttl" style="font-size:${size}px">${words(f.title)}</h2>` : ''}`;
  const headStyles = (S: string, u: number, accent: string) => `${S} .kick{font:600 ${Math.round(21 * u)}px/1 ${MONO};letter-spacing:.2em;text-transform:uppercase;color:${accent};margin-bottom:${Math.round(18 * u)}px}
${S} .ttl{margin-bottom:${Math.round(40 * u)}px;max-width:34ch}
${S} .pos{color:#34d399;font-weight:700}${S} .mut{opacity:.55}${S} b.acc{font-weight:700}`;
  const headJs = (S: string) => has(`${S} .kick`, `tl.fromTo("${S} .kick",{opacity:0,x:-14},{opacity:1,x:0,duration:.6,ease:"expo.out"},.05);`) + wordIn(S, '.ttl', 0.12);
  const accentFor = (c: SceneCtx, mode: 'dark' | 'light') => (mode === 'dark' ? readableOnDark(c.brand.colors.primary) : 'var(--brand-primary)');
  const modeOf = (f: Record<string, any>): 'dark' | 'light' => (String(f.theme ?? '').toLowerCase() === 'light' ? 'light' : 'dark');
  const box = (S: string, mode: 'dark' | 'light', u: number) =>
    mode === 'dark'
      ? `${S} .card{box-sizing:border-box;background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.05));border:1px solid rgba(255,255,255,.14);border-radius:${Math.round(16 * u)}px;box-shadow:0 ${Math.round(20 * u)}px ${Math.round(50 * u)}px -${Math.round(24 * u)}px rgba(0,0,0,.6)}`
      : `${S} .card{box-sizing:border-box;background:#fff;border:1px solid rgba(15,23,42,.09);border-radius:${Math.round(16 * u)}px;box-shadow:0 ${Math.round(18 * u)}px ${Math.round(40 * u)}px -${Math.round(22 * u)}px rgba(15,23,42,.25)}`;

  return [
    {
      id: 'walkthrough',
      label: 'UI walkthrough: camera + highlights + caption chips',
      use: 'The core of a feature video. One real screenshot; the camera starts on the whole screen, then travels to 1–4 regions in turn. Each region gets a drawn highlight (the rest dims slightly) and a caption chip at the bottom: a short MONO LABEL plus one line with *accented* values. Optional cursor click. Boxes come from screens.json `marks` when available — never guess a box you can read.',
      minSeconds: 4,
      fields: [
        { id: 'image', type: 'image', label: 'Screenshot' },
        { id: 'kicker', type: 'text', label: 'Kicker (who / where)', optional: true, max: 40, help: 'e.g. "TEAM ADMIN · BILLING"' },
        { id: 'steps', type: 'list', label: 'Steps', help: 'One per line: "x,y,w,h | LABEL | caption with *value* | click" — x,y,w,h are 0–1 fractions of the screenshot. 1–4 steps.' },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, pad, S } = frame(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const dim = imageSize(srcPath(f.image, c)) ?? { w: 1600, h: 1000 };
        const steps = parseSteps(f.steps, list);
        const kickH = f.kicker ? Math.round(46 * u) : 0;
        const chipH = steps.some((s) => s.text || s.label) ? Math.round(112 * u) : 0;
        const VX = pad.l;
        const VY = pad.t + kickH;
        const VW = c.width - pad.l - pad.r;
        const VH = c.height - VY - pad.b - chipH;
        const { w: iw, h: ih } = dim;
        // Overview: the whole screen when it fits, else full width from the top (tall pages).
        const tall = ih / iw > (VH / VW) * 1.9;
        const s0 = tall ? VW / iw : Math.min(VW / iw, VH / ih);
        const WW = Math.round(Math.min(VW, iw * s0));
        const WH = Math.round(Math.min(VH, ih * s0));
        const WX = Math.round(VX + (VW - WW) / 2);
        const WY = Math.round(VY + (VH - WH) / 2);
        const clampT = (t: number, view: number, size: number) => (size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, t)));
        const o = { x: clampT(0, WW, iw * s0), y: tall ? 0 : clampT(0, WH, ih * s0), s: s0 };
        const cams = steps.map((st) => {
          const bw = st.w * iw;
          const bh = st.h * ih;
          // Fill ~2/3 of the window with the region, but keep context around small targets.
          let s = Math.min((WW * 0.66) / bw, (WH * 0.56) / bh, s0 * 2.1);
          s = Math.max(s, s0 * 1.08);
          if (st.zoom) s = s0 * Math.min(Math.max(st.zoom, 1), 3);
          const cx = (st.x + st.w / 2) * iw;
          const cy = (st.y + st.h / 2) * ih;
          const x = clampT(WW / 2 - cx * s, WW, iw * s);
          const y = clampT(WH / 2 - cy * s, WH, ih * s);
          const p = Math.round(10 * u);
          return { x, y, s, hx: x + st.x * iw * s - p, hy: y + st.y * ih * s - p, hw: bw * s + 2 * p, hh: bh * s + 2 * p };
        });
        const lead = 0.9;
        const per = steps.length ? Math.max(1.6, (c.duration - lead - 0.3) / steps.length) : 0;
        const radius = Math.round(14 * u);
        let js =
          b.js +
          has(`${S} .kick`, `tl.fromTo("${S} .kick",{opacity:0,x:-14},{opacity:1,x:0,duration:.6,ease:"expo.out"},.1);`) +
          `tl.set("${S} .img",{x:${o.x.toFixed(1)},y:${o.y.toFixed(1)},scale:${o.s.toFixed(4)},transformOrigin:"0 0"},0);
tl.fromTo("${S} .win",{y:${Math.round(60 * u)},opacity:0,scale:.97},{y:0,opacity:1,scale:1,duration:.9,ease:"expo.out"},.05);
tl.fromTo("${S} .win",{rotation:0},{rotation:.001,duration:${c.duration},ease:"none"},0);`;
        steps.forEach((st, i) => {
          const cam = cams[i];
          const t0 = lead + i * per;
          const move = Math.min(1.15, per * 0.42);
          js += `tl.to("${S} .img",{x:${cam.x.toFixed(1)},y:${cam.y.toFixed(1)},scale:${cam.s.toFixed(4)},duration:${move.toFixed(2)},ease:"power3.inOut"},${t0.toFixed(2)});`;
          const hlAt = t0 + move * 0.75;
          if (i === 0) js += `tl.set("${S} .hl",{left:${cam.hx.toFixed(1)},top:${cam.hy.toFixed(1)},width:${cam.hw.toFixed(1)},height:${cam.hh.toFixed(1)}},0);tl.fromTo("${S} .hl",{opacity:0,scale:1.12},{opacity:1,scale:1,duration:.5,ease:"power3.out"},${hlAt.toFixed(2)});`;
          else js += `tl.to("${S} .hl",{opacity:0,duration:.2},${t0.toFixed(2)});tl.set("${S} .hl",{left:${cam.hx.toFixed(1)},top:${cam.hy.toFixed(1)},width:${cam.hw.toFixed(1)},height:${cam.hh.toFixed(1)},scale:1.12},${(t0 + 0.21).toFixed(2)});tl.to("${S} .hl",{opacity:1,scale:1,duration:.5,ease:"power3.out"},${hlAt.toFixed(2)});`;
          if (i > 0) js += has(`${S} .chip.c${i - 1}`, `tl.to("${S} .chip.c${i - 1}",{opacity:0,y:-${Math.round(10 * u)},duration:.25,ease:"power2.in"},${t0.toFixed(2)});`);
          js += has(`${S} .chip.c${i}`, `tl.fromTo("${S} .chip.c${i}",{opacity:0,y:${Math.round(16 * u)}},{opacity:1,y:0,duration:.55,ease:"expo.out"},${(hlAt + 0.1).toFixed(2)});`);
          if (st.click) {
            const tx = WX + cam.hx + cam.hw / 2;
            const ty = WY + cam.hy + cam.hh / 2;
            js += `tl.to("${S} .cursor",{x:${tx.toFixed(1)},y:${ty.toFixed(1)},opacity:1,duration:.8,ease:"power3.inOut"},${(hlAt - 0.2).toFixed(2)});` + clickJs(S, hlAt + 0.65);
          }
        });
        const anyClick = steps.some((s) => s.click);
        const lightShot = mode === 'dark';
        return {
          markup:
            b.markup +
            `${f.kicker ? `<div class="kick" style="left:${WX}px;top:${pad.t}px">${esc(f.kicker)}</div>` : ''}
<div class="win" style="left:${WX}px;top:${WY}px;width:${WW}px;height:${WH}px"><div class="img" style="width:${iw}px;height:${ih}px"><img src="${img(f.image, c)}" alt=""></div><div class="hl"></div></div>
<div class="chips" style="left:${pad.l}px;right:${pad.r}px;top:${WY + WH + Math.round(30 * u)}px">${steps.map((st, i) => (st.text || st.label ? `<div class="chip c${i}">${st.label ? `<span class="lab">${esc(st.label)}</span>` : ''}${st.text ? `<span class="txt">${R(st.text)}</span>` : ''}</div>` : '')).join('')}</div>
${anyClick ? `<div class="cursor-wrap" style="position:absolute;inset:0">${cursorSvg(u)}</div>` : ''}`,
          css:
            b.css +
            headCss(S) +
            cursorCss(S, u) +
            `${S} .kick{position:absolute;font:600 ${Math.round(20 * u)}px/1 ${MONO};letter-spacing:.2em;text-transform:uppercase;color:${accent}}
${S} .win{position:absolute;border-radius:${radius}px;overflow:hidden;background:${lightShot ? '#fff' : '#0d0f14'};box-shadow:0 ${Math.round(40 * u)}px ${Math.round(90 * u)}px -${Math.round(30 * u)}px rgba(0,0,0,.65),0 0 0 1px ${mode === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.1)'}}
${S} .img{position:absolute;left:0;top:0;will-change:transform}${S} .img img{display:block;width:100%;height:100%}
${S} .hl{position:absolute;opacity:0;border-radius:${Math.round(10 * u)}px;border:${Math.max(2, Math.round(3.2 * u))}px solid ${accent};box-shadow:0 0 0 ${Math.round(5000 * u)}px rgba(8,10,14,.28),0 0 ${Math.round(28 * u)}px color-mix(in srgb,${accent} 55%,transparent)}
${S} .chips{position:absolute;height:${Math.round(70 * u)}px}
${S} .chip{position:absolute;left:0;right:0;margin:0 auto;width:fit-content;top:0;opacity:0;display:flex;align-items:center;gap:${Math.round(16 * u)}px;white-space:nowrap;max-width:100%;padding:${Math.round(14 * u)}px ${Math.round(24 * u)}px;border-radius:${Math.round(12 * u)}px;background:${mode === 'dark' ? 'rgba(18,20,26,.92)' : '#fff'};border:1px solid color-mix(in srgb,${accent} 55%,transparent);box-shadow:0 ${Math.round(14 * u)}px ${Math.round(30 * u)}px -${Math.round(16 * u)}px rgba(0,0,0,.5)}
${S} .chip .lab{font:600 ${Math.round(19 * u)}px/1 ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${accent}}
${S} .chip .txt{font:500 ${Math.round(29 * u)}px/1.2 var(--font-body);overflow:hidden;text-overflow:ellipsis}
${S} .pos{color:#34d399;font-weight:700}${S} .mut{opacity:.55}`,
          js,
        };
      },
    },
    {
      id: 'recording',
      label: 'Real click-through (recorded) with auto-zoom',
      use: 'A real recording of someone using the product (from app-capture `record` with actions). Plays inside a clean window; the camera zooms in on each click automatically (from the recording’s .json timeline) and eases back out for scrolls. Add timed caption chips. Scene duration must not exceed the clip length minus `from`.',
      minSeconds: 3,
      fields: [
        { id: 'video', type: 'image', label: 'Recording (.mp4)' },
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'from', type: 'number', label: 'Start at (s into the clip)', optional: true },
        { id: 'steps', type: 'list', label: 'Caption chips', optional: true, help: 'One per line: "seconds | LABEL | caption with *value*" (seconds from the start of this scene)' },
        { id: 'zoom', type: 'number', label: 'Zoom on clicks (1–2.4, 1 = off)', optional: true },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, pad, S } = frame(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const src = srcPath(f.video, c);
        const from = Math.max(0, Number(f.from) || 0);
        let meta: { viewport?: { width: number; height: number }; actions?: { at: number; do: string; x?: number; y?: number }[] } = {};
        const side = src.replace(/\.(mp4|webm|mov)$/i, '.json');
        try {
          if (existsSync(side)) meta = JSON.parse(readFileSync(side, 'utf8'));
        } catch {}
        const ar = meta.viewport ? meta.viewport.width / meta.viewport.height : 1.6;
        const chips = list(f.steps)
          .map((l) => l.split('|').map((x) => x.trim()))
          .map(([t, label, text]) => ({ t: Number(t) || 0, label: label ?? '', text: text ?? '' }))
          .filter((x) => x.label || x.text)
          .slice(0, 8);
        const kickH = f.kicker ? Math.round(46 * u) : 0;
        const chipH = chips.length ? Math.round(112 * u) : 0;
        const VW = c.width - pad.l - pad.r;
        const VH = c.height - pad.t - kickH - pad.b - chipH;
        const WW = Math.round(Math.min(VW, VH * ar));
        const WH = Math.round(WW / ar);
        const WX = Math.round(pad.l + (VW - WW) / 2);
        const WY = Math.round(pad.t + kickH + (VH - WH) / 2);
        const Z = Math.min(Math.max(Number(f.zoom ?? 1.75), 1), 2.4);
        // Camera keyframes from the recorded actions: anticipate each click, pan between near ones, ease out for scrolls.
        const cam = (x: number, y: number, z: number) => {
          const cl = (t: number, size: number) => Math.min(0, Math.max(size - size * z, t));
          return { x: cl(WW / 2 - x * WW * z, WW), y: cl(WH / 2 - y * WH * z, WH), s: z };
        };
        let js = b.js;
        if (Z > 1.01) {
          let zoomed = false;
          for (const a of meta.actions ?? []) {
            const t = a.at - from;
            if (t < -0.5 || t > c.duration - 0.8) continue;
            if ((a.do === 'click' || a.do === 'move') && a.x !== undefined && a.y !== undefined) {
              const k = cam(a.x, a.y, Z);
              js += `tl.to("${S} .cam",{x:${k.x.toFixed(1)},y:${k.y.toFixed(1)},scale:${Z},duration:${zoomed ? 0.7 : 0.9},ease:"power3.inOut"},${Math.max(0.1, t + 0.25).toFixed(2)});`;
              zoomed = true;
            } else if (a.do === 'scroll' && zoomed) {
              js += `tl.to("${S} .cam",{x:0,y:0,scale:1,duration:.8,ease:"power3.inOut"},${Math.max(0.1, t).toFixed(2)});`;
              zoomed = false;
            }
          }
          if (zoomed) js += `tl.to("${S} .cam",{x:0,y:0,scale:1,duration:.9,ease:"power3.inOut"},${Math.max(0.2, c.duration - 1.3).toFixed(2)});`;
        }
        chips.forEach((ch, i) => {
          const next = chips[i + 1]?.t ?? c.duration;
          js += `tl.fromTo("${S} .chip.c${i}",{opacity:0,y:${Math.round(16 * u)}},{opacity:1,y:0,duration:.5,ease:"expo.out"},${Math.max(0.2, ch.t).toFixed(2)});`;
          if (chips[i + 1]) js += `tl.to("${S} .chip.c${i}",{opacity:0,y:-${Math.round(10 * u)},duration:.25,ease:"power2.in"},${Math.max(0.3, next - 0.05).toFixed(2)});`;
        });
        return {
          markup:
            b.markup +
            `${f.kicker ? `<div class="kick" style="left:${WX}px;top:${pad.t}px">${esc(f.kicker)}</div>` : ''}
<div class="win" style="left:${WX}px;top:${WY}px;width:${WW}px;height:${WH}px"><div class="cam" style="width:${WW}px;height:${WH}px"><video id="${c.id}-rec" src="${img(f.video, c)}" muted playsinline data-start="0" data-duration="${c.duration}" data-media-start="${from}" data-has-audio="false" data-volume="0" data-track-index="0" style="width:100%;height:100%;object-fit:cover;display:block"></video></div></div>
<div class="chips" style="left:${pad.l}px;right:${pad.r}px;top:${WY + WH + Math.round(30 * u)}px">${chips.map((ch, i) => `<div class="chip c${i}">${ch.label ? `<span class="lab">${esc(ch.label)}</span>` : ''}${ch.text ? `<span class="txt">${R(ch.text)}</span>` : ''}</div>`).join('')}</div>`,
          css:
            b.css +
            `${S} .kick{position:absolute;font:600 ${Math.round(20 * u)}px/1 ${MONO};letter-spacing:.2em;text-transform:uppercase;color:${accent}}
${S} .win{position:absolute;border-radius:${Math.round(14 * u)}px;overflow:hidden;background:#000;box-shadow:0 ${Math.round(40 * u)}px ${Math.round(90 * u)}px -${Math.round(30 * u)}px rgba(0,0,0,.65),0 0 0 1px ${mode === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.1)'}}
${S} .cam{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
${S} .chips{position:absolute;height:${Math.round(70 * u)}px}
${S} .chip{position:absolute;left:0;right:0;margin:0 auto;width:fit-content;top:0;opacity:0;display:flex;align-items:center;gap:${Math.round(16 * u)}px;white-space:nowrap;max-width:100%;padding:${Math.round(14 * u)}px ${Math.round(24 * u)}px;border-radius:${Math.round(12 * u)}px;background:${mode === 'dark' ? 'rgba(18,20,26,.92)' : '#fff'};border:1px solid color-mix(in srgb,${accent} 55%,transparent)}
${S} .chip .lab{font:600 ${Math.round(19 * u)}px/1 ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${accent}}
${S} .chip .txt{font:500 ${Math.round(29 * u)}px/1.2 var(--font-body)}${S} .pos{color:#34d399;font-weight:700}${S} b.acc{font-weight:700}`,
          js:
            js +
            has(`${S} .kick`, `tl.fromTo("${S} .kick",{opacity:0,x:-14},{opacity:1,x:0,duration:.6,ease:"expo.out"},.1);`) +
            `tl.fromTo("${S} .win",{y:${Math.round(50 * u)},opacity:0,scale:.97},{y:0,opacity:1,scale:1,duration:.8,ease:"expo.out"},0);`,
        };
      },
    },
    {
      id: 'chaos',
      label: 'The messy before → alert',
      use: 'Promo opener for the pain: 3–5 small rebuilt tool windows (a spreadsheet, a scraper, a sender, an inbox) pile up and jitter, then a full-width alert slams across (red) — the moment it breaks. Real pain from the brief only.',
      minSeconds: 3.5,
      fields: [
        { id: 'windows', type: 'list', label: 'Windows', help: 'One per line: "Title — row; row; row" (3–5 windows, ≤ 3 short rows)' },
        { id: 'alert', type: 'text', label: 'Alert', max: 60, help: '"Your account has been restricted — All campaigns have stopped"' },
        { id: 'theme', type: 'text', label: 'Ground (light/dark)', optional: true },
      ],
      build: (f, c) => {
        const { u, S } = big(c);
        const mode = String(f.theme ?? 'light') === 'dark' ? 'dark' : 'light';
        const b = bg(c, mode);
        const wins = list(f.windows).slice(0, 5).map((l) => {
          const [t, rows] = parts(l);
          return { t, rows: String(rows ?? '').split(';').map((x) => x.trim()).filter(Boolean).slice(0, 3) };
        });
        const [at, asub] = parts(String(f.alert ?? ''));
        // Deterministic scatter: a loose pile around the centre.
        const vert = c.height > c.width;
        const spots = vert
          ? [[0.06, 0.12, -3], [0.3, 0.27, 2.5], [0.08, 0.45, -1.5], [0.32, 0.6, 3], [0.1, 0.74, 2]]
          : [[0.05, 0.1, -3], [0.52, 0.16, 2.5], [0.1, 0.5, -1.5], [0.56, 0.58, 3], [0.3, 0.33, 2]];
        const ww = Math.round(c.width * (vert ? 0.62 : 0.4));
        const slam = Math.max(2, c.duration * 0.55);
        return {
          markup:
            b.markup +
            `<div class="pile">${wins
              .map(
                (w, i) =>
                  `<div class="mw card m${i}" style="left:${Math.round(spots[i][0] * c.width)}px;top:${Math.round(spots[i][1] * c.height)}px;width:${ww}px;transform:rotate(${spots[i][2]}deg)"><div class="tb"><i></i><i></i><i></i><b>${esc(w.t)}</b></div>${w.rows.map((r) => `<div class="rw">${R(r)}</div>`).join('')}</div>`,
              )
              .join('')}</div><div class="alert"><svg viewBox="0 0 24 24" width="${Math.round(54 * u)}" height="${Math.round(54 * u)}"><rect x="5" y="10" width="14" height="11" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#fff" stroke-width="2"/></svg><div><b>${esc(at)}</b>${asub ? `<small>${esc(asub)}</small>` : ''}</div></div>`,
          css:
            b.css +
            box(S, mode, u) +
            `${S} .pile{position:absolute;inset:0}${S} .mw{position:absolute;padding-bottom:${Math.round(10 * u)}px;overflow:hidden}
${S} .tb{display:flex;align-items:center;gap:${Math.round(7 * u)}px;padding:${Math.round(12 * u)}px ${Math.round(16 * u)}px;border-bottom:1px solid ${mode === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.07)'};font-size:${Math.round(25 * u)}px}
${S} .tb i{width:${Math.round(11 * u)}px;height:${Math.round(11 * u)}px;border-radius:50%;background:${mode === 'dark' ? '#3a3e4a' : '#d4d8df'}}${S} .tb b{margin-left:${Math.round(8 * u)}px;font-weight:600;opacity:.75}
${S} .rw{padding:${Math.round(14 * u)}px ${Math.round(22 * u)}px;font:500 ${Math.round(28 * u)}px/1.25 ${MONO};opacity:.8;border-bottom:1px solid ${mode === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)'}}
${S} .alert{position:absolute;left:0;right:0;top:${Math.round(c.height * 0.4)}px;display:flex;align-items:center;justify-content:center;gap:${Math.round(26 * u)}px;padding:${Math.round(40 * u)}px;background:#c0392b;color:#fff;box-shadow:0 ${Math.round(30 * u)}px ${Math.round(80 * u)}px -${Math.round(20 * u)}px rgba(120,20,10,.6)}
${S} .alert div{display:flex;flex-direction:column;gap:${Math.round(8 * u)}px}${S} .alert b{font:700 ${Math.round(64 * u)}px/1.05 var(--font-display);letter-spacing:-.02em}${S} .alert small{font-size:${Math.round(24 * u)}px;opacity:.85}`,
          js:
            b.js +
            `tl.fromTo("${S} .mw",{opacity:0,y:${Math.round(60 * u)},scale:.9},{opacity:1,y:0,scale:1,duration:.55,ease:"back.out(1.6)",stagger:.22},.05);
tl.to("${S} .mw",{x:"+=${Math.round(6 * u)}",duration:.07,repeat:${Math.max(4, Math.round((slam - 1.4) / 0.07))},yoyo:true,ease:"none",stagger:{each:.03,from:"random"}},1.3);
tl.to("${S} .mw",{opacity:.35,filter:"blur(3px)",duration:.3},${(slam - 0.05).toFixed(2)});
tl.fromTo("${S} .alert",{scaleY:0,opacity:0},{scaleY:1,opacity:1,duration:.32,ease:"expo.out"},${slam.toFixed(2)});
tl.fromTo("${S} .alert div,${S} .alert svg",{x:-${Math.round(30 * u)},opacity:0},{x:0,opacity:1,duration:.45,ease:"expo.out",stagger:.06},${(slam + 0.12).toFixed(2)});
tl.fromTo("${S} .pile",{x:0},{x:${Math.round(8 * u)},duration:.05,repeat:5,yoyo:true,ease:"none"},${slam.toFixed(2)});`,
        };
      },
    },
    {
      id: 'rail',
      label: 'Checks rail: an action passes (or is stopped)',
      use: 'A safety or approval engine in motion: 3–5 checkpoint cards sit on a rail; one action (a pill like "Expense $412 → Sam") travels along it and each checkpoint ticks green. Optionally one checkpoint stops it (red, "Stopped · no retry"). Great for limits, approvals, guardrails, compliance.',
      minSeconds: 4.5,
      fields: [
        { id: 'title', type: 'text', label: 'Headline', optional: true, max: 50, help: 'Wrap the key words in *stars*' },
        { id: 'checks', type: 'list', label: 'Checkpoints', help: 'One per line: "Name — big value — small line" (3–5)' },
        { id: 'token', type: 'text', label: 'The action', max: 40 },
        { id: 'stop', type: 'number', label: 'Stopped at (1-based, 0 = passes)', optional: true },
        { id: 'stopText', type: 'text', label: 'Stop label', optional: true, max: 30 },
        { id: 'theme', type: 'text', label: 'Ground (light/dark)', optional: true },
      ],
      build: (f, c) => {
        const { u, pad, S } = big(c);
        const mode = String(f.theme ?? 'light') === 'dark' ? 'dark' : 'light';
        const b = bg(c, mode);
        const checks = list(f.checks).slice(0, 5).map(parts);
        const n = Math.max(checks.length, 1);
        const stop = Math.min(Math.max(Number(f.stop) || 0, 0), n);
        const W = c.width - pad.l - pad.r;
        const gap = Math.round(22 * u);
        const cw = (W - gap * (n - 1)) / n;
        const tSize = fit(f.title, u, [[30, 70], [50, 58]], 50);
        const headH = f.title ? tSize * 1.3 + 50 * u : 0;
        const ch = Math.round(Math.min(430 * u, (c.height - pad.t - pad.b - headH) * 0.56));
        const groupH = headH + ch + 70 * u + 90 * u;
        const gTop = pad.t + Math.max(0, (c.height - pad.t - pad.b - groupH) / 2);
        const top = gTop + headH;
        const railY = top + ch + Math.round(70 * u);
        const cx = (i: number) => pad.l + i * (cw + gap) + cw / 2;
        const start = 1.3;
        const per = Math.min(0.9, (c.duration - start - 1.2) / (stop || n));
        let js = b.js + `tl.set("${S} .tick",{scale:0},0);` + wordIn(S, '.ttl', 0.05) + `tl.fromTo("${S} .ck",{opacity:0,y:${Math.round(30 * u)}},{opacity:1,y:0,duration:.6,ease:"expo.out",stagger:.1},.3);tl.fromTo("${S} .rl",{scaleX:0},{scaleX:1,duration:.8,ease:"power3.inOut"},.5);tl.fromTo("${S} .stem",{scaleY:0},{scaleY:1,duration:.4,ease:"power3.out",stagger:.08},.9);`;
        js += `tl.fromTo("${S} .tok",{x:${pad.l - 40 * u},opacity:0},{x:${pad.l},opacity:1,duration:.25,ease:"power2.out"},${(start - 0.3).toFixed(2)});`;
        const last = stop || n;
        // Keep the pill inside the frame: estimate its width from the text.
        const pillW = String(f.token ?? '').replace(/[*+~]/g, '').length * 30 * u * 0.56 + 48 * u;
        const px = (x: number) => Math.min(x, c.width - pad.r - pillW);
        for (let i = 0; i < last; i++) {
          const t = start + i * per;
          js += `tl.to("${S} .tok",{x:${px(cx(i) - 120 * u).toFixed(1)},duration:${(per * 0.6).toFixed(2)},ease:"power2.inOut"},${t.toFixed(2)});`;
          if (stop && i === stop - 1) {
            js += `tl.to("${S} .c${i} .ring.bad",{opacity:1,duration:.25},${(t + per * 0.6).toFixed(2)});tl.to("${S} .tok",{rotation:-3,duration:.06,repeat:5,yoyo:true,ease:"none"},${(t + per * 0.6).toFixed(2)});tl.to("${S} .tok",{backgroundColor:"#fee2e2",borderColor:"#ef4444",color:"#b91c1c",duration:.2},${(t + per * 0.6).toFixed(2)});tl.fromTo("${S} .stopx",{opacity:0,y:${Math.round(10 * u)}},{opacity:1,y:0,duration:.4,ease:"expo.out"},${(t + per * 0.7).toFixed(2)});`;
          } else {
            js += `tl.to("${S} .c${i} .ring.ok",{opacity:1,duration:.25},${(t + per * 0.6).toFixed(2)});tl.fromTo("${S} .c${i} .tick",{scale:0},{scale:1,duration:.35,ease:"back.out(3)"},${(t + per * 0.6).toFixed(2)});`;
          }
        }
        if (!stop) js += `tl.to("${S} .tok",{x:${px(c.width - pad.r - 220 * u).toFixed(1)},duration:.6,ease:"power2.in"},${(start + n * per).toFixed(2)});tl.to("${S} .tok",{backgroundColor:"#dcfce7",borderColor:"#22c55e",color:"#15803d",duration:.2},${(start + n * per + 0.5).toFixed(2)});`;
        return {
          markup:
            b.markup +
            `${f.title ? `<h2 class="ttl" style="left:${pad.l}px;top:${gTop}px;font-size:${tSize}px">${words(f.title)}</h2>` : ''}
${checks.map(([name, val, sub], i) => `<div class="ck card c${i}" style="left:${pad.l + i * (cw + gap)}px;top:${top}px;width:${cw}px;height:${ch}px"><i class="ring ok"></i><i class="ring bad"></i><span class="nm">${esc(name)}</span><b>${R(val ?? '')}</b>${sub ? `<small>${R(sub)}</small>` : ''}<span class="tick"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.5 3.5L17.5 8.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div><i class="stem" style="left:${cx(i)}px;top:${top + ch}px;height:${railY - top - ch}px"></i>`).join('')}
<i class="rl" style="left:${pad.l}px;right:${pad.r}px;top:${railY}px"></i>
<div class="tok" style="top:${railY - 30 * u}px">${R(f.token ?? '')}</div>
${stop ? `<div class="stopx" style="left:${cx(stop - 1) - 160 * u}px;top:${railY + 50 * u}px">${esc(f.stopText || 'Stopped · no retry')}</div>` : ''}`,
          css:
            b.css +
            headCss(S) +
            box(S, mode, u) +
            `${S} .ttl{position:absolute}
${S} .ck{position:absolute;padding:${Math.round(24 * u)}px;display:flex;flex-direction:column;gap:${Math.round(8 * u)}px}
${S} .nm{font-size:${Math.round(27 * u)}px;opacity:.6}${S} .ck b{font:750 ${Math.round(62 * u)}px/1.05 var(--font-display);letter-spacing:-.02em;margin-top:auto}${S} .ck small{font-size:${Math.round(22 * u)}px;opacity:.55}
${S} .ring{position:absolute;inset:-1px;border-radius:inherit;opacity:0;border:${Math.max(2, Math.round(2.5 * u))}px solid #22c55e}${S} .ring.bad{border-color:#ef4444;background:rgba(239,68,68,.06)}
${S} .tick{position:absolute;right:${Math.round(18 * u)}px;top:${Math.round(18 * u)}px;width:${Math.round(34 * u)}px;height:${Math.round(34 * u)}px;border-radius:50%;background:#22c55e;display:grid;place-items:center}${S} .tick svg{width:70%;height:70%}
${S} .stem{position:absolute;width:${Math.max(2, Math.round(2 * u))}px;background:color-mix(in srgb,var(--brand-primary) 55%,transparent);transform-origin:50% 0}
${S} .rl{position:absolute;height:${Math.max(2, Math.round(3 * u))}px;background:color-mix(in srgb,var(--brand-primary) 70%,transparent);transform-origin:0 50%}
${S} .tok{position:absolute;left:0;opacity:0;padding:${Math.round(14 * u)}px ${Math.round(22 * u)}px;border-radius:${Math.round(14 * u)}px;font:600 ${Math.round(30 * u)}px/1 var(--font-body);background:${mode === 'dark' ? '#1b1e26' : '#fff'};border:${Math.max(2, Math.round(2 * u))}px solid var(--brand-primary);box-shadow:0 ${Math.round(14 * u)}px ${Math.round(30 * u)}px -${Math.round(12 * u)}px rgba(0,0,0,.3);white-space:nowrap}
${S} .stopx{position:absolute;width:${Math.round(320 * u)}px;text-align:center;font:700 ${Math.round(26 * u)}px/1 var(--font-body);color:#dc2626;opacity:0}`,
          js,
        };
      },
    },
    {
      id: 'part',
      label: 'Part card (minimal)',
      use: 'A calm section opener for explainers: "PART 2" in small mono, the part title, a short accent rule. Use it between the parts of a feature video instead of the big chapter card.',
      minSeconds: 2,
      fields: [
        { id: 'label', type: 'text', label: 'Small label', optional: true, max: 30, help: 'e.g. "Part 2"' },
        { id: 'title', type: 'text', label: 'Title', max: 50 },
      ],
      build: (f, c) => {
        const { u, vertical, S } = frame(c);
        const b = bg(c, 'dark');
        const accent = readableOnDark(c.brand.colors.primary);
        const size = fit(f.title, u, vertical ? [[20, 96], [36, 80]] : [[20, 92], [36, 76]], 64);
        return {
          markup: b.markup + `<div class="part"><div class="lbl">${esc(f.label ?? '')}</div><h2 style="font-size:${size}px">${words(f.title)}</h2><i class="rule"></i></div>`,
          css:
            b.css +
            headCss(S) +
            `${S} .part{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${Math.round(120 * u)}px}
${S} .lbl{font:600 ${Math.round(22 * u)}px/1 ${MONO};letter-spacing:.28em;text-transform:uppercase;color:${accent};margin-bottom:${Math.round(22 * u)}px}
${S} h2{font-weight:600;letter-spacing:-.02em}
${S} .rule{display:block;width:${Math.round(72 * u)}px;height:${Math.max(3, Math.round(4 * u))}px;border-radius:9px;background:${accent};margin-top:${Math.round(30 * u)}px}`,
          js:
            b.js +
            `tl.fromTo("${S} .lbl",{opacity:0,letterSpacing:"0.5em"},{opacity:1,letterSpacing:"0.28em",duration:.9,ease:"expo.out"},.05);` +
            wordIn(S, 'h2', 0.18) +
            `tl.fromTo("${S} .rule",{scaleX:0},{scaleX:1,duration:.7,ease:"expo.out"},.55);
tl.fromTo("${S} .part",{scale:1},{scale:1.03,duration:${c.duration},ease:"none"},0);`,
        };
      },
    },
    {
      id: 'ladder',
      label: 'Ladder of levels',
      use: 'Ranked rules or tiers ("the most specific rule wins", plan tiers, priority order). 2–5 rows with a number, title and one line; one row is lit as the answer; a side arrow names the direction.',
      minSeconds: 4,
      fields: [
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'title', type: 'text', label: 'Title', optional: true, max: 50 },
        { id: 'items', type: 'list', label: 'Rows', help: 'One per line: "Title — one short line — optional tag". Top row = highest.' },
        { id: 'highlight', type: 'number', label: 'Lit row (1-based)', optional: true },
        { id: 'arrow', type: 'text', label: 'Arrow label', optional: true, max: 30, help: 'e.g. "Most specific wins"' },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, pad, S } = big(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const rows = list(f.items).slice(0, 5).map(parts);
        const hi = Math.min(Math.max(Number(f.highlight) || 0, 0), rows.length);
        const arrowW = f.arrow && !vertical ? Math.round(240 * u) : 0;
        const rowH = Math.round(Math.min(120, 520 / Math.max(rows.length, 1) + 10) * u);
        const tSize = fit(f.title, u, [[30, 62], [50, 52]], 46);
        const hiAt = Math.max(1.8, c.duration * 0.55);
        return {
          markup:
            b.markup +
            `<div class="wrap" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px">${head(f, c, tSize)}<div class="lad"><div class="rows" style="margin-right:${arrowW + Math.round(30 * u)}px">${rows
              .map(
                ([t, sub, tag], i) =>
                  `<div class="row card r${i}" style="height:${rowH}px"><i class="ring"></i><span class="n">${i + 1}</span><span class="tx"><b>${R(t)}</b>${sub ? `<small>${R(sub)}</small>` : ''}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div>`,
              )
              .join('')}</div>${arrowW ? `<div class="arr" style="width:${arrowW}px"><i class="shaft"></i><i class="head"></i><span>${esc(f.arrow)}</span></div>` : ''}</div></div>`,
          css:
            b.css +
            headCss(S) +
            headStyles(S, u, accent) +
            box(S, mode, u) +
            `${S} .wrap{position:absolute;display:flex;flex-direction:column;justify-content:center}
${S} .lad{position:relative}${S} .rows{display:flex;flex-direction:column;gap:${Math.round(16 * u)}px}
${S} .row{display:flex;align-items:center;gap:${Math.round(26 * u)}px;padding:0 ${Math.round(30 * u)}px;transition:none}
${S} .n{flex:none;width:${Math.round(52 * u)}px;height:${Math.round(52 * u)}px;border-radius:50%;display:grid;place-items:center;font:700 ${Math.round(24 * u)}px/1 var(--font-body);background:color-mix(in srgb,${accent} 22%,transparent);color:${accent}}
${S} .tx{display:flex;flex-direction:column;gap:${Math.round(6 * u)}px;min-width:0;flex:1}${S} .tx b{font:650 ${Math.round(34 * u)}px/1.1 var(--font-display)}${S} .tx small{font-size:${Math.round(21 * u)}px;opacity:.6}
${S} .tag{font:600 ${Math.round(16 * u)}px/1 ${MONO};letter-spacing:.08em;padding:${Math.round(8 * u)}px ${Math.round(12 * u)}px;border-radius:${Math.round(8 * u)}px;background:color-mix(in srgb,${accent} 16%,transparent);color:${accent}}
${S} .row{position:relative}${S} .ring{position:absolute;inset:-1px;border-radius:inherit;opacity:0;pointer-events:none;border:${Math.max(2, Math.round(2.5 * u))}px solid ${accent};background:color-mix(in srgb,${accent} 8%,transparent);box-shadow:0 0 ${Math.round(40 * u)}px -${Math.round(8 * u)}px color-mix(in srgb,${accent} 60%,transparent)}
${S} .arr{position:absolute;right:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:flex-start}
${S} .shaft{position:absolute;left:${Math.round(12 * u)}px;top:${Math.round(18 * u)}px;bottom:0;width:${Math.max(2, Math.round(3 * u))}px;background:${accent};transform-origin:50% 100%}
${S} .head{position:absolute;left:${Math.round(2 * u)}px;top:0;width:0;height:0;border-left:${Math.round(12 * u)}px solid transparent;border-right:${Math.round(12 * u)}px solid transparent;border-bottom:${Math.round(20 * u)}px solid ${accent}}
${S} .arr span{position:absolute;left:${Math.round(40 * u)}px;top:0;font:650 ${Math.round(26 * u)}px/1.15 var(--font-body);color:${accent};max-width:${Math.round(190 * u)}px}`,
          js:
            b.js +
            headJs(S) +
            `tl.fromTo("${S} .row",{opacity:0,x:-${Math.round(30 * u)}},{opacity:1,x:0,duration:.7,ease:"expo.out",stagger:.12},.35);` +
            has(`${S} .shaft`, `tl.fromTo("${S} .shaft",{scaleY:0},{scaleY:1,duration:.9,ease:"power3.inOut"},.6);tl.fromTo("${S} .head,${S} .arr span",{opacity:0,y:${Math.round(14 * u)}},{opacity:1,y:0,duration:.5,ease:"expo.out",stagger:.1},1.3);`) +
            (hi
              ? `tl.to("${S} .row:not(.r${hi - 1})",{opacity:.42,duration:.5},${hiAt.toFixed(2)});tl.to("${S} .r${hi - 1} .ring",{opacity:1,duration:.45,ease:"power2.out"},${hiAt.toFixed(2)});tl.fromTo("${S} .r${hi - 1}",{scale:1},{scale:1.025,duration:.5,ease:"back.out(2)"},${hiAt.toFixed(2)});`
              : ''),
        };
      },
    },
    {
      id: 'table',
      label: 'Worked example table',
      use: 'A small real example with numbers: who / what / which rule / result. 2–5 rows, 2–5 columns. Rows reveal one by one; one row can be lit. Use *x* for the accent value, +x+ for a green (good) value.',
      minSeconds: 4,
      fields: [
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'title', type: 'text', label: 'Title', optional: true, max: 60 },
        { id: 'columns', type: 'text', label: 'Columns', help: '"Person | Where | Rule | Limit"' },
        { id: 'rows', type: 'list', label: 'Rows', help: 'One per line, cells split by " | "' },
        { id: 'highlight', type: 'number', label: 'Lit row (1-based)', optional: true },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, pad, S } = big(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const cols = String(f.columns ?? '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 5);
        const rows = list(f.rows).slice(0, 6).map((r) => r.split('|').map((x) => x.trim()));
        const hi = Math.min(Math.max(Number(f.highlight) || 0, 0), rows.length);
        const tSize = fit(f.title, u, [[30, 60], [60, 50]], 44);
        const hiAt = Math.max(2, c.duration * 0.6);
        return {
          markup:
            b.markup +
            `<div class="wrap" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px">${head(f, c, tSize)}<div class="tbl card"><div class="tr th">${cols.map((h) => `<span>${esc(h)}</span>`).join('')}</div>${rows
              .map((r, i) => `<div class="tr r${i}"><i class="ring"></i>${cols.map((_, j) => `<span>${R(r[j] ?? '')}</span>`).join('')}</div>`)
              .join('')}</div></div>`,
          css:
            b.css +
            headCss(S) +
            headStyles(S, u, accent) +
            box(S, mode, u) +
            `${S} .wrap{position:absolute;display:flex;flex-direction:column;justify-content:center}
${S} .tbl{padding:${Math.round(10 * u)}px ${Math.round(30 * u)}px}
${S} .tr{display:grid;grid-template-columns:${cols.map((_, j) => (j === cols.length - 1 ? '1fr' : j === 0 ? '1.1fr' : '1.4fr')).join(' ')};gap:${Math.round(24 * u)}px;align-items:center;padding:${Math.round(22 * u)}px ${Math.round(10 * u)}px;border-bottom:1px solid ${mode === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.08)'};font-size:${Math.round(28 * u)}px;border-radius:${Math.round(10 * u)}px}
${S} .tr:last-child{border-bottom:0}${S} .tr span:last-child{text-align:right;font-weight:700;font-size:${Math.round(34 * u)}px}
${S} .th{font:600 ${Math.round(16 * u)}px/1 ${MONO}!important;letter-spacing:.16em;text-transform:uppercase;opacity:.55;padding-top:${Math.round(18 * u)}px;padding-bottom:${Math.round(14 * u)}px}${S} .th span:last-child{font-size:inherit;font-weight:600}
${S} .tr{position:relative}${S} .ring{position:absolute;inset:0;border-radius:inherit;opacity:0;background:color-mix(in srgb,${accent} 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,${accent} 60%,transparent)}`,
          js:
            b.js +
            headJs(S) +
            `tl.fromTo("${S} .tbl",{opacity:0,y:${Math.round(30 * u)}},{opacity:1,y:0,duration:.8,ease:"expo.out"},.3);
tl.fromTo("${S} .tr:not(.th)",{opacity:0,y:${Math.round(14 * u)}},{opacity:1,y:0,duration:.6,ease:"expo.out",stagger:.28},.75);` +
            (hi ? `tl.to("${S} .r${hi - 1} .ring",{opacity:1,duration:.45,ease:"power2.out"},${hiAt.toFixed(2)});tl.to("${S} .tr:not(.th):not(.r${hi - 1})",{opacity:.45,duration:.4},${hiAt.toFixed(2)});` : ''),
        };
      },
    },
    {
      id: 'flow',
      label: 'Flow of steps',
      use: 'What happens, in order: 2–5 steps joined by a line that draws itself (click → check → charge → log). Each step: a short title and a tiny line. One step can be lit.',
      minSeconds: 4,
      fields: [
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'title', type: 'text', label: 'Title', optional: true, max: 60 },
        { id: 'steps', type: 'list', label: 'Steps', help: 'One per line: "Title — tiny line"' },
        { id: 'highlight', type: 'number', label: 'Lit step (1-based)', optional: true },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, pad, S } = big(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const steps = list(f.steps).slice(0, 5).map(parts);
        const n = Math.max(steps.length, 1);
        const per = Math.min(0.55, (c.duration - 1.6) / n);
        const tSize = fit(f.title, u, [[30, 62], [60, 50]], 44);
        const hi = Math.min(Math.max(Number(f.highlight) || 0, 0), steps.length);
        return {
          markup:
            b.markup +
            `<div class="wrap" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px">${head(f, c, tSize)}<div class="flow ${vertical ? 'v' : 'h'}"><i class="line"></i>${steps
              .map(([t, sub], i) => `<div class="st s${i}${hi === i + 1 ? ' hi' : ''}"><span class="dot">${i + 1}</span><b>${R(t)}</b>${sub ? `<small>${R(sub)}</small>` : ''}</div>`)
              .join('')}</div></div>`,
          css:
            b.css +
            headCss(S) +
            headStyles(S, u, accent) +
            `${S} .wrap{position:absolute;display:flex;flex-direction:column;justify-content:center}
${S} .flow{position:relative;display:flex}${S} .flow.h{justify-content:space-between}${S} .flow.v{flex-direction:column;gap:${Math.round(56 * u)}px}
${S} .line{position:absolute;background:color-mix(in srgb,${accent} 70%,transparent)}
${S} .flow.h .line{left:${Math.round(40 * u)}px;right:${Math.round(40 * u)}px;top:${Math.round(38 * u)}px;height:${Math.max(2, Math.round(3 * u))}px;transform-origin:0 50%}
${S} .flow.v .line{left:${Math.round(38 * u)}px;top:${Math.round(40 * u)}px;bottom:${Math.round(40 * u)}px;width:${Math.max(2, Math.round(3 * u))}px;transform-origin:50% 0}
${S} .st{position:relative;display:flex;flex-direction:column;align-items:${vertical ? 'flex-start' : 'center'};text-align:${vertical ? 'left' : 'center'};width:${vertical ? 'auto' : `${Math.round(((c.width - pad.l - pad.r) / n) * 0.9)}px`};${vertical ? `padding-left:${Math.round(110 * u)}px;` : ''}}
${S} .dot{width:${Math.round(78 * u)}px;height:${Math.round(78 * u)}px;border-radius:50%;display:grid;place-items:center;font:700 ${Math.round(28 * u)}px/1 var(--font-body);background:${mode === 'dark' ? '#14161c' : '#fff'};border:${Math.max(2, Math.round(3 * u))}px solid ${accent};color:${accent};margin-bottom:${Math.round(22 * u)}px;${vertical ? 'position:absolute;left:0;top:-' + Math.round(8 * u) + 'px;' : ''}}
${S} .st.hi .dot{background:${accent};color:${mode === 'dark' ? '#0b0c10' : '#fff'};box-shadow:0 0 0 ${Math.round(10 * u)}px color-mix(in srgb,${accent} 22%,transparent)}
${S} .st b{font:650 ${Math.round(32 * u)}px/1.15 var(--font-display)}${S} .st small{margin-top:${Math.round(8 * u)}px;font-size:${Math.round(21 * u)}px;opacity:.6;max-width:16ch;line-height:1.3}`,
          js:
            b.js +
            headJs(S) +
            `tl.fromTo("${S} .line",{${vertical ? 'scaleY' : 'scaleX'}:0},{${vertical ? 'scaleY' : 'scaleX'}:1,duration:${(per * n).toFixed(2)},ease:"none"},.6);
tl.fromTo("${S} .st",{opacity:0,y:${Math.round(18 * u)}},{opacity:1,y:0,duration:.55,ease:"expo.out",stagger:${per.toFixed(2)}},.5);
tl.fromTo("${S} .dot",{scale:.4},{scale:1,duration:.5,ease:"back.out(2.2)",stagger:${per.toFixed(2)}},.5);` +
            (hi ? `tl.fromTo("${S} .s${hi - 1} .dot",{scale:1},{scale:1.12,duration:.35,yoyo:true,repeat:1,ease:"power2.out"},${(0.6 + per * n + 0.3).toFixed(2)});` : ''),
        };
      },
    },
    {
      id: 'tree',
      label: 'One record, many views',
      use: 'One shared thing at the top (a record, a plan, a workspace) branching to 2–4 people or cases, each with its own value — "same policy, three people, three limits". Lines draw from the root to each branch.',
      minSeconds: 4,
      fields: [
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'root', type: 'text', label: 'Root', help: '"Title — small line"' },
        { id: 'rootLabel', type: 'text', label: 'Root label', optional: true, max: 30, help: 'Tiny mono label above the root, e.g. "One shared record"' },
        { id: 'image', type: 'image', label: 'Root thumbnail', optional: true },
        { id: 'items', type: 'list', label: 'Branches', help: 'One per line: "Who — *value* — tag"' },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, pad, S } = big(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const kids = list(f.items).slice(0, 4).map(parts);
        const [rt, rsub] = parts(String(f.root ?? ''));
        const W = c.width - pad.l - pad.r;
        const H = c.height - pad.t - pad.b - (f.kicker ? 50 * u : 0);
        const rootW = Math.round(Math.min(W * 0.5, 620 * u));
        const kidW = Math.round(Math.min((W / Math.max(kids.length, 1)) * 0.86, 400 * u));
        const rootY = vertical ? H * 0.12 : H * 0.08;
        const kidY = vertical ? H * 0.58 : H * 0.6;
        const rootH = Math.round(150 * u);
        const xs = kids.map((_, i) => (W / kids.length) * (i + 0.5));
        const paths = xs.map((x) => `M${W / 2},${rootY + rootH} C${W / 2},${(rootY + rootH + kidY) / 2} ${x},${(rootY + rootH + kidY) / 2} ${x},${kidY}`);
        return {
          markup:
            b.markup +
            `${f.kicker ? `<div class="kick" style="position:absolute;left:${pad.l}px;top:${pad.t}px">${esc(f.kicker)}</div>` : ''}<div class="tw" style="left:${pad.l}px;top:${pad.t + (f.kicker ? 50 * u : 0)}px;width:${W}px;height:${H}px">
<svg class="ln" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paths.map((d) => `<path d="${d}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, 2.6 * u)}" stroke-opacity=".75" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`).join('')}</svg>
<div class="root card" style="left:${(W - rootW) / 2}px;top:${rootY}px;width:${rootW}px;height:${rootH}px">${f.image ? `<img src="${img(f.image, c)}" alt="">` : ''}<div>${f.rootLabel ? `<span class="rk">${esc(f.rootLabel)}</span>` : ''}<b>${R(rt)}</b>${rsub ? `<small>${R(rsub)}</small>` : ''}</div></div>
${kids.map(([who, val, tag], i) => `<div class="kid card k${i}" style="left:${xs[i] - kidW / 2}px;top:${kidY}px;width:${kidW}px"><span class="who">${R(who)}</span><b>${R(val ?? '')}</b>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div>`).join('')}</div>`,
          css:
            b.css +
            headCss(S) +
            headStyles(S, u, accent) +
            box(S, mode, u) +
            `${S} .tw{position:absolute}${S} .ln{position:absolute;left:0;top:0;overflow:visible}
${S} .root{position:absolute;display:flex;align-items:center;gap:${Math.round(22 * u)}px;padding:${Math.round(18 * u)}px ${Math.round(24 * u)}px}
${S} .root img{width:${Math.round(150 * u)}px;height:100%;object-fit:cover;border-radius:${Math.round(10 * u)}px}
${S} .root div{display:flex;flex-direction:column;gap:${Math.round(6 * u)}px;min-width:0}${S} .rk{font:600 ${Math.round(15 * u)}px/1 ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${accent}}
${S} .root b{font:700 ${Math.round(36 * u)}px/1.1 var(--font-display)}${S} .root small{font-size:${Math.round(20 * u)}px;opacity:.6}
${S} .kid{position:absolute;display:flex;flex-direction:column;align-items:flex-start;gap:${Math.round(8 * u)}px;padding:${Math.round(22 * u)}px ${Math.round(26 * u)}px}
${S} .who{font-size:${Math.round(22 * u)}px;opacity:.75}${S} .kid b{font:800 ${Math.round(50 * u)}px/1 var(--font-display);letter-spacing:-.02em;color:#34d399}${S} .kid b .acc{color:inherit}
${S} .tag{font:600 ${Math.round(15 * u)}px/1 ${MONO};letter-spacing:.06em;padding:${Math.round(7 * u)}px ${Math.round(11 * u)}px;border-radius:${Math.round(8 * u)}px;background:color-mix(in srgb,${accent} 18%,transparent);color:${accent}}`,
          js:
            b.js +
            headJs(S) +
            `tl.fromTo("${S} .root",{opacity:0,y:${Math.round(-20 * u)},scale:.96},{opacity:1,y:0,scale:1,duration:.8,ease:"expo.out"},.15);
tl.to("${S} .ln path",{strokeDashoffset:0,duration:.9,ease:"power2.inOut",stagger:.12},.8);
tl.fromTo("${S} .kid",{opacity:0,y:${Math.round(24 * u)},scale:.94},{opacity:1,y:0,scale:1,duration:.7,ease:"back.out(1.6)",stagger:.16},1.35);
tl.fromTo("${S} .tw",{scale:1},{scale:1.025,duration:${c.duration},ease:"none",transformOrigin:"50% 40%"},0);`,
        };
      },
    },
    {
      id: 'checklist',
      label: 'Recap checklist',
      use: 'A recap or requirements list: 3–8 short lines, each ticked in turn. Use it to close an explainer ("what you can do now") or to list what is protected.',
      minSeconds: 3.5,
      fields: [
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'title', type: 'text', label: 'Title', optional: true, max: 50 },
        { id: 'items', type: 'list', label: 'Lines', help: '3–8 lines, each ≤ 48 chars' },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, pad, S } = big(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const items = list(f.items).slice(0, 8);
        const two = items.length > 5 && !vertical;
        const per = Math.min(0.32, (c.duration - 1.4) / Math.max(items.length, 1));
        const tSize = fit(f.title, u, [[30, 64], [50, 54]], 46);
        return {
          markup:
            b.markup +
            `<div class="wrap" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px">${head(f, c, tSize)}<div class="ck${two ? ' two' : ''}">${items
              .map((t) => `<div class="it"><svg viewBox="0 0 24 24" width="${Math.round(40 * u)}" height="${Math.round(40 * u)}"><circle cx="12" cy="12" r="11" fill="${accent}" opacity=".18"/><path d="M7 12.5l3.2 3.2L17.5 8.5" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg><span>${R(t)}</span></div>`)
              .join('')}</div></div>`,
          css:
            b.css +
            headCss(S) +
            headStyles(S, u, accent) +
            `${S} .wrap{position:absolute;display:flex;flex-direction:column;justify-content:center}
${S} .ck{display:grid;gap:${Math.round(22 * u)}px ${Math.round(60 * u)}px}${S} .ck.two{grid-template-columns:1fr 1fr}
${S} .it{display:flex;align-items:center;gap:${Math.round(20 * u)}px;font:550 ${Math.round(32 * u)}px/1.2 var(--font-body)}${S} .it svg{flex:none}`,
          js:
            b.js +
            headJs(S) +
            `tl.fromTo("${S} .it",{opacity:0,x:-${Math.round(18 * u)}},{opacity:1,x:0,duration:.5,ease:"expo.out",stagger:${per.toFixed(2)}},.45);
tl.to("${S} .it path",{strokeDashoffset:0,duration:.35,ease:"power2.out",stagger:${per.toFixed(2)}},.65);`,
        };
      },
    },
    {
      id: 'matrix',
      label: 'Who can do what',
      use: 'Roles × abilities grid with ticks (permissions, plan features). 2–5 role columns, 3–7 rows. One column can be lit (the role this video is about).',
      minSeconds: 4,
      fields: [
        { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
        { id: 'title', type: 'text', label: 'Title', optional: true, max: 50 },
        { id: 'columns', type: 'text', label: 'Roles', help: '"Member | Team admin | Finance"' },
        { id: 'rows', type: 'list', label: 'Rows', help: 'One per line: "Ability | yes,no,yes"' },
        { id: 'highlight', type: 'number', label: 'Lit column (1-based)', optional: true },
        { id: 'theme', type: 'text', label: 'Ground (dark/light)', optional: true },
      ],
      build: (f, c) => {
        const { u, pad, S } = big(c);
        const mode = modeOf(f);
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const cols = String(f.columns ?? '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 5);
        const rows = list(f.rows).slice(0, 7).map((r) => {
          const [label, marks] = r.split('|').map((x) => x.trim());
          return { label, marks: String(marks ?? '').split(/[ ,]+/).map((m) => /^(y|yes|1|✓|x|true)$/i.test(m)) };
        });
        const hi = Math.min(Math.max(Number(f.highlight) || 0, 0), cols.length);
        const tSize = fit(f.title, u, [[30, 60], [50, 50]], 44);
        const grid = `grid-template-columns:2.2fr ${cols.map(() => '1fr').join(' ')}`;
        return {
          markup:
            b.markup +
            `<div class="wrap" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px">${head(f, c, tSize)}<div class="mx">${hi ? `<i class="col" style="left:calc((100% / ${2.2 + cols.length}) * ${2.2 + hi - 1});width:calc(100% / ${2.2 + cols.length})"></i>` : ''}<div class="mr mh" style="${grid}"><span></span>${cols.map((h) => `<span>${esc(h)}</span>`).join('')}</div>${rows
              .map((r) => `<div class="mr" style="${grid}"><span class="lb">${R(r.label)}</span>${cols.map((_, j) => `<span class="cell">${r.marks[j] ? `<svg viewBox="0 0 24 24" width="${Math.round(34 * u)}" height="${Math.round(34 * u)}"><circle cx="12" cy="12" r="11" fill="${accent}"/><path d="M7 12.5l3.2 3.2L17.5 8.5" fill="none" stroke="${mode === 'dark' ? '#0b0c10' : '#fff'}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : '<i class="no"></i>'}</span>`).join('')}</div>`)
              .join('')}</div></div>`,
          css:
            b.css +
            headCss(S) +
            headStyles(S, u, accent) +
            `${S} .wrap{position:absolute;display:flex;flex-direction:column;justify-content:center}
${S} .mx{position:relative}${S} .col{position:absolute;top:-${Math.round(10 * u)}px;bottom:-${Math.round(10 * u)}px;border-radius:${Math.round(14 * u)}px;border:1px solid color-mix(in srgb,${accent} 70%,transparent);background:color-mix(in srgb,${accent} 9%,transparent)}
${S} .mr{position:relative;display:grid;align-items:center;padding:${Math.round(14 * u)}px 0;border-bottom:1px solid ${mode === 'dark' ? 'rgba(255,255,255,.07)' : 'rgba(15,23,42,.07)'}}
${S} .mh{font:600 ${Math.round(16 * u)}px/1.2 ${MONO};letter-spacing:.1em;text-transform:uppercase;opacity:.7}${S} .mh span{text-align:center}
${S} .lb{font-size:${Math.round(25 * u)}px}${S} .cell{display:flex;justify-content:center}${S} .no{width:${Math.round(16 * u)}px;height:${Math.max(2, Math.round(3 * u))}px;border-radius:2px;background:currentColor;opacity:.22}`,
          js:
            b.js +
            headJs(S) +
            `tl.fromTo("${S} .mr",{opacity:0,y:${Math.round(12 * u)}},{opacity:1,y:0,duration:.5,ease:"expo.out",stagger:.12},.35);
tl.fromTo("${S} .cell svg",{scale:0},{scale:1,duration:.4,ease:"back.out(2.4)",stagger:.035},.8);` +
            has(`${S} .col`, `tl.fromTo("${S} .col",{opacity:0,scaleY:.9},{opacity:1,scaleY:1,duration:.6,ease:"expo.out"},${Math.max(1.6, c.duration * 0.5).toFixed(2)});`),
        };
      },
    },
    {
      id: 'form',
      label: 'Rebuilt UI: a form fills itself',
      use: 'Promo-style rebuilt UI on a light ground: a clean card with 2–4 fields whose values pop in as chips, one by one, like someone setting it up live. Great for "define your audience", "set your rules", onboarding. Values must be real options from the product.',
      minSeconds: 3.5,
      fields: [
        { id: 'title', type: 'text', label: 'Headline', max: 50 },
        { id: 'fields', type: 'list', label: 'Fields', help: 'One per line: "Label: value, value, value" (2–4 fields, ≤ 4 values each)' },
        { id: 'theme', type: 'text', label: 'Ground (light/dark)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, pad, S } = big(c);
        const mode = String(f.theme ?? 'light') === 'dark' ? 'dark' : 'light';
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const fields = list(f.fields).slice(0, 4).map((l) => {
          const i = l.indexOf(':');
          return { label: i > 0 ? l.slice(0, i).trim() : l, values: (i > 0 ? l.slice(i + 1) : '').split(',').map((v) => v.trim()).filter(Boolean).slice(0, 4) };
        });
        const count = fields.reduce((a, x) => a + x.values.length, 0);
        const per = Math.min(0.42, Math.max(0.18, (c.duration - 1.8) / Math.max(count, 1)));
        const tSize = fit(f.title, u, [[28, 76], [50, 62]], 54);
        let k = 0;
        return {
          markup:
            b.markup +
            `<div class="wrap" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px"><h2 class="ttl" style="font-size:${tSize}px">${words(f.title)}</h2><div class="frm card${vertical ? ' v' : ''}">${fields
              .map((fl) => `<div class="fd"><span class="fl">${esc(fl.label)}</span><div class="box">${fl.values.map((v) => `<span class="cp c${k++}">${esc(v)}</span>`).join('')}<i class="caret"></i></div></div>`)
              .join('')}</div></div>`,
          css:
            b.css +
            headCss(S) +
            box(S, mode, u) +
            `${S} .wrap{position:absolute;display:flex;flex-direction:column;justify-content:center}${S} .ttl{margin-bottom:${Math.round(40 * u)}px}
${S} .frm{display:grid;grid-template-columns:1fr 1fr;gap:${Math.round(26 * u)}px ${Math.round(30 * u)}px;padding:${Math.round(34 * u)}px}${S} .frm.v{grid-template-columns:1fr}
${S} .fl{display:block;font:600 ${Math.round(21 * u)}px/1 var(--font-body);opacity:.75;margin-bottom:${Math.round(12 * u)}px}
${S} .box{display:flex;flex-wrap:wrap;gap:${Math.round(10 * u)}px;min-height:${Math.round(68 * u)}px;align-items:center;padding:${Math.round(10 * u)}px ${Math.round(12 * u)}px;border-radius:${Math.round(12 * u)}px;background:${mode === 'dark' ? 'rgba(255,255,255,.05)' : '#f1f5f9'};border:1px solid ${mode === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.06)'}}
${S} .cp{font:600 ${Math.round(23 * u)}px/1 var(--font-body);padding:${Math.round(11 * u)}px ${Math.round(16 * u)}px;border-radius:${Math.round(10 * u)}px;color:${accent};background:color-mix(in srgb,var(--brand-primary) 12%,${mode === 'dark' ? 'transparent' : '#fff'});border:1px solid color-mix(in srgb,var(--brand-primary) 30%,transparent)}
${S} .caret{width:${Math.max(2, Math.round(2.5 * u))}px;height:${Math.round(30 * u)}px;background:${accent};opacity:0}`,
          js:
            b.js +
            wordIn(S, '.ttl', 0.05) +
            `tl.fromTo("${S} .frm",{opacity:0,y:${Math.round(40 * u)},scale:.98},{opacity:1,y:0,scale:1,duration:.8,ease:"expo.out"},.3);
tl.fromTo("${S} .fd",{opacity:0},{opacity:1,duration:.4,stagger:.08},.45);
tl.fromTo("${S} .cp",{opacity:0,scale:.6,y:${Math.round(6 * u)}},{opacity:1,scale:1,y:0,duration:.42,ease:"back.out(2.4)",stagger:${per.toFixed(2)}},1.0);
tl.fromTo("${S} .caret",{opacity:0},{opacity:1,duration:.05,repeat:${Math.max(1, Math.floor(c.duration * 1.6))},yoyo:true,repeatDelay:.25},.9);
tl.fromTo("${S} .frm",{rotation:0},{rotation:.001,duration:${c.duration},ease:"none"},0);`,
        };
      },
    },
    {
      id: 'options',
      label: 'Rebuilt UI: pick an option',
      use: 'Promo-style: 2–4 option cards (sources, plans, modes) and a cursor that picks one — the card lights up with a check. Shows a choice the product makes easy.',
      minSeconds: 3.5,
      fields: [
        { id: 'title', type: 'text', label: 'Headline', max: 50 },
        { id: 'subtitle', type: 'text', label: 'Small line', optional: true, max: 60 },
        { id: 'items', type: 'list', label: 'Options', help: 'One per line: "Title — tiny line"' },
        { id: 'pick', type: 'number', label: 'Picked (1-based)', optional: true },
        { id: 'theme', type: 'text', label: 'Ground (light/dark)', optional: true },
      ],
      build: (f, c) => {
        const { u, vertical, pad, S } = big(c);
        const mode = String(f.theme ?? 'light') === 'dark' ? 'dark' : 'light';
        const b = bg(c, mode);
        const accent = accentFor(c, mode);
        const items = list(f.items).slice(0, 4).map(parts);
        const pick = Math.min(Math.max(Number(f.pick) || 1, 1), Math.max(items.length, 1));
        const tSize = fit(f.title, u, [[28, 76], [50, 62]], 54);
        const W = c.width - pad.l - pad.r;
        const cols = vertical ? 2 : items.length;
        const gap = Math.round(22 * u);
        const cw = (W - gap * (cols - 1)) / cols;
        const ch = Math.round(170 * u);
        const headH = tSize * 1.1 + (f.subtitle ? 50 * u : 0) + 44 * u;
        const rowsN = Math.ceil(items.length / cols);
        const top = pad.t + (c.height - pad.t - pad.b - headH - rowsN * ch - (rowsN - 1) * gap) / 2;
        const gx = (i: number) => pad.l + (i % cols) * (cw + gap);
        const gy = (i: number) => top + headH + Math.floor(i / cols) * (ch + gap);
        const clickAt = Math.max(2.1, c.duration * 0.55);
        return {
          markup:
            b.markup +
            `<div class="hd" style="left:${pad.l}px;right:${pad.r}px;top:${top}px"><h2 class="ttl" style="font-size:${tSize}px">${words(f.title)}</h2>${f.subtitle ? `<p class="st">${esc(f.subtitle)}</p>` : ''}</div>
${items.map(([t, sub], i) => `<div class="op card o${i}" style="left:${gx(i)}px;top:${gy(i)}px;width:${cw}px;height:${ch}px"><i class="ring"></i><i class="ic"></i><b>${R(t)}</b>${sub ? `<small>${R(sub)}</small>` : ''}<span class="chk"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.5 3.5L17.5 8.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>`).join('')}
${cursorSvg(u)}`,
          css:
            b.css +
            headCss(S) +
            box(S, mode, u) +
            cursorCss(S, u) +
            `${S} .hd{position:absolute}${S} .st{margin:${Math.round(14 * u)}px 0 0;font-size:${Math.round(26 * u)}px;opacity:.6}
${S} .op{position:absolute;padding:${Math.round(24 * u)}px;display:flex;flex-direction:column;gap:${Math.round(8 * u)}px}
${S} .ic{width:${Math.round(34 * u)}px;height:${Math.round(34 * u)}px;border-radius:${Math.round(9 * u)}px;background:color-mix(in srgb,var(--brand-primary) 18%,transparent);margin-bottom:${Math.round(8 * u)}px}
${S} .op b{font:700 ${Math.round(29 * u)}px/1.15 var(--font-display)}${S} .op small{font-size:${Math.round(20 * u)}px;opacity:.6;line-height:1.3}
${S} .chk{position:absolute;right:${Math.round(16 * u)}px;top:${Math.round(16 * u)}px;width:${Math.round(34 * u)}px;height:${Math.round(34 * u)}px;border-radius:50%;background:var(--brand-primary);display:grid;place-items:center}${S} .chk svg{width:70%;height:70%}
${S} .op .ring{position:absolute;inset:-1px;border-radius:inherit;opacity:0;border:${Math.max(2, Math.round(2.5 * u))}px solid var(--brand-primary);box-shadow:0 0 0 ${Math.max(2, Math.round(2.5 * u))}px var(--brand-primary),0 ${Math.round(18 * u)}px ${Math.round(40 * u)}px -${Math.round(20 * u)}px color-mix(in srgb,var(--brand-primary) 60%,transparent)}`,
          js:
            b.js +
            wordIn(S, '.ttl', 0.05) +
            has(`${S} .st`, `tl.fromTo("${S} .st",{opacity:0},{opacity:.6,duration:.6},.4);`) +
            `tl.set("${S} .chk",{scale:0},0);tl.fromTo("${S} .op",{opacity:0,y:${Math.round(30 * u)}},{opacity:1,y:0,duration:.7,ease:"expo.out",stagger:.09},.45);
tl.fromTo("${S} .cursor",{x:${c.width * 0.88},y:${c.height * 0.92},opacity:0},{x:${(gx(pick - 1) + cw * 0.55).toFixed(1)},y:${(gy(pick - 1) + ch * 0.55).toFixed(1)},opacity:1,duration:1.1,ease:"power3.inOut"},${(clickAt - 1.1).toFixed(2)});` +
            clickJs(S, clickAt) +
            `tl.to("${S} .o${pick - 1} .ring",{opacity:1,duration:.3,ease:"power2.out"},${(clickAt + 0.05).toFixed(2)});
tl.to("${S} .o${pick - 1} .chk",{scale:1,duration:.4,ease:"back.out(3)"},${(clickAt + 0.08).toFixed(2)});
tl.fromTo("${S} .o${pick - 1}",{scale:1},{scale:1.03,duration:.18,yoyo:true,repeat:1,ease:"power2.out"},${(clickAt + 0.02).toFixed(2)});`,
        };
      },
    },
  ];
}
