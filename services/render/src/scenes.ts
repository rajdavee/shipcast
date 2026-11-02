import { pathToFileURL } from 'node:url';
import { explainerScenes } from './scenes-explainer.ts';
import { contrastRatio, ensureContrast, luminance, onColor, type BrandKit, type SafeZone } from '@shipcast/engine';

/** Mix a colour toward white until it reads (≥ 3:1, WCAG large text) on a dark ground. */
function readableOnDark(hex: string, ground = '#121317'): string {
  const mix = (t: number) => {
    const n = parseInt(hex.slice(1).length === 3 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
    return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  for (let t = 0; t <= 0.85; t += 0.05) if (contrastRatio(mix(t), ground) >= 4.6) return mix(t);
  return '#ffffff';
}

/**
 * Shipcast motion scenes. Each scene compiles to a HyperFrames
 * sub-composition: markup + scoped CSS + one paused GSAP timeline.
 * Motion follows the house tokens: expo-out entrances, power3 moves,
 * 60 ms sibling stagger, small (≤1.08) overshoot pops, and a slow
 * secondary drift so no frame is ever dead.
 */

export interface SceneCtx {
  id: string;
  width: number;
  height: number;
  duration: number;
  safe: SafeZone;
  brand: BrandKit;
  /** Directory relative asset paths resolve against (brief folder). */
  assetsDir?: string;
  /** Project folder: assets are copied here and referenced relatively. */
  asset: (src: string) => string;
  /** Pixels at the bottom reserved for captions (0 when there are none). */
  captionBand?: number;
  /** Platform/tool logos resolved before build (name → data URI, null = monogram). */
  icons?: Record<string, string | null>;
  /** Spoken word times in this scene (seconds from scene start), for lip-sync and reveals. */
  talk?: { text: string; start: number; end: number }[];
}

export interface SceneDef {
  id: string;
  label: string;
  /** Written for the model choosing scenes. */
  use: string;
  fields: { id: string; type: 'text' | 'longtext' | 'image' | 'list' | 'number' | 'point'; label: string; optional?: boolean; max?: number; help?: string }[];
  /** Shortest readable duration in seconds. */
  minSeconds: number;
  build: (f: Record<string, any>, c: SceneCtx) => { markup: string; css: string; js: string };
}

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `*word*` → accent span. Words become individually animatable spans. */
function words(text: unknown, cls = 'w'): string {
  const tokens = esc(text)
    .split(/(\*[^*]+\*)/g)
    .flatMap((part) => {
      const accent = /^\*.*\*$/.test(part);
      return part
        .replace(/^\*|\*$/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ w, accent }));
    });
  // Punctuation that followed an accented phrase ("*finished*.") hugs the previous word, inside the
  // same unbreakable box so it can never wrap onto a line of its own.
  const merged: { w: string; accent: boolean; tail: string }[] = [];
  for (const t of tokens) {
    if (merged.length && /^[.,!?;:…)%]+$/.test(t.w)) merged[merged.length - 1].tail += t.w;
    else merged.push({ ...t, tail: '' });
  }
  return merged
    .map(({ w, accent, tail }, i) => `${i ? ' ' : ''}<span class="${cls}-m"><span class="${cls}${accent ? ' acc' : ''}">${w}${tail}</span></span>`)
    .join('');
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split('\n')).map((x) => x.trim()).filter(Boolean);

/** Font size by text length, scaled to the canvas. */
function fit(text: unknown, u: number, steps: [number, number][], min: number): number {
  const n = String(text ?? '').replace(/\*/g, '').length;
  for (const [chars, px] of steps) if (n <= chars) return Math.round(px * u);
  return Math.round(min * u);
}

function frame(c: SceneCtx) {
  const vertical = c.height > c.width * 1.2;
  // Phones show vertical video small and close: type runs larger there.
  const u = (Math.min(c.width, c.height) / 1080) * (vertical ? 1.18 : 1);
  const pad = { t: Math.max(c.safe.top, 60 * u), r: Math.max(c.safe.right, 72 * u), b: Math.max(c.safe.bottom, 60 * u, c.captionBand ?? 0), l: Math.max(c.safe.left, 72 * u) };
  return { u, vertical, pad, S: `#${c.id}` };
}

/** Shared background: brand ground with two slowly drifting glows. */
function bg(c: SceneCtx, mode: 'dark' | 'brand' | 'light' = 'dark') {
  const { S } = frame(c);
  // "Light" scenes stay light even when the brand's own ground is dark, so long videos alternate
  // dark and light instead of sitting on one tone for minutes.
  const darkBrand = luminance(c.brand.colors.background) < 0.35;
  const paper = '#f3f4f6';
  const base = mode === 'brand' ? 'var(--brand-primary)' : mode === 'light' ? (darkBrand ? paper : 'var(--brand-bg)') : 'color-mix(in srgb,var(--brand-bg) 12%,#08090d)';
  const ink = mode === 'brand' ? 'var(--brand-on-primary)' : mode === 'light' ? (darkBrand ? '#14161c' : 'var(--brand-text)') : '#f4f5f8';
  const lightAccent = ensureContrast(c.brand.colors.primary, darkBrand ? paper : c.brand.colors.background, 3);
  return {
    markup: `<div class="bg"><i class="g1"></i><i class="g2"></i><i class="grain"></i></div>`,
    css: `${S}{position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;overflow:hidden;background:${base};color:${ink};font-family:var(--font-body)}
${S} .bg,${S} .bg i{position:absolute;inset:0}
${S} .bg .g1{inset:-20%;background:radial-gradient(40% 40% at 75% 25%,color-mix(in srgb,var(--brand-primary) ${mode === 'brand' ? 0 : mode === 'dark' ? 26 : 45}%,transparent),transparent 70%)}
${S} .bg .g2{inset:-20%;background:radial-gradient(45% 45% at 20% 85%,color-mix(in srgb,var(--brand-secondary) ${mode === 'brand' ? 25 : 30}%,transparent),transparent 70%)}
${S} .bg .grain{opacity:.08;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
${S} .acc{color:${mode === 'brand' ? ink : mode === 'dark' ? readableOnDark(c.brand.colors.primary) : lightAccent}}
${S} .stage{position:absolute;display:flex;flex-direction:column;justify-content:center}`,
    js: `tl.fromTo("${S} .g1",{xPercent:-4,yPercent:3,scale:1},{xPercent:5,yPercent:-4,scale:1.08,duration:${c.duration},ease:"none"},0);
tl.fromTo("${S} .g2",{xPercent:4,yPercent:-2},{xPercent:-5,yPercent:4,duration:${c.duration},ease:"none"},0);`,
  };
}

const stage = (c: SceneCtx, inner: string, align: 'left' | 'center' = 'left') => {
  const { pad } = frame(c);
  return `<div class="stage" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;bottom:${pad.b}px;align-items:${align === 'center' ? 'center' : 'flex-start'};text-align:${align}">${inner}</div>`;
};

/** Only animate what exists: optional fields leave no GSAP "target not found" noise. */
const has = (sel: string, code: string) => `if(document.querySelector(${JSON.stringify(sel)})){${code}}`;

const wordIn = (S: string, sel: string, at: number, cls = 'w') =>
  has(`${S} ${sel} .${cls}`, `tl.fromTo("${S} ${sel} .${cls}",{yPercent:115,opacity:0},{yPercent:0,opacity:1,duration:.85,ease:"expo.out",stagger:.06},${at});`);

const headCss = (S: string) => `${S} .w-m,${S} .x-m{display:inline-block;overflow:hidden;vertical-align:top;padding:.04em .02em .1em;margin:-.04em -.02em -.1em}
${S} .w,${S} .x{display:inline-block}
${S} h1,${S} h2{font-family:var(--font-display);font-weight:800;letter-spacing:-.035em;line-height:1.02;margin:0;text-wrap:balance}
${S} .kicker{font-weight:700;letter-spacing:-.005em;display:block}
${S} .sub{opacity:.72;font-weight:500;line-height:1.35;max-width:28ch;text-wrap:pretty;overflow-wrap:anywhere}`;

function img(src: unknown, c: SceneCtx): string {
  const s = String(src ?? '').trim();
  if (!s) return '';
  if (/^https?:|^data:/.test(s)) return esc(s);
  return esc(c.asset(s.startsWith('/') ? s : `${c.assetsDir ?? ''}/${s}`));
}

const logoMarkup = (c: SceneCtx, size: number) =>
  c.brand.logo ? `<img class="logo" src="${img(c.brand.logo, c)}" style="height:${size}px;width:auto" alt="">` : `<span class="logo" style="font:800 ${size}px/1 var(--font-display);letter-spacing:-.03em">${esc(c.brand.name)}</span>`;

