import { pathToFileURL } from 'node:url';
import { contrastRatio, onColor, type BrandKit, type SafeZone } from '@shipcast/engine';

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
  // Punctuation that followed an accented phrase ("*finished*.") hugs the previous word.
  return tokens
    .map(({ w, accent }, i) => `${i && !/^[.,!?;:…)%]+$/.test(w) ? ' ' : ''}<span class="${cls}-m"><span class="${cls}${accent ? ' acc' : ''}">${w}</span></span>`)
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
  const base = mode === 'brand' ? 'var(--brand-primary)' : mode === 'light' ? 'var(--brand-bg)' : 'color-mix(in srgb,var(--brand-bg) 12%,#08090d)';
  const ink = mode === 'brand' ? 'var(--brand-on-primary)' : mode === 'light' ? 'var(--brand-text)' : '#f4f5f8';
  return {
    markup: `<div class="bg"><i class="g1"></i><i class="g2"></i><i class="grain"></i></div>`,
    css: `${S}{position:absolute;inset:0;overflow:hidden;background:${base};color:${ink};font-family:var(--font-body)}
${S} .bg,${S} .bg i{position:absolute;inset:0}
${S} .bg .g1{inset:-20%;background:radial-gradient(40% 40% at 75% 25%,color-mix(in srgb,var(--brand-primary) ${mode === 'brand' ? 0 : mode === 'dark' ? 26 : 45}%,transparent),transparent 70%)}
${S} .bg .g2{inset:-20%;background:radial-gradient(45% 45% at 20% 85%,color-mix(in srgb,var(--brand-secondary) ${mode === 'brand' ? 25 : 30}%,transparent),transparent 70%)}
${S} .bg .grain{opacity:.08;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
${S} .acc{color:${mode === 'brand' ? ink : mode === 'dark' ? readableOnDark(c.brand.colors.primary) : 'var(--brand-primary)'}}
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
      const html = esc(f.text).replace(/\*([^*]+)\*/g, '<mark><span class="t">$1</span><span class="hl" aria-hidden="true">$1</span></mark>');
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
      const { u, S } = frame(c);
      const b = bg(c, 'brand');
      const m = String(f.value ?? '').match(/^([^\d]*)([\d.,]+)(.*)$/);
      const [pre, num, post] = m ? [m[1], m[2], m[3]] : ['', '', String(f.value ?? '')];
      const target = Number(num.replace(/,/g, '')) || 0;
      const decimals = num.includes('.') ? num.split('.')[1].length : 0;
      return {
        markup: b.markup + stage(c, `<div class="num" style="font-size:${Math.round((String(f.value).length > 5 ? 230 : 300) * u)}px">${esc(pre)}<span class="n">${esc(num || '')}</span>${esc(post)}</div><h2 style="font-size:${Math.round(64 * u)}px;margin-top:${Math.round(20 * u)}px">${words(f.label)}</h2>${f.context ? `<p class="sub" style="font-size:${Math.round(32 * u)}px;margin-top:${Math.round(24 * u)}px">${esc(f.context)}</p>` : ''}`),
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
      const titleH = f.title ? Math.round((vertical ? 150 : 120) * u) : 0;
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
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round((vertical ? 68 : 60) * u)}px">${words(f.title)}</h2>` : ''}
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
            `${f.title ? `<h2 style="font-size:${Math.round((vertical ? 84 : 76) * u)}px;margin-bottom:${Math.round(48 * u)}px">${words(f.title)}</h2>` : ''}<ul>${items
              .map((it) => `<li style="font-size:${Math.round((vertical ? 54 : 50) * u)}px"><b><svg viewBox="0 0 24 24" width="${Math.round(30 * u)}" height="${Math.round(30 * u)}"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></b><span>${esc(it)}</span></li>`)
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
      const size = fit(f.quote, u, [[60, 72], [110, 60], [160, 50]], 46);
      return {
        markup: b.markup + stage(c, `<div class="card"><div class="qm" style="font-size:${Math.round(200 * u)}px">“</div><p style="font-size:${size}px">${esc(f.quote)}</p><div class="who" style="font-size:${Math.round(32 * u)}px"><b>${esc(f.name)}</b>${f.role ? ` <span>· ${esc(f.role)}</span>` : ''}</div></div>`),
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
    use: 'Old way vs new way. 2–3 short lines per side. The old side greys out, the new side lands.',
    minSeconds: 4,
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
        js: b.js + `tl.fromTo("${S} .old",{y:${50 * u},opacity:0},{y:0,opacity:1,duration:.8,ease:"expo.out"},.05);tl.fromTo("${S} .old p",{opacity:0},{opacity:1,stagger:.12,duration:.4},.35);tl.to("${S} .old",{opacity:.45,filter:"grayscale(1)",duration:.6,ease:"power2.out"},1.6);tl.fromTo("${S} .new",{y:${70 * u},opacity:0,scale:.96},{y:0,opacity:1,scale:1,duration:.85,ease:"expo.out"},1.55);tl.fromTo("${S} .new p",{x:${-30 * u},opacity:0},{x:0,opacity:1,stagger:.14,duration:.55,ease:"expo.out"},1.85);`,
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
      const titleH = f.title ? Math.round(120 * u) : 0;
      const availH = c.height - pad.t - pad.b - titleH;
      const fh = availH;
      const fw = phone ? Math.round(fh * 0.49) : c.width - pad.l - pad.r;
      return {
        markup:
          b.markup +
          `${f.title ? `<h2 class="cap" style="position:absolute;left:${pad.l}px;right:${pad.r}px;top:${pad.t}px;font-size:${Math.round(60 * u)}px">${words(f.title)}</h2>` : ''}<div class="dev" style="left:${(c.width - fw) / 2}px;top:${pad.t + titleH}px;width:${fw}px;height:${fh}px"><img src="${img(f.image, c)}" alt=""></div>`,
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
        css: b.css + headCss(S) + `${S} .lg img.logo{background:var(--brand-on-primary);border-radius:20%;padding:8%}${S} .btn{display:inline-block;border-radius:999px;background:var(--brand-on-primary);color:var(--brand-primary);font-weight:800;letter-spacing:-.01em}${S} .url{display:block;font-family:var(--font-mono);opacity:.8}`,
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

export function getScene(id: string): SceneDef {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene "${id}" (have: ${SCENES.map((x) => x.id).join(', ')})`);
  return s;
}

export { pathToFileURL };