export const SCENES: SceneDef[] = [
  {
    id: 'title',
    label: 'Kinetic title',
    use: 'Hook or chapter card. Words rise in one by one. 3–9 words land hardest; *wrap* the key word.',
    minSeconds: 2.2,
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
      { id: 'title', type: 'text', label: 'Title', max: 80 },
      { id: 'subtitle', type: 'text', label: 'Subtitle', optional: true, max: 110 },
    ],
    build: (f, c) => {
      const { u, vertical, S } = frame(c);
      const b = bg(c, 'dark');
      const size = fit(f.title, u, vertical ? [[14, 150], [26, 124], [44, 104], [80, 86]] : [[14, 168], [26, 140], [44, 116], [80, 92]], 76);
      return {
        markup: b.markup + stage(c, `${f.kicker ? `<span class="kicker acc" style="font-size:${Math.round(36 * u)}px;margin-bottom:${Math.round(28 * u)}px"><span class="x-m"><span class="x">${esc(f.kicker)}</span></span></span>` : ''}<h1 style="font-size:${size}px">${words(f.title)}</h1>${f.subtitle ? `<p class="sub" style="font-size:${Math.round(40 * u)}px;margin-top:${Math.round(32 * u)}px">${esc(f.subtitle)}</p>` : ''}`),
        css: b.css + headCss(S),
        js: b.js + has(`${S} .x`, `tl.fromTo("${S} .x",{yPercent:110},{yPercent:0,duration:.6,ease:"expo.out"},.05);`) + wordIn(S, 'h1', 0.15) + has(`${S} .sub`, `tl.fromTo("${S} .sub",{y:${24 * u},opacity:0},{y:0,opacity:.72,duration:.7,ease:"expo.out"},.55);`) + `tl.fromTo("${S} h1",{scale:1},{scale:1.03,duration:${c.duration},ease:"none",transformOrigin:"0% 50%"},0);`,
      };
    },
  },
  {
    id: 'statement',
    label: 'Statement with highlight',
    use: 'A problem, stake or punchline sentence. A marker sweeps behind the *highlighted* phrase.',
    minSeconds: 2.8,
    fields: [{ id: 'text', type: 'text', label: 'Sentence', max: 110, help: 'Wrap the phrase to highlight in *stars*' }],
    build: (f, c) => {
      const { u, vertical, S } = frame(c);
      const b = bg(c, 'light');
      const size = fit(f.text, u, vertical ? [[30, 120], [60, 96], [110, 78]] : [[30, 128], [60, 104], [110, 84]], 70);
      // Punctuation right after the phrase stays on its line (never a lone "," at the start of the next).
      const html = esc(f.text).replace(/\*([^*]+)\*([.,!?;:…)%]*)/g, '<span style="white-space:nowrap"><mark><span class="t">$1</span><span class="hl" aria-hidden="true">$1</span></mark>$2</span>');
      return {
        markup: b.markup + stage(c, `<h2 style="font-size:${size}px">${html}</h2>`),
        css: b.css + headCss(S) + `${S} mark{position:relative;display:inline-block;background:none;color:inherit;padding:0 .08em}
${S} mark .t{color:inherit}
${S} mark .hl{position:absolute;left:0;top:0;right:0;bottom:0;padding:0 .08em;background:var(--brand-primary);color:${onColor(c.brand.colors.primary)};border-radius:.08em;white-space:nowrap}`,
        js: b.js + `tl.fromTo("${S} h2",{y:${40 * u},opacity:0},{y:0,opacity:1,duration:.8,ease:"expo.out"},.1);tl.fromTo("${S} mark .hl",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:.55,ease:"power3.inOut"},.75);tl.fromTo("${S} h2",{scale:1},{scale:1.025,duration:${c.duration},ease:"none",transformOrigin:"0% 50%"},0);`,
      };
    },
  },
  {
    id: 'stat',
    label: 'Stat count-up',
    use: 'A real number from the brief counts up. Value like "92%", "10x", "$0", "3 min".',
    minSeconds: 2.6,
    fields: [
      { id: 'value', type: 'text', label: 'Value', max: 10 },
      { id: 'label', type: 'text', label: 'Label', max: 60 },
      { id: 'context', type: 'text', label: 'Source / context', optional: true, max: 90 },
    ],
    build: (f, c) => {
      const { u, pad, S } = frame(c);
      const b = bg(c, 'brand');
      const m = String(f.value ?? '').match(/^([^\d]*)([\d.,]+)(.*)$/);
      const [pre, num, post] = m ? [m[1], m[2], m[3]] : ['', '', String(f.value ?? '')];
      const target = Number(num.replace(/,/g, '')) || 0;
      const decimals = num.includes('.') ? num.split('.')[1].length : 0;
      return {
        markup: b.markup + stage(c, `<div class="num" style="font-size:${Math.round(Math.min((String(f.value).length > 5 ? 230 : 300) * u, (c.width - pad.l - pad.r) / (Math.max(2, String(f.value).length) * 0.64)))}px">${esc(pre)}<span class="n">${esc(num || '')}</span>${esc(post)}</div><h2 style="font-size:${Math.round(64 * u)}px;margin-top:${Math.round(20 * u)}px">${words(f.label)}</h2>${f.context ? `<p class="sub" style="font-size:${Math.round(32 * u)}px;margin-top:${Math.round(24 * u)}px">${esc(f.context)}</p>` : ''}`),
        css: b.css + headCss(S) + `${S} .num{font-family:var(--font-display);font-weight:900;letter-spacing:-.06em;line-height:.9;font-variant-numeric:tabular-nums}`,
        js:
          b.js +
          `tl.fromTo("${S} .num",{scale:.86,opacity:0},{scale:1,opacity:1,duration:.7,ease:"back.out(1.5)",transformOrigin:"0% 80%"},.05);` +
          (num ? `const cnt={v:0};const nEl=document.querySelector("${S} .n");tl.fromTo(cnt,{v:0},{v:${target},duration:1.3,ease:"expo.out",onUpdate:()=>{nEl.textContent=cnt.v.toLocaleString("en-US",{minimumFractionDigits:${decimals},maximumFractionDigits:${decimals}})}},.1);` : '') +
          wordIn(S, 'h2', 0.6) +
          has(`${S} .sub`, `tl.fromTo("${S} .sub",{opacity:0},{opacity:.72,duration:.6},1.1);`),
      };
    },
  },
  {
    id: 'product',
    label: 'Product shot with zoom + click',
    use: 'The real UI. Window lands, the camera pushes in on the detail that matters, a cursor clicks it. Give focus as x,y fractions (0–1) of the screenshot.',
    minSeconds: 3.5,
    fields: [
      { id: 'image', type: 'image', label: 'Screenshot' },
      { id: 'title', type: 'text', label: 'Caption title', optional: true, max: 60 },
      { id: 'focusX', type: 'number', label: 'Focus X (0–1)', optional: true },
      { id: 'focusY', type: 'number', label: 'Focus Y (0–1)', optional: true },
      { id: 'zoom', type: 'number', label: 'Zoom (1–2.2)', optional: true },
      { id: 'click', type: 'text', label: 'Click (yes/no)', optional: true },
      { id: 'device', type: 'text', label: 'Frame (browser/phone)', optional: true, help: 'phone = a mobile screenshot in a phone; best for vertical video' },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const fx = Math.min(Math.max(Number(f.focusX ?? 0.5), 0), 1);
      const fy = Math.min(Math.max(Number(f.focusY ?? 0.4), 0), 1);
      const zoom = Math.min(Math.max(Number(f.zoom ?? 1.6), 1), 2.4);
      const titleH = f.title ? Math.round((vertical ? 170 : 140) * u) : 0;
      const phone = f.device === 'phone';
      const availW = c.width - pad.l - pad.r;
      // Imagery may run under the platform's bottom UI (only text must stay clear of it).
      const bottom = vertical ? Math.round(c.height * 0.14) : pad.b;
      const h = c.height - pad.t - bottom - titleH;
      // Phones keep a 9:19.5 body inside the available box; browsers fill it.
      const w = phone ? Math.min(availW, Math.round(h / 2.05)) : availW;
      const left = phone ? Math.round(pad.l + (availW - w) / 2) : pad.l;
      const click = String(f.click ?? 'yes') !== 'no';
      return {
        markup:
          b.markup +
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round((vertical ? 80 : 76) * u)}px">${words(f.title)}</h2>` : ''}
<div class="win${phone ? ' phone' : ''}" style="left:${left}px;top:${pad.t + titleH}px;width:${w}px;height:${h}px"><div class="cam">${phone ? '' : '<div class="bar"><i></i><i></i><i></i></div>'}<img src="${img(f.image, c)}" alt=""></div>${phone ? '<i class="notch"></i>' : ''}</div>
${click ? `<div class="cursor"><svg viewBox="0 0 24 24" width="${Math.round(54 * u)}" height="${Math.round(54 * u)}"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><i class="ripple"></i></div>` : ''}`,
        css:
          b.css +
          headCss(S) +
          `${S} .win{position:absolute;border-radius:${Math.round(22 * u)}px;overflow:hidden;box-shadow:0 ${50 * u}px ${110 * u}px -${30 * u}px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.1);background:#111}
${S} .cam{position:absolute;inset:0;transform-origin:${fx * 100}% ${fy * 100}%}
${S} .bar{height:${Math.round(40 * u)}px;display:flex;align-items:center;gap:${Math.round(9 * u)}px;padding:0 ${Math.round(16 * u)}px;background:#1d2029}
${S} .bar i{width:${Math.round(12 * u)}px;height:${Math.round(12 * u)}px;border-radius:50%;background:#3a3e4a}
${S} .cam img{display:block;width:100%;height:calc(100% - ${Math.round(40 * u)}px);object-fit:cover;object-position:top center}
${S} .win.phone{border-radius:${Math.round(64 * u)}px;box-shadow:0 0 0 ${Math.round(14 * u)}px #0c0d11,0 0 0 ${Math.round(16 * u)}px #2a2d36,0 ${50 * u}px ${110 * u}px -${30 * u}px rgba(0,0,0,.7)}
${S} .win.phone .cam img{height:100%}
${S} .notch{position:absolute;left:50%;top:${Math.round(16 * u)}px;width:${Math.round(110 * u)}px;height:${Math.round(32 * u)}px;margin-left:-${Math.round(55 * u)}px;border-radius:${Math.round(20 * u)}px;background:#0c0d11}
${S} .cursor{position:absolute;left:0;top:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
${S} .ripple{position:absolute;left:${Math.round(-30 * u)}px;top:${Math.round(-30 * u)}px;width:${Math.round(64 * u)}px;height:${Math.round(64 * u)}px;border-radius:50%;border:${Math.max(2, Math.round(4 * u))}px solid var(--brand-primary);opacity:0}`,
        js:
          b.js +
          wordIn(S, '.cap', 0.05) +
          `tl.fromTo("${S} .win",{y:${80 * u},rotateX:12,opacity:0,transformPerspective:1600},{y:0,rotateX:0,opacity:1,duration:1,ease:"expo.out"},.1);
tl.fromTo("${S} .cam",{scale:1},{scale:${zoom},duration:1.1,ease:"power3.inOut"},1.2);` +
          (click
            ? `const tx=${left + w * fx}, ty=${pad.t + titleH + (phone ? 0 : 40 * u) + (h - (phone ? 0 : 40 * u)) * fy};
tl.fromTo("${S} .cursor",{x:${c.width * 0.86},y:${c.height * 0.9},opacity:0},{x:tx,y:ty,opacity:1,duration:1.15,ease:"power3.inOut"},1.1);
tl.fromTo("${S} .cursor svg",{scale:1},{scale:.82,duration:.09,yoyo:true,repeat:1,ease:"power2.out",transformOrigin:"10% 10%"},2.35);
tl.fromTo("${S} .ripple",{scale:.3,opacity:.9},{scale:1.7,opacity:0,duration:.6,ease:"expo.out"},2.38);`
            : '') +
          `tl.fromTo("${S} .win",{x:0},{x:${-10 * u},duration:${c.duration},ease:"none"},0);`,
      };
    },
  },
  {
    id: 'features',
    label: 'Feature reveal',
    use: '3–4 short features land one after another with checkmarks. Each ≤ 6 words.',
    minSeconds: 3.4,
    fields: [
      { id: 'title', type: 'text', label: 'Heading', optional: true, max: 50 },
      { id: 'items', type: 'list', label: 'Features (one per line)', max: 4 },
    ],
    build: (f, c) => {
      const { u, vertical, S } = frame(c);
      const b = bg(c, 'dark');
      const items = list(f.items).slice(0, 4);
      return {
        markup:
          b.markup +
          stage(
            c,
            `${f.title ? `<h2 style="font-size:${Math.round((vertical ? 96 : 92) * u)}px;margin-bottom:${Math.round(52 * u)}px">${words(f.title)}</h2>` : ''}<ul>${items
              .map((it) => `<li style="font-size:${Math.round((vertical ? 60 : 58) * u)}px"><b><svg viewBox="0 0 24 24" width="${Math.round(30 * u)}" height="${Math.round(30 * u)}"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></b><span>${esc(it)}</span></li>`)
              .join('')}</ul>`,
          ),
        css:
          b.css +
          headCss(S) +
          `${S} ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${Math.round(30 * u)}px}
${S} li{display:flex;align-items:center;gap:${Math.round(26 * u)}px;font-weight:700;letter-spacing:-.02em;font-family:var(--font-display)}
${S} li b{flex:none;display:grid;place-items:center;width:${Math.round(64 * u)}px;height:${Math.round(64 * u)}px;border-radius:${Math.round(18 * u)}px;background:var(--brand-primary);color:var(--brand-on-primary)}`,
        js:
          b.js +
          wordIn(S, 'h2', 0.05) +
          `tl.fromTo("${S} li",{x:${-50 * u},opacity:0},{x:0,opacity:1,duration:.75,ease:"expo.out",stagger:${Math.max(0.35, Math.min(0.6, (c.duration - 1.6) / Math.max(items.length, 1)))}},.45);
tl.fromTo("${S} li b",{scale:.4,rotate:-20},{scale:1,rotate:0,duration:.6,ease:"back.out(1.7)",stagger:${Math.max(0.35, Math.min(0.6, (c.duration - 1.6) / Math.max(items.length, 1)))}},.5);`,
      };
    },
  },
  {
    id: 'quote',
    label: 'Testimonial',
    use: 'A real quote with attribution. Card rises, quote mark pops, line reveals.',
    minSeconds: 3.5,
    fields: [
      { id: 'quote', type: 'longtext', label: 'Quote', max: 160 },
      { id: 'name', type: 'text', label: 'Name', max: 40 },
      { id: 'role', type: 'text', label: 'Role', optional: true, max: 50 },
    ],
    build: (f, c) => {
      const { u, S } = frame(c);
      const b = bg(c, 'dark');
      const size = fit(f.quote, u, [[60, 96], [110, 80], [160, 66]], 60);
      return {
        markup: b.markup + stage(c, `<div class="card"><div class="qm" style="font-size:${Math.round(200 * u)}px">“</div><p style="font-size:${size}px">${esc(f.quote)}</p><div class="who" style="font-size:${Math.round(38 * u)}px"><b>${esc(f.name)}</b>${f.role ? ` <span>· ${esc(f.role)}</span>` : ''}</div></div>`),
        css:
          b.css +
          `${S} .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:${Math.round(36 * u)}px;padding:${Math.round(64 * u)}px}
${S} .qm{font:900 1em/.6 var(--font-display);color:var(--brand-primary);height:${Math.round(110 * u)}px}
${S} p{margin:0;font-family:var(--font-display);font-weight:650;letter-spacing:-.02em;line-height:1.18;text-wrap:balance}
${S} .who{margin-top:${Math.round(40 * u)}px;opacity:.85}${S} .who span{opacity:.7}`,
        js: b.js + `tl.fromTo("${S} .card",{y:${70 * u},opacity:0},{y:0,opacity:1,duration:.9,ease:"expo.out"},.05);tl.fromTo("${S} .qm",{scale:.3,opacity:0},{scale:1,opacity:1,duration:.6,ease:"back.out(1.8)",transformOrigin:"0% 50%"},.35);tl.fromTo("${S} p",{clipPath:"inset(0 0 100% 0)"},{clipPath:"inset(0 0 0% 0)",duration:1.1,ease:"power3.inOut"},.5);tl.fromTo("${S} .who",{opacity:0},{opacity:.85,duration:.6},1.4);`,
      };
    },
  },
  {
    id: 'compare',
    label: 'Before / after',
    use: 'Old way vs new way. 2–3 short lines per side. The old side holds long enough to read, greys out, then the new side lands.',
    minSeconds: 5,
    fields: [
      { id: 'leftLabel', type: 'text', label: 'Old label', max: 18 },
      { id: 'left', type: 'list', label: 'Old way', max: 3 },
      { id: 'rightLabel', type: 'text', label: 'New label', max: 18 },
      { id: 'right', type: 'list', label: 'New way', max: 3 },
    ],
    build: (f, c) => {
      const { u, vertical, S } = frame(c);
      const b = bg(c, 'dark');
      const col = (cls: string, label: unknown, items: string[], mark: string) =>
        `<div class="col ${cls}"><h5 style="font-size:${Math.round(30 * u)}px">${esc(label)}</h5>${items.map((x) => `<p style="font-size:${Math.round(44 * u)}px"><b>${mark}</b>${esc(x)}</p>`).join('')}</div>`;
      return {
        markup: b.markup + stage(c, `<div class="cols">${col('old', f.leftLabel, list(f.left).slice(0, 3), '✕')}${col('new', f.rightLabel, list(f.right).slice(0, 3), '✓')}</div>`),
        css: `${b.css}
${S} .cols{display:grid;grid-template-columns:${vertical ? '1fr' : '1fr 1fr'};gap:${Math.round(28 * u)}px;width:100%}
${S} .col{border-radius:${Math.round(30 * u)}px;padding:${Math.round(48 * u)}px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
${S} .col.new{background:var(--brand-primary);color:var(--brand-on-primary);border:none}
${S} h5{margin:0 0 ${Math.round(26 * u)}px;font-weight:800;letter-spacing:.04em;opacity:.75}
${S} .col p{margin:${Math.round(14 * u)}px 0 0;font-weight:700;letter-spacing:-.02em;font-family:var(--font-display);display:flex;gap:${Math.round(18 * u)}px;align-items:baseline}
${S} .col b{opacity:.8}`,
        js: b.js + `tl.fromTo("${S} .old",{y:${50 * u},opacity:0},{y:0,opacity:1,duration:.8,ease:"expo.out"},.05);tl.fromTo("${S} .old p",{opacity:0},{opacity:1,stagger:.12,duration:.4},.35);tl.to("${S} .old",{opacity:.5,filter:"grayscale(1)",duration:.6,ease:"power2.out"},${(Math.max(2.4, c.duration * 0.45)).toFixed(2)});tl.fromTo("${S} .new",{y:${70 * u},opacity:0,scale:.96},{y:0,opacity:1,scale:1,duration:.85,ease:"expo.out"},${(Math.max(2.3, c.duration * 0.43)).toFixed(2)});tl.fromTo("${S} .new p",{x:${-30 * u},opacity:0},{x:0,opacity:1,stagger:.14,duration:.55,ease:"expo.out"},${(Math.max(2.6, c.duration * 0.45 + 0.3)).toFixed(2)});`,
      };
    },
  },
  {
    id: 'scroll',
    label: 'Page scroll',
    use: 'A tall screenshot (full page) scrolls inside a browser or phone frame. Great for landing pages.',
    minSeconds: 4,
    fields: [
      { id: 'image', type: 'image', label: 'Tall screenshot' },
      { id: 'title', type: 'text', label: 'Caption', optional: true, max: 50 },
      { id: 'device', type: 'text', label: 'Frame (browser/phone)', optional: true },
    ],
    build: (f, c) => {
      const { u, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const phone = f.device === 'phone';
      const titleH = f.title ? Math.round(140 * u) : 0;
      const availH = c.height - pad.t - pad.b - titleH;
      const fh = availH;
      const fw = phone ? Math.round(fh * 0.49) : c.width - pad.l - pad.r;
      return {
        markup:
          b.markup +
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round(76 * u)}px">${words(f.title)}</h2>` : ''}<div class="dev" style="left:${(c.width - fw) / 2}px;top:${pad.t + titleH}px;width:${fw}px;height:${fh}px"><img src="${img(f.image, c)}" alt=""></div>`,
        css:
          b.css +
          headCss(S) +
          `${S} .dev{position:absolute;overflow:hidden;background:#fff;border-radius:${Math.round((phone ? 54 : 20) * u)}px;box-shadow:0 0 0 ${Math.round((phone ? 12 : 1) * u)}px #0d0e12,0 ${50 * u}px ${100 * u}px -${30 * u}px rgba(0,0,0,.7)}
${S} .dev img{display:block;width:100%;height:auto}`,
        js: b.js + wordIn(S, '.cap', 0.05) + `tl.fromTo("${S} .dev",{y:${60 * u},opacity:0},{y:0,opacity:1,duration:.9,ease:"expo.out"},.1);const im=document.querySelector("${S} .dev img");const sc={p:0};tl.fromTo(sc,{p:0},{p:1,duration:${Math.max(1.5, c.duration - 1.6)},ease:"power2.inOut",onUpdate:()=>{const max=Math.max(0,im.offsetHeight-im.parentElement.offsetHeight);im.style.transform="translateY("+(-max*sc.p)+"px)"}},.9);`,
      };
    },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    use: 'A command typed into a terminal and its output streaming back — for CLIs, SDKs and dev tools. Real commands from the README only.',
    minSeconds: 3.6,
    fields: [
      { id: 'title', type: 'text', label: 'Caption title', optional: true, max: 60 },
      { id: 'command', type: 'text', label: 'Command', max: 70 },
      { id: 'output', type: 'list', label: 'Output lines', max: 6, help: 'Prefix a line with ✓ or ✗ for a coloured status' },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const lines = list(f.output).slice(0, 6);
      const titleH = f.title ? Math.round((vertical ? 170 : 140) * u) : 0;
      const fs = Math.round((vertical ? 36 : 46) * u);
      const cmd = String(f.command ?? '');
      const typeDur = Math.min(1.4, 0.035 * cmd.length + 0.3);
      return {
        markup:
          b.markup +
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round((vertical ? 80 : 76) * u)}px">${words(f.title)}</h2>` : ''}
<div class="term" style="left:${pad.l}px;right:${pad.r}px;top:${pad.t + titleH}px;font-size:${fs}px"><div class="tb"><i></i><i></i><i></i></div><div class="tt"><div class="ln cmd"><span class="pr">$</span> <span class="ty">${esc(cmd)}</span><span class="caret"></span></div>${lines
            .map((l) => `<div class="ln out${/^✓/.test(l) ? ' ok' : /^✗/.test(l) ? ' bad' : ''}">${esc(l)}</div>`)
            .join('')}</div></div>`,
        css:
          b.css +
          headCss(S) +
          `${S} .term{position:absolute;border-radius:${Math.round(18 * u)}px;overflow:hidden;background:#0d0f14;border:1px solid rgba(255,255,255,.1);box-shadow:0 ${40 * u}px ${100 * u}px -${30 * u}px rgba(0,0,0,.75);font-family:var(--font-mono)}
${S} .tb{height:${Math.round(40 * u)}px;display:flex;align-items:center;gap:${Math.round(9 * u)}px;padding:0 ${Math.round(16 * u)}px;background:#181b23}
${S} .tb i{width:${Math.round(12 * u)}px;height:${Math.round(12 * u)}px;border-radius:50%;background:#3a3e4a}
${S} .tt{padding:${Math.round(28 * u)}px ${Math.round(32 * u)}px ${Math.round(34 * u)}px;line-height:1.55;color:#e7e9ee}
${S} .ln{white-space:pre-wrap;overflow-wrap:anywhere}
${S} .pr{color:${readableOnDark(c.brand.colors.primary, '#0d0f14')}}
${S} .ty{display:inline-block;overflow:hidden;white-space:pre;vertical-align:bottom;max-width:0}
${S} .caret{display:inline-block;width:.55em;height:1.1em;vertical-align:-.15em;background:#e7e9ee;margin-left:.08em}
${S} .out{color:#a5acbb;opacity:0}${S} .out.ok{color:#5ee08f}${S} .out.bad{color:#ff7a7a}`,
        js:
          b.js +
          wordIn(S, '.cap', 0.05) +
          `tl.fromTo("${S} .term",{y:${50 * u},opacity:0},{y:0,opacity:1,duration:.8,ease:"expo.out"},.1);
const ty=document.querySelector("${S} .ty");const full=ty.scrollWidth;
tl.fromTo(ty,{maxWidth:0},{maxWidth:full+2,duration:${typeDur.toFixed(2)},ease:"steps(${Math.max(cmd.length, 1)})"},.55);
tl.fromTo("${S} .caret",{opacity:1},{opacity:0,duration:.01,repeat:${Math.max(2, Math.floor(c.duration * 2))},yoyo:true,repeatDelay:.5},0);
tl.fromTo("${S} .out",{opacity:0,y:${8 * u}},{opacity:1,y:0,duration:.18,ease:"power2.out",stagger:${Math.max(0.12, Math.min(0.32, (c.duration - typeDur - 1.4) / Math.max(lines.length, 1))).toFixed(2)}},${(0.75 + typeDur).toFixed(2)});`,
      };
    },
  },
  {
    id: 'chart',
    label: 'Animated bar chart',
    use: 'Compare 2–5 real numbers (benchmarks, before/after, pricing). Bars grow in; the hero bar is highlighted. Values must come from the brief.',
    minSeconds: 3.6,
    fields: [
      { id: 'title', type: 'text', label: 'Title', max: 60 },
      { id: 'items', type: 'list', label: 'Bars ("Label — 42")', max: 5, help: 'One per line: label, a dash, the number (units after the number are kept, e.g. "Bun — 0.21s")' },
      { id: 'highlight', type: 'text', label: 'Highlight label', optional: true, help: 'Which bar is yours' },
      { id: 'note', type: 'text', label: 'Source / note', optional: true, max: 90 },
    ],
    build: (f, c) => {
      const { u, vertical, S } = frame(c);
      const b = bg(c, 'dark');
      const rows = list(f.items)
        .slice(0, 5)
        .map((l) => {
          const [label, val] = l.split(/\s+[—–-]\s+/);
          const m = String(val ?? '').match(/([\d.,]+)/);
          return { label: (label ?? '').trim(), text: (val ?? '').trim(), n: m ? Number(m[1].replace(/,/g, '')) : 0 };
        });
      const max = Math.max(...rows.map((r) => r.n), 1);
      const hi = String(f.highlight ?? '').toLowerCase();
      const accent = readableOnDark(c.brand.colors.primary);
      return {
        markup:
          b.markup +
          stage(
            c,
            `<h2 style="font-size:${Math.round((vertical ? 88 : 84) * u)}px;margin-bottom:${Math.round(48 * u)}px">${words(f.title)}</h2><div class="bars">${rows
              .map((r, i) => `<div class="row${r.label.toLowerCase() === hi || (!hi && i === 0) ? ' hi' : ''}"><span class="lb">${esc(r.label)}</span><span class="track"><i class="bar" style="width:${Math.max(2, (r.n / max) * 100).toFixed(1)}%"></i></span><span class="val">${esc(r.text)}</span></div>`)
              .join('')}</div>${f.note ? `<p class="sub" style="font-size:${Math.round(28 * u)}px;margin-top:${Math.round(30 * u)}px">${esc(f.note)}</p>` : ''}`,
          ),
        css:
          b.css +
          headCss(S) +
          `${S} .bars{display:grid;gap:${Math.round(30 * u)}px;width:100%}
${S} .row{display:grid;grid-template-columns:${Math.round((vertical ? 210 : 260) * u)}px 1fr ${Math.round(170 * u)}px;align-items:center;gap:${Math.round(20 * u)}px;font-family:var(--font-display);font-size:${Math.round(42 * u)}px;font-weight:700}
${S} .lb{opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .track{height:${Math.round(64 * u)}px;border-radius:${Math.round(14 * u)}px;background:rgba(255,255,255,.06);overflow:hidden}
${S} .bar{display:block;height:100%;border-radius:${Math.round(10 * u)}px;background:rgba(255,255,255,.28);transform-origin:0 50%}
${S} .row.hi .bar{background:${accent}}${S} .row.hi .lb,${S} .row.hi .val{opacity:1;color:${accent}}
${S} .val{font-variant-numeric:tabular-nums;text-align:right;opacity:.85}`,
        js:
          b.js +
          wordIn(S, 'h2', 0.05) +
          `tl.fromTo("${S} .row",{opacity:0,x:${-30 * u}},{opacity:1,x:0,duration:.5,ease:"expo.out",stagger:.1},.35);
tl.fromTo("${S} .bar",{scaleX:0},{scaleX:1,duration:1.1,ease:"expo.out",stagger:.12},.55);
tl.fromTo("${S} .row.hi .track",{boxShadow:"0 0 0 0 rgba(255,255,255,0)"},{boxShadow:"0 0 0 ${Math.max(2, Math.round(3 * u))}px ${accent}",duration:.4,ease:"power2.out"},1.7);` +
          has(`${S} .sub`, `tl.fromTo("${S} .sub",{opacity:0},{opacity:.72,duration:.5},1.6);`),
      };
    },
  },
  {
    id: 'logos',
    label: 'Logo storm',
    use: 'The tools/platforms your audience juggles today burst in around the frame, then collapse into your product. Best for "replaces N tools", "works with everything you use", integrations. 5–10 real names.',
    minSeconds: 4,
    fields: [
      { id: 'title', type: 'text', label: 'Title', optional: true, max: 50 },
      { id: 'items', type: 'list', label: 'Tools / platforms', help: 'One per line, real names (Slack, Notion, pip, Docker...)' },
      { id: 'punchline', type: 'text', label: 'Punchline under the logo', optional: true, max: 40 },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const items = list(f.items).slice(0, 12);
      const titleH = f.title ? Math.round((vertical ? 170 : 140) * u) : 0;
      const top = pad.t + titleH, bottom = c.height - pad.b;
      const cx = c.width / 2, cy = (top + bottom) / 2;
      const rx = (c.width - pad.l - pad.r) * (vertical ? 0.36 : 0.33), ry = (bottom - top) * 0.36;
      const tile = Math.round((vertical ? 200 : 178) * u);
      const tiles = items
        .map((name, i) => {
          const a = (i / items.length) * Math.PI * 2 - Math.PI / 2 + (i % 2 ? 0.18 : -0.12);
          const jx = ((i * 37) % 23) - 11, jy = ((i * 53) % 19) - 9;
          const x = cx + Math.cos(a) * rx + jx * u - tile / 2, y = cy + Math.sin(a) * ry + jy * u - tile / 2;
          const icon = c.icons?.[name];
          return `<div class="lt" data-dx="${Math.round(cx - tile / 2 - x)}" data-dy="${Math.round(cy - tile / 2 - y)}" style="left:${Math.round(x)}px;top:${Math.round(y)}px;width:${tile}px;height:${tile}px;--r:${((i * 7) % 11) - 5}deg">${icon ? `<i class="ic" style="background-image:url('${icon}')"></i>` : `<b class="mg">${esc(name[0] ?? '•')}</b>`}<span>${esc(name)}</span></div>`;
        })
        .join('');
      const hub = Math.round((vertical ? 300 : 260) * u);
      return {
        markup:
          b.markup +
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round((vertical ? 80 : 76) * u)}px;text-align:center">${words(f.title)}</h2>` : ''}${tiles}
<div class="hub" style="left:${cx - hub / 2}px;top:${cy - hub / 2}px;width:${hub}px;height:${hub}px">${logoMarkup(c, Math.round(hub * 0.5))}</div>
${f.punchline ? `<p class="pl" style="top:${cy + hub / 2 + 34 * u}px;font-size:${Math.round((vertical ? 64 : 58) * u)}px">${words(f.punchline, 'x')}</p>` : ''}`,
        css:
          b.css +
          headCss(S) +
          `${S} .lt{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(10 * u)}px;border-radius:${Math.round(28 * u)}px;background:rgba(255,255,255,.96);color:#14161c;box-shadow:0 ${Math.round(18 * u)}px ${Math.round(40 * u)}px -${Math.round(16 * u)}px rgba(0,0,0,.6);transform:rotate(var(--r))}
${S} .lt .ic{width:46%;height:46%;background:center/contain no-repeat}
${S} .lt .mg{width:46%;height:46%;display:grid;place-items:center;border-radius:50%;background:var(--brand-primary);color:var(--brand-on-primary);font:800 ${Math.round(40 * u)}px/1 var(--font-display)}
${S} .lt span{font:700 ${Math.round(24 * u)}px/1 var(--font-body);max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .hub{position:absolute;display:grid;place-items:center;border-radius:${Math.round(44 * u)}px;background:#fff;box-shadow:0 0 0 ${Math.round(10 * u)}px color-mix(in srgb,var(--brand-primary) 35%,transparent),0 ${Math.round(30 * u)}px ${Math.round(70 * u)}px -${Math.round(20 * u)}px rgba(0,0,0,.7)}
${S} .hub .logo{max-width:70%;object-fit:contain;color:#14161c}
${S} .pl{position:absolute;left:${pad.l}px;right:${pad.r}px;text-align:center;margin:0;font-family:var(--font-display);font-weight:800;letter-spacing:-.03em}`,
        js:
          b.js +
          wordIn(S, '.cap', 0.05) +
          `tl.fromTo("${S} .lt",{scale:0,opacity:0},{scale:1,opacity:1,duration:.55,ease:"back.out(1.8)",stagger:{each:.07,from:"random"}},.25);
tl.to("${S} .lt",{y:"-=${Math.round(14 * u)}",duration:${(c.duration * 0.3).toFixed(2)},ease:"sine.inOut",stagger:.05},.9);
tl.set("${S} .hub",{scale:0,opacity:0},0);
const tc=${Math.max(1.9, c.duration * 0.5).toFixed(2)};
tl.to("${S} .lt",{x:(i,el)=>+el.dataset.dx,y:(i,el)=>+el.dataset.dy-${Math.round(14 * u)},scale:.25,rotation:0,opacity:0,duration:.6,ease:"power3.in",stagger:{each:.025,from:"edges"}},tc);
tl.to("${S} .hub",{scale:1,opacity:1,duration:.7,ease:"back.out(1.6)"},tc+.45);` +
          has(`${S} .pl .x`, `tl.fromTo("${S} .pl .x",{yPercent:110},{yPercent:0,duration:.6,ease:"expo.out",stagger:.06},tc+.75);`),
      };
    },
  },
  {
    id: 'kinetic',
    label: 'Kinetic type slam',
    use: 'Two to four very short lines slam onto the screen one per beat, huge, with a colour hit on each. For a hook, a manifesto or a punchline. Lines of 1–3 words land hardest.',
    minSeconds: 2.4,
    fields: [{ id: 'lines', type: 'list', label: 'Lines', help: '2–4 lines, each ≤ 16 characters. *wrap* a line to make it the accent line.' }],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const lines = list(f.lines).slice(0, 4);
      const longest = Math.max(...lines.map((l) => l.replace(/\*/g, '').length), 4);
      const avail = c.width - pad.l - pad.r;
      const areaH = c.height - pad.t - pad.b;
      const size = Math.round(Math.min((avail / (longest * 0.56)), (areaH / lines.length) * 0.92, (vertical ? 230 : 250) * u));
      const beat = Math.min(0.55, Math.max(0.3, (c.duration - 1) / Math.max(1, lines.length)));
      return {
        markup:
          b.markup +
          `<div class="hit"></div>` +
          stage(
            c,
            lines
              .map((l, i) => {
                const acc = /^\*.*\*$/.test(l.trim());
                return `<div class="kl-m"><div class="kl${acc ? ' acc-line' : ''}${i % 2 && !acc ? ' dim' : ''}" style="font-size:${size}px">${esc(l.replace(/\*/g, ''))}</div></div>`;
              })
              .join(''),
          ),
        css:
          b.css +
          `${S} .hit{position:absolute;inset:0;background:var(--brand-primary);opacity:0;z-index:0}
${S} .stage{z-index:1;gap:${Math.round(4 * u)}px}
${S} .kl-m{overflow:hidden;padding:.02em 0 .06em}
${S} .kl{font-family:var(--font-display);font-weight:900;letter-spacing:-.05em;line-height:.92;text-transform:none;white-space:nowrap;will-change:transform}
${S} .kl.dim{opacity:.55}
${S} .kl.acc-line{color:${onColor(readableOnDark(c.brand.colors.primary))};background:${readableOnDark(c.brand.colors.primary)};padding:0 .12em;display:inline-block}`,
        js:
          b.js +
          `const ls=document.querySelectorAll("${S} .kl");ls.forEach((el,i)=>{const t=.15+i*${beat.toFixed(2)};
tl.fromTo(el,{yPercent:105,skewY:6},{yPercent:0,skewY:0,duration:.42,ease:"expo.out"},t);
tl.fromTo("${S} .hit",{opacity:.0},{opacity:.22,duration:.06,yoyo:true,repeat:1,ease:"none"},t);});
tl.fromTo("${S} .stage",{scale:1},{scale:1.05,duration:${c.duration},ease:"none",transformOrigin:"0% 50%"},0);`,
      };
    },
  },
  {
    id: 'stack3d',
    label: '3D card stack',
    use: 'Three to five features as cards in a 3D stack; each comes to the front in turn. For "how it works" steps or key features. Each card: "Title — one short line".',
    minSeconds: 4,
    fields: [
      { id: 'title', type: 'text', label: 'Title', optional: true, max: 50 },
      { id: 'cards', type: 'list', label: 'Cards', help: 'One per line: "Title — one short line" (3–5)' },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const cards = list(f.cards).slice(0, 5).map((l) => {
        const [t, ...rest] = l.split(/\s+[—–-]\s+|:\s+/);
        return { t: t.trim(), d: rest.join(' — ').trim() };
      });
      const titleH = f.title ? Math.round((vertical ? 170 : 140) * u) : 0;
      const top = pad.t + titleH, bottom = c.height - pad.b;
      const cw = Math.round(Math.min(c.width - pad.l - pad.r, (vertical ? 900 : 1040) * u));
      const ch = Math.round(Math.min((bottom - top) * 0.72, (vertical ? 560 : 420) * u));
      const cx = c.width / 2 - cw / 2, cy = top + (bottom - top) / 2 - ch / 2 + 40 * u;
      const n = cards.length;
      const slot = Math.max(0.9, (c.duration - 0.9) / n);
      return {
        markup:
          b.markup +
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round((vertical ? 80 : 76) * u)}px;text-align:center">${words(f.title)}</h2>` : ''}<div class="persp">${cards
            .map((k, i) => `<div class="cd" data-i="${i}" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px"><span class="no">${String(i + 1).padStart(2, '0')}</span><b>${esc(k.t)}</b>${k.d ? `<p>${esc(k.d)}</p>` : ''}</div>`)
            .join('')}</div>`,
        css:
          b.css +
          headCss(S) +
          `${S} .persp{position:absolute;inset:0;perspective:${Math.round(1800 * u)}px}
${S} .cd{position:absolute;border-radius:${Math.round(34 * u)}px;padding:${Math.round(48 * u)}px ${Math.round(56 * u)}px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(16 * u)}px;
  background:#f6f7f9;color:#121317;border:1px solid rgba(255,255,255,.5);box-shadow:0 ${Math.round(40 * u)}px ${Math.round(80 * u)}px -${Math.round(30 * u)}px rgba(0,0,0,.8);transform-style:preserve-3d}
${S} .cd .no{align-self:flex-start;font:800 ${Math.round(30 * u)}px/1 var(--font-display);padding:${Math.round(10 * u)}px ${Math.round(16 * u)}px;border-radius:999px;background:var(--brand-primary);color:var(--brand-on-primary)}
${S} .cd.back{background:#2a2d36;color:#cfd3dc}
${S} .cd b{font:800 ${Math.round((vertical ? 96 : 92) * u)}px/1.02 var(--font-display);letter-spacing:-.035em}
${S} .cd p{margin:0;font:500 ${Math.round((vertical ? 46 : 42) * u)}px/1.3 var(--font-body);opacity:.78;max-width:30ch}`,
        js:
          b.js +
          wordIn(S, '.cap', 0.05) +
          `const cds=[...document.querySelectorAll("${S} .cd")];const n=${n},D=${Math.round(170 * u)},Y=${Math.round(-78 * u)};
const place=(k)=>({z:-k*D,y:k*Y,rotationX:k?6:0,opacity:k>2?0:1,scale:1});
cds.forEach((el,i)=>{tl.set(el,{...place(i),zIndex:n-i,transformPerspective:${Math.round(1800 * u)},className:i?'cd back':'cd'},0);});
tl.fromTo(cds,{y:"+=${Math.round(120 * u)}",opacity:0},{y:(i)=>i*Y,opacity:(i)=>i>2?0:1,duration:.7,ease:"expo.out",stagger:.08},.1);
for(let s=1;s<n;s++){const t=.4+s*${slot.toFixed(2)};
  tl.to(cds[s-1],{y:${Math.round(-c.height * 0.55)},rotationX:-28,opacity:0,duration:.55,ease:"power3.in"},t-.35);
  cds.slice(s).forEach((el,j)=>{const p=place(j);tl.to(el,{z:p.z,y:p.y,rotationX:p.rotationX,opacity:p.opacity,duration:.6,ease:"power3.out"},t-.15);if(!j)tl.set(el,{className:'cd'},t-.15);});}`,
      };
    },
  },
  {
    id: 'broll',
    label: 'Stock B-roll',
    use: 'Real stock footage behind one line, for long videos and stories (a city at night, hands typing, a crowded inbox). Give a concrete visual search `query`. Needs a stock key (Pixabay, or Pexels) in Setup; otherwise it becomes a cinematic shot automatically. Use sparingly: max ~1 in 4 scenes.',
    minSeconds: 3,
    fields: [
      { id: 'query', type: 'text', label: 'Footage search', max: 60, help: 'Concrete and visual: "developer typing at night", "busy train station"' },
      { id: 'video', type: 'image', label: 'Own clip (.mp4) instead of stock', optional: true, help: 'A generated presenter or product clip from media.mjs gen, path relative to the brief folder or absolute' },
      { id: 'audio', type: 'text', label: 'Play the clip\'s sound (yes/no)', optional: true, help: 'yes for a talking presenter — then give this scene no voiceover line' },
      { id: 'line', type: 'text', label: 'On-screen line', optional: true, max: 90 },
      { id: 'kicker', type: 'text', label: 'Kicker', optional: true, max: 40 },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const size = fit(f.line, u, vertical ? [[40, 80], [70, 68], [90, 60]] : [[40, 84], [70, 72], [90, 64]], 56);
      return {
        markup: `<i class="scrim"></i>${f.line ? `<div class="txt" style="left:${pad.l}px;right:${pad.r}px;bottom:${pad.b + Math.round(20 * u)}px">${f.kicker ? `<span class="k">${esc(f.kicker)}</span>` : ''}<p style="font-size:${size}px">${words(f.line)}</p></div>` : ''}`,
        css: `${S}{position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;overflow:hidden;color:#fff;font-family:var(--font-body)}
${S} .scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,transparent 30%,transparent 50%,rgba(0,0,0,.72) 100%)}
${S} .txt{position:absolute;text-align:${vertical ? 'center' : 'left'}}
${S} .txt .k{display:block;font:700 ${Math.round(26 * u)}px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;opacity:.8;margin-bottom:${Math.round(16 * u)}px}
${S} .txt p{margin:0;font-family:var(--font-display);font-weight:750;letter-spacing:-.02em;line-height:1.12;max-width:22ch;${vertical ? 'margin:0 auto;' : ''}text-shadow:0 2px 30px rgba(0,0,0,.65)}
${S} .w-m{display:inline-block;overflow:hidden;vertical-align:top}${S} .w{display:inline-block}`,
        js: wordIn(S, '.txt p', 0.35) + has(`${S} .k`, `tl.fromTo("${S} .k",{opacity:0},{opacity:.8,duration:.6},.2);`),
      };
    },
  },
  {
    id: 'character',
    label: 'Animated presenter',
    use: 'A friendly brand-coloured mascot explains one point in a speech bubble; its mouth moves with the voiceover and it gestures. For character-driven explainers, tutorials and stories. Poses: explain, wave, point, think, celebrate. Keep the bubble ≤ 90 chars and let the voice line say the same idea.',
    minSeconds: 3,
    fields: [
      { id: 'line', type: 'text', label: 'Speech bubble', max: 90 },
      { id: 'pose', type: 'text', label: 'Pose', optional: true, help: 'explain | wave | point | think | celebrate' },
      { id: 'side', type: 'text', label: 'Side', optional: true, help: 'left | right' },
      { id: 'look', type: 'text', label: 'Mascot', optional: true, help: 'blob | bot | orb | note — keep one look per video' },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'light');
      const pose = ['wave', 'point', 'think', 'celebrate', 'explain'].includes(String(f.pose)) ? String(f.pose) : 'explain';
      const right = String(f.side) === 'right';
      const body = c.brand.colors.primary;
      const dark = luminance(body) < 0.4;
      const ch = Math.round((vertical ? 860 : 720) * u);
      const cw = Math.round(ch * 0.7);
      const cx = vertical ? (c.width - cw) / 2 : right ? c.width - pad.r - cw : pad.l;
      const cy = vertical ? c.height - pad.b - ch + 40 * u : (c.height - ch) / 2 + 60 * u;
      const bw = vertical ? c.width - pad.l - pad.r : c.width - pad.l - pad.r - cw - 80 * u;
      const bx = vertical ? pad.l : right ? pad.l : pad.l + cw + 80 * u;
      const by = vertical ? pad.t + 40 * u : c.height * 0.2;
      const size = fit(f.line, u, vertical ? [[40, 84], [70, 72], [90, 64]] : [[40, 80], [70, 68], [90, 60]], 54);
      const look = ['bot', 'orb', 'note'].includes(String(f.look)) ? String(f.look) : 'blob';
      const eye = look === 'note' ? '#23252b' : look === 'bot' ? '#7CF0C0' : dark ? '#fff' : '#14161c';
      // Face height per look (eyes, mouth); arms and gestures are shared.
      const fy = look === 'bot' ? -14 : look === 'orb' ? 10 : look === 'note' ? 4 : 0;
      const armC = look === 'note' ? '#23252b' : body;
      const shape: Record<string, string> = {
        blob: `<rect x="22" y="40" width="96" height="148" rx="48" fill="${body}"/><ellipse cx="70" cy="58" rx="30" ry="12" fill="#fff" opacity=".18"/>`,
        bot: `<line x1="70" y1="40" x2="70" y2="20" stroke="${body}" stroke-width="5"/><circle cx="70" cy="16" r="7" fill="#FFD84D"/><rect x="34" y="122" width="72" height="66" rx="16" fill="${body}"/><rect x="20" y="38" width="100" height="84" rx="20" fill="${body}"/><rect x="32" y="52" width="76" height="56" rx="12" fill="#14161c"/>`,
        orb: `<ellipse cx="70" cy="34" rx="30" ry="8" fill="none" stroke="#FFD84D" stroke-width="5"/><circle cx="70" cy="122" r="62" fill="${body}"/><ellipse cx="54" cy="88" rx="18" ry="10" fill="#fff" opacity=".2"/>`,
        note: `<rect x="24" y="48" width="92" height="132" fill="#FFE680"/><path d="M116 156 L92 180 L116 180 Z" fill="#E8C94A"/><rect x="52" y="40" width="38" height="14" fill="rgba(255,255,255,.7)" transform="rotate(-4 71 47)"/>`,
      };
      // Mascot: rounded body in the brand colour, face, two arms; drawn on a 140×200 grid.
      const svg = `<svg class="mascot" viewBox="0 0 140 200" width="${cw}" height="${ch}" style="left:${cx}px;top:${cy}px">
<ellipse cx="70" cy="194" rx="46" ry="6" fill="rgba(0,0,0,.14)"/>
<g class="bodyg">
<g class="armL"><path d="M30 108 Q14 124 20 144" stroke="${armC}" stroke-width="${look === 'note' ? 5 : 13}" stroke-linecap="round" fill="none"/></g>
<g class="armR"><path d="M110 108 Q126 124 120 144" stroke="${armC}" stroke-width="${look === 'note' ? 5 : 13}" stroke-linecap="round" fill="none"/></g>
${shape[look]}
<g class="face" transform="translate(0 ${fy})"><g class="eyes"><ellipse class="eye" cx="54" cy="92" rx="6.5" ry="8" fill="${eye}"/><ellipse class="eye" cx="86" cy="92" rx="6.5" ry="8" fill="${eye}"/></g>
<ellipse class="mouth" cx="70" cy="${look === 'bot' ? 112 : 118}" rx="10" ry="3" fill="${eye}"/>
${look === 'bot' ? '' : '<circle cx="45" cy="110" r="6" fill="#ff7a9a" opacity=".35"/><circle cx="95" cy="110" r="6" fill="#ff7a9a" opacity=".35"/>'}</g>
${pose === 'think' ? '<g class="prop"><circle cx="122" cy="30" r="5" fill="#bbb"/><circle cx="132" cy="14" r="8" fill="#ccc"/></g>' : ''}
${pose === 'celebrate' ? '<g class="prop"><path d="M14 30 l6 -12 l6 12 z" fill="#FFD84D"/><path d="M118 22 l6 -12 l6 12 z" fill="#5BD6A0"/><circle cx="30" cy="16" r="4" fill="#ff7a9a"/><circle cx="110" cy="40" r="4" fill="#7aa7ff"/></g>' : ''}
</g></svg>`;
      const armJs: Record<string, string> = {
        explain: `tl.to("${S} .armR",{rotation:-28,duration:.45,ease:"power2.out",svgOrigin:"110 108",yoyo:true,repeat:${Math.max(1, Math.floor(c.duration / 0.9))}},.3);`,
        wave: `tl.to("${S} .armR",{rotation:-150,duration:.3,ease:"power2.out",svgOrigin:"110 108"},.2);tl.to("${S} .armR",{rotation:-115,duration:.22,ease:"sine.inOut",svgOrigin:"110 108",yoyo:true,repeat:${Math.max(3, Math.floor(c.duration / 0.45))}},.5);`,
        point: `tl.to("${S} ${right ? '.armL' : '.armR'}",{rotation:${right ? 100 : -100},duration:.35,ease:"back.out(2)",svgOrigin:"${right ? '30 108' : '110 108'}"},.25);`,
        think: `tl.to("${S} .armL",{rotation:150,duration:.4,ease:"power2.out",svgOrigin:"30 108"},.2);tl.fromTo("${S} .prop circle",{scale:0,transformOrigin:"50% 50%"},{scale:1,duration:.3,stagger:.15,ease:"back.out(2)"},.5);`,
        celebrate: `tl.to(["${S} .armL","${S} .armR"],{rotation:(i)=>i?-150:150,duration:.3,ease:"back.out(2)",svgOrigin:(i)=>i?"110 108":"30 108"},.2);tl.fromTo("${S} .prop > *",{y:20,opacity:0},{y:0,opacity:1,duration:.4,stagger:.06,ease:"back.out(2)"},.3);tl.to("${S} .bodyg",{y:-14,duration:.25,yoyo:true,repeat:3,ease:"power1.inOut"},.3);`,
      };
      // Lip-sync: open the mouth for every spoken word, close between them.
      const talk = (c.talk ?? []).filter((w) => w.start < c.duration);
      const mouth = talk.length
        ? talk.map((w) => `tl.to("${S} .mouth",{attr:{ry:${(6 + (w.text.length % 3) * 2).toFixed(0)}},duration:.07},${w.start.toFixed(2)});tl.to("${S} .mouth",{attr:{ry:3},duration:.07},${Math.max(w.start + 0.08, w.end - 0.04).toFixed(2)});`).join('')
        : `tl.to("${S} .mouth",{attr:{ry:7},duration:.12,yoyo:true,repeat:${Math.max(3, Math.floor(c.duration / 0.25))}},.3);`;
      const reveal = talk.length ? `const ws=document.querySelectorAll("${S} .bub .w");const tt=${JSON.stringify(talk.map((w) => +w.start.toFixed(2)))};ws.forEach((w,i)=>tl.fromTo(w,{opacity:.15},{opacity:1,duration:.15},tt[Math.min(i,tt.length-1)]??(.4+i*.08)));` : `tl.fromTo("${S} .bub .w",{opacity:.15},{opacity:1,duration:.2,stagger:.07},.4);`;
      return {
        markup: b.markup + svg + `<div class="bub ${right && !vertical ? 'r' : ''}" style="left:${bx}px;top:${by}px;width:${bw}px"><p class="nofit" style="font-size:${size}px">${words(f.line)}</p></div>`,
        css:
          b.css +
          `${S} .mascot{position:absolute;overflow:visible;filter:drop-shadow(0 ${Math.round(20 * u)}px ${Math.round(30 * u)}px rgba(0,0,0,.18))}
${S} .bub{position:absolute;box-sizing:border-box;background:#fff;color:#14161c;border-radius:${Math.round(36 * u)}px;padding:${Math.round(40 * u)}px ${Math.round(48 * u)}px;box-shadow:0 ${Math.round(24 * u)}px ${Math.round(60 * u)}px -${Math.round(24 * u)}px rgba(0,0,0,.35)}
${S} .bub::after{content:"";position:absolute;${vertical ? `left:50%;bottom:-${Math.round(26 * u)}px;margin-left:-${Math.round(20 * u)}px;border-top:${Math.round(28 * u)}px solid #fff;border-left:${Math.round(20 * u)}px solid transparent;border-right:${Math.round(20 * u)}px solid transparent` : `top:${Math.round(70 * u)}px;${right ? 'right' : 'left'}:-${Math.round(26 * u)}px;border-${right ? 'left' : 'right'}:${Math.round(30 * u)}px solid #fff;border-top:${Math.round(18 * u)}px solid transparent;border-bottom:${Math.round(18 * u)}px solid transparent`}}
${S} .bub p{margin:0;font-family:var(--font-display);font-weight:750;letter-spacing:-.02em;line-height:1.15}
${S} .w-m{display:inline-block}${S} .w{display:inline-block}`,
        js:
          b.js +
          `tl.fromTo("${S} .mascot",{y:${Math.round(120 * u)},opacity:0},{y:0,opacity:1,duration:.6,ease:"back.out(1.6)"},0);
tl.fromTo("${S} .bub",{scale:.6,opacity:0,transformOrigin:"${vertical ? '50% 100%' : right ? '100% 30%' : '0% 30%'}"},{scale:1,opacity:1,duration:.45,ease:"back.out(1.8)"},.25);
tl.to("${S} .bodyg",{y:-6,duration:.9,yoyo:true,repeat:${Math.max(1, Math.floor(c.duration / 0.9))},ease:"sine.inOut"},.6);
tl.to("${S} .eye",{attr:{ry:1},duration:.06,yoyo:true,repeat:1,transformOrigin:"50% 50%"},${Math.min(1.6, c.duration * 0.4).toFixed(2)});
tl.to("${S} .eye",{attr:{ry:1},duration:.06,yoyo:true,repeat:1},${Math.max(0.5, c.duration - 1.2).toFixed(2)});` +
          (armJs[pose] ?? '') +
          mouth +
          reveal,
      };
    },
  },
  {
    id: 'cinema',
    label: 'Cinematic shot',
    use: 'Short-film moment: letterboxed frame, slow camera drift over a real image (or a moody gradient), film grain, one narrative line fading in. For stories, origin tales, "imagine…" openings. Line ≤ 90 chars.',
    minSeconds: 3,
    fields: [
      { id: 'line', type: 'text', label: 'Narrative line', max: 90 },
      { id: 'kicker', type: 'text', label: 'Place / time', optional: true, max: 40, help: 'e.g. "Tuesday, 11:42 pm"' },
      { id: 'image', type: 'image', label: 'Image', optional: true },
    ],
    build: (f, c) => {
      const { u, vertical, S } = frame(c);
      const bar = Math.round(vertical ? c.height * 0.09 : c.height * 0.11);
      const src = f.image ? img(f.image, c) : '';
      const size = fit(f.line, u, vertical ? [[40, 80], [70, 68], [90, 60]] : [[40, 84], [70, 72], [90, 64]], 56);
      const grad = `radial-gradient(70% 60% at 30% 35%, color-mix(in srgb,var(--brand-primary) 38%,transparent), transparent 70%),radial-gradient(60% 60% at 80% 80%, color-mix(in srgb,var(--brand-secondary) 30%,transparent), transparent 70%),#07080b`;
      return {
        markup: `<div class="shot">${src ? `<img src="${src}" alt="">` : `<i class="gr"></i>${Array.from({ length: 9 }, (_, k) => `<b class="bk" style="left:${(k * 37 + 11) % 92}%;top:${(k * 53 + 17) % 78}%;width:${Math.round((60 + ((k * 29) % 110)) * u)}px;height:${Math.round((60 + ((k * 29) % 110)) * u)}px;opacity:${(0.12 + ((k * 7) % 5) * 0.05).toFixed(2)}"></b>`).join('')}`}</div><i class="vig"></i><i class="grain"></i><i class="lb t"></i><i class="lb b"></i>
<div class="txt" style="bottom:${bar + Math.round(56 * u)}px">${f.kicker ? `<span class="k">${esc(f.kicker)}</span>` : ''}<p style="font-size:${size}px">${words(f.line)}</p></div>`,
        css: `${S}{position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;overflow:hidden;background:#07080b;color:#f4f1ea;font-family:var(--font-body)}
${S} .shot,${S} .shot img,${S} .shot .gr{position:absolute;inset:0;width:100%;height:100%}
${S} .shot img{object-fit:cover;filter:saturate(.8) contrast(1.05) brightness(.7)}
${S} .shot .gr{background:${grad}}
${S} .bk{position:absolute;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--brand-primary) 70%,#fff) 0%,transparent 70%);filter:blur(${Math.round(6 * u)}px)}
${S} .vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.75) 100%)}
${S} .grain{position:absolute;inset:-20%;opacity:.13;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
${S} .lb{position:absolute;left:0;right:0;height:${bar}px;background:#000;z-index:3}${S} .lb.t{top:0}${S} .lb.b{bottom:0}
${S} .txt{position:absolute;left:${Math.round(110 * u)}px;right:${Math.round(110 * u)}px;z-index:4;text-align:${vertical ? 'center' : 'left'}}
${S} .txt .k{display:block;font:600 ${Math.round(26 * u)}px/1 var(--font-mono, ui-monospace);letter-spacing:.18em;text-transform:uppercase;opacity:.7;margin-bottom:${Math.round(18 * u)}px}
${S} .txt p{margin:0;font-family:var(--font-display);font-weight:600;letter-spacing:-.015em;line-height:1.18;max-width:24ch;${vertical ? 'margin:0 auto;' : ''}text-shadow:0 2px 24px rgba(0,0,0,.6)}
${S} .w-m{display:inline-block}${S} .w{display:inline-block}`,
        js: `tl.fromTo("${S} .shot",{scale:1.12,xPercent:-2},{scale:1.02,xPercent:2,duration:${c.duration},ease:"none"},0);
` + has(`${S} .bk`, `tl.fromTo("${S} .bk",{x:0,y:0},{x:(i)=>((i%3)-1)*${Math.round(70 * u)},y:(i)=>-${Math.round(30 * u)}-(i%4)*${Math.round(12 * u)},duration:${c.duration},ease:"none"},0);`) + `
tl.fromTo("${S} .grain",{x:0},{x:${Math.round(-40 * u)},duration:${c.duration},ease:"steps(${Math.max(8, Math.round(c.duration * 12))})"},0);
tl.fromTo("${S} .lb.t",{yPercent:-100},{yPercent:0,duration:.7,ease:"power3.out"},0);tl.fromTo("${S} .lb.b",{yPercent:100},{yPercent:0,duration:.7,ease:"power3.out"},0);` +
          has(`${S} .k`, `tl.fromTo("${S} .k",{opacity:0,y:${10 * u}},{opacity:.7,y:0,duration:.8,ease:"power2.out"},.4);`) +
          `tl.fromTo("${S} .txt .w",{opacity:0,filter:"blur(8px)"},{opacity:1,filter:"blur(0px)",duration:.7,ease:"power2.out",stagger:.09},.6);`,
      };
    },
  },
  {
    id: 'chapter',
    label: 'Chapter card',
    use: 'Opens a chapter in a long video: big chapter number, the chapter title, and progress through the video. Added automatically for chapters; use directly only for a manual section break.',
    minSeconds: 2.2,
    fields: [
      { id: 'number', type: 'number', label: 'Chapter number' },
      { id: 'title', type: 'text', label: 'Chapter title', max: 60 },
      { id: 'total', type: 'number', label: 'Total chapters', optional: true },
    ],
    build: (f, c) => {
      const { u, vertical, pad, S } = frame(c);
      const b = bg(c, 'dark');
      const n = Math.max(1, Number(f.number) || 1);
      const total = Math.max(n, Number(f.total) || n);
      const accent = readableOnDark(c.brand.colors.primary);
      const size = fit(f.title, u, vertical ? [[18, 130], [34, 108], [60, 88]] : [[18, 140], [34, 116], [60, 92]], 80);
      return {
        markup:
          b.markup +
          stage(
            c,
            `<div class="cn">${String(n).padStart(2, '0')}</div><h2 style="font-size:${size}px">${words(f.title)}</h2><div class="dots">${Array.from({ length: total }, (_, i) => `<i class="${i < n - 1 ? 'past' : i === n - 1 ? 'now' : ''}"></i>`).join('')}</div>`,
          ),
        css:
          b.css +
          headCss(S) +
          `${S} .cn{font:900 ${Math.round((vertical ? 300 : 280) * u)}px/.82 var(--font-display);letter-spacing:-.06em;color:transparent;-webkit-text-stroke:${Math.round(3 * u)}px ${accent};margin-bottom:${Math.round(26 * u)}px}
${S} .dots{display:flex;gap:${Math.round(12 * u)}px;margin-top:${Math.round(52 * u)}px}
${S} .dots i{width:${Math.round(44 * u)}px;height:${Math.round(8 * u)}px;border-radius:99px;background:rgba(255,255,255,.18)}
${S} .dots i.past{background:rgba(255,255,255,.55)}${S} .dots i.now{background:${accent};width:${Math.round(88 * u)}px}`,
        js:
          b.js +
          `tl.fromTo("${S} .cn",{xPercent:-12,opacity:0},{xPercent:0,opacity:1,duration:.8,ease:"expo.out"},.05);` +
          wordIn(S, 'h2', 0.3) +
          `tl.fromTo("${S} .dots i",{scaleX:0},{scaleX:1,duration:.4,ease:"power3.out",stagger:.04,transformOrigin:"0% 50%"},.6);
tl.fromTo("${S} .stage",{scale:1},{scale:1.04,duration:${c.duration},ease:"none",transformOrigin:"0% 50%"},0);`,
      };
    },
  },
  {
    id: 'outro',
    label: 'Logo + CTA outro',
    use: 'Last scene. Logo, closing line, a button and the URL. Hold ≥ 2.5 s.',
    minSeconds: 3,
    fields: [
      { id: 'title', type: 'text', label: 'Closing line', max: 60 },
      { id: 'cta', type: 'text', label: 'Button', optional: true, max: 28 },
      { id: 'url', type: 'text', label: 'URL', optional: true, max: 60 },
    ],
    build: (f, c) => {
      const { u, S } = frame(c);
      const b = bg(c, 'brand');
      return {
        markup: b.markup + stage(c, `<div class="lg">${logoMarkup(c, Math.round(96 * u))}</div><h2 style="font-size:${fit(f.title, u, [[20, 120], [40, 96], [60, 80]], 70)}px;margin-top:${Math.round(44 * u)}px">${words(f.title)}</h2>${f.cta ? `<span class="btn" style="font-size:${Math.round(38 * u)}px;margin-top:${Math.round(48 * u)}px;padding:${Math.round(24 * u)}px ${Math.round(44 * u)}px">${esc(f.cta)}</span>` : ''}${f.url ? `<span class="url" style="font-size:${Math.round(32 * u)}px;margin-top:${Math.round(26 * u)}px">${esc(f.url)}</span>` : ''}`, 'center'),
        css: b.css + headCss(S) + `${S} .lg img.logo{background:#fff;border-radius:20%;padding:8%;box-shadow:0 12px 40px -16px rgba(0,0,0,.45)}${S} .btn{display:inline-block;border-radius:999px;background:var(--brand-on-primary);color:var(--brand-primary);font-weight:800;letter-spacing:-.01em}${S} .url{display:block;font-family:var(--font-mono);opacity:.8}`,
        js: b.js + `tl.fromTo("${S} .lg",{scale:.5,opacity:0,rotate:-8},{scale:1,opacity:1,rotate:0,duration:.8,ease:"back.out(1.6)"},.05);` + wordIn(S, 'h2', 0.4) + has(`${S} .btn`, `tl.fromTo("${S} .btn",{y:${30 * u},opacity:0,scale:.92},{y:0,opacity:1,scale:1,duration:.6,ease:"back.out(1.6)"},.95);`) + has(`${S} .url`, `tl.fromTo("${S} .url",{opacity:0},{opacity:.8,duration:.5},1.25);`),
      };
    },
  },
  {
    id: 'logo-sting',
    label: 'Logo sting',
    use: 'Opening or closing brand moment, 1.5–3 s. Logo reveals through a mask with a light sweep.',
    minSeconds: 1.6,
    fields: [{ id: 'tagline', type: 'text', label: 'Tagline', optional: true, max: 50 }],
    build: (f, c) => {
      const { u, S } = frame(c);
      const b = bg(c, 'dark');
      return {
        markup: b.markup + stage(c, `<div class="lg">${logoMarkup(c, Math.round(150 * u))}<i class="sweep"></i></div>${f.tagline ? `<p class="tag" style="font-size:${Math.round(44 * u)}px;margin-top:${Math.round(36 * u)}px">${words(f.tagline)}</p>` : ''}`, 'center'),
        css: b.css + headCss(S) + `${S} .lg{position:relative;overflow:hidden;padding:${Math.round(10 * u)}px}${S} .sweep{position:absolute;top:-20%;bottom:-20%;width:30%;left:-40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg)}${S} .tag{font-weight:600;opacity:.85}`,
        js: b.js + `tl.fromTo("${S} .lg",{clipPath:"inset(0 50% 0 50%)",scale:1.12},{clipPath:"inset(0 0% 0 0%)",scale:1,duration:.9,ease:"expo.out"},.05);tl.fromTo("${S} .sweep",{left:"-40%"},{left:"130%",duration:.9,ease:"power2.inOut"},.6);` + wordIn(S, '.tag', 0.7),
      };
    },
  },
];

SCENES.push(...explainerScenes({ frame, bg, words, fit, img, headCss, has, wordIn, list, esc, readableOnDark }));

export function getScene(id: string): SceneDef {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene "${id}" (have: ${SCENES.map((x) => x.id).join(', ')})`);
  return s;
}

export { pathToFileURL };
