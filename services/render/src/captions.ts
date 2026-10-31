import { onColor, type BrandKit, type SafeZone } from '@shipcast/engine';
import { esc } from './scenes.ts';

export interface Word {
  text: string;
  start: number;
  end: number;
}

export const CAPTION_STYLES = {
  karaoke: 'Karaoke — the whole phrase shows, the spoken word lights up',
  pop: 'Word pop — each word pops in as it is spoken',
  bold: 'Bold — uppercase 2–3 word chunks, heavy stroke, key word in accent (Hormozi style)',
  clean: 'Clean — sentence case, soft fade, minimal',
  boxed: 'Boxed — phrase on a rounded box, active word highlighted',
  typewriter: 'Typewriter — letters type on as they are spoken',
  none: 'No captions',
} as const;
export type CaptionStyle = keyof typeof CAPTION_STYLES;

function chunk(words: Word[], max: number): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length >= max || (cur.length && w.start - cur[cur.length - 1].end > 0.6)) {
      out.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?]$/.test(w.text)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Captions as one sub-composition spanning the whole video. Cues are shown
 * and hidden with tl.set at their word times, so seeking anywhere is exact.
 */
export function buildCaptions(words: Word[], style: CaptionStyle, opts: { id: string; width: number; height: number; safe: SafeZone; brand: BrandKit }) {
  const { id, width, height, safe, brand } = opts;
  const S = `#${id}`;
  const u = Math.min(width, height) / 1080;
  const vertical = height > width * 1.2;
  const maxWords = style === 'bold' ? 3 : style === 'pop' ? 3 : 4;
  const cues = chunk(words, maxWords);
  // Highlight must read on every scene background (dark, light and brand
  // colour), so word highlights use the short-form standard yellow unless the
  // brand's secondary colour is itself bright and distinct from the primary.
  const sec = brand.colors.secondary;
  const accent = sec && sec !== brand.colors.primary && onColor(sec) === '#000000' ? sec : '#FFD84D';
  const onAccent = onColor(accent);
  // Caption band: above the platform UI on vertical, lower third on landscape.
  const bottom = vertical ? Math.max(safe.bottom, 560 * u) : Math.round(height * 0.1);
  const size = Math.round((style === 'bold' ? (vertical ? 86 : 72) : style === 'clean' ? (vertical ? 58 : 48) : vertical ? 70 : 58) * u);
  const markup = cues
    .map((cue, i) => `<div class="cue" data-i="${i}">${cue.map((w, j) => `<span class="cw" data-j="${j}">${esc(style === 'bold' ? w.text.toUpperCase() : w.text)}</span>`).join(' ')}</div>`)
    .join('');
  const css = `${S}{position:absolute;inset:0;pointer-events:none}
${S} .cue{position:absolute;left:${Math.max(safe.left, 60 * u)}px;right:${Math.max(safe.right, 60 * u)}px;bottom:${bottom}px;text-align:center;visibility:hidden;font-family:var(--font-display);font-size:${size}px;line-height:1.12;font-weight:${style === 'clean' ? 650 : 850};letter-spacing:${style === 'bold' ? '-.01em' : '-.02em'};color:#fff;text-wrap:balance}
${S} .cw{display:inline-block}
${
  {
    karaoke: `${S} .cw{text-shadow:0 3px 12px rgba(0,0,0,.6);opacity:.55}${S} .cw.on{opacity:1;color:${accent}}`,
    pop: `${S} .cw{text-shadow:0 4px 14px rgba(0,0,0,.65);-webkit-text-stroke:${Math.max(2, Math.round(3 * u))}px #000;paint-order:stroke fill}`,
    bold: `${S} .cw{-webkit-text-stroke:${Math.max(3, Math.round(8 * u))}px #000;paint-order:stroke fill;text-shadow:0 ${Math.round(8 * u)}px 0 rgba(0,0,0,.5)}${S} .cw.on{color:${accent}}`,
    // Clean captions sit on a soft dark plate so they read over light scenes too.
    clean: `${S} .cue{font-weight:600;display:flex;justify-content:center}${S} .cue>span.plate{background:rgba(8,9,12,.62);border-radius:${Math.round(14 * u)}px;padding:${Math.round(8 * u)}px ${Math.round(20 * u)}px;box-decoration-break:clone;-webkit-box-decoration-break:clone}`,
    boxed: `${S} .cue{display:flex;justify-content:center}${S} .cue>span.box{background:rgba(10,12,16,.82);border-radius:${Math.round(20 * u)}px;padding:${Math.round(14 * u)}px ${Math.round(26 * u)}px}${S} .cw{border-radius:${Math.round(10 * u)}px;padding:0 ${Math.round(8 * u)}px}${S} .cw.on{background:${accent};color:${onAccent}}`,
    typewriter: `${S} .cue{font-family:var(--font-mono);font-weight:700;text-shadow:0 2px 12px rgba(0,0,0,.6)}${S} .ch{opacity:0}`,
    none: '',
  }[style]
}`;
  // Boxed wraps words in a single box span; typewriter splits into characters.
  let html = markup;
  if (style === 'clean') html = markup.replace(/<div class="cue" data-i="(\d+)">/g, '<div class="cue" data-i="$1"><span class="plate">').replace(/<\/div>/g, '</span></div>');
  if (style === 'boxed') html = markup.replace(/<div class="cue" data-i="(\d+)">/g, '<div class="cue" data-i="$1"><span class="box">').replace(/<\/div>/g, '</span></div>');
  if (style === 'typewriter') html = markup.replace(/<span class="cw" data-j="(\d+)">([^<]*)<\/span>/g, (_, j, t) => `<span class="cw" data-j="${j}">${[...t].map((ch: string) => `<span class="ch">${ch}</span>`).join('')}</span>`);

  const js: string[] = [`const cues=document.querySelectorAll("${S} .cue");`];
  cues.forEach((cue, i) => {
    const start = cue[0].start;
    const end = Math.max(cue[cue.length - 1].end + 0.08, start + 0.5);
    const next = cues[i + 1]?.[0].start ?? Infinity;
    const hide = Math.min(end + 0.25, next);
    js.push(`tl.set(cues[${i}],{visibility:"visible"},${start.toFixed(3)});tl.set(cues[${i}],{visibility:"hidden"},${hide.toFixed(3)});`);
    if (style === 'clean') js.push(`tl.fromTo(cues[${i}],{opacity:0,y:${10 * u}},{opacity:1,y:0,duration:.25,ease:"power2.out"},${start.toFixed(3)});`);
    if (style === 'boxed' || style === 'bold') js.push(`tl.fromTo(cues[${i}],{scale:.9},{scale:1,duration:.22,ease:"back.out(2)"},${start.toFixed(3)});`);
    cue.forEach((w, j) => {
      const sel = `cues[${i}].querySelectorAll(".cw")[${j}]`;
      if (style === 'karaoke' || style === 'boxed' || (style === 'bold' && (j === cue.length - 1 || w.text.length > 6))) {
        js.push(`tl.set(${sel},{attr:{class:"cw on"}},${w.start.toFixed(3)});`);
        if (style !== 'bold') js.push(`tl.set(${sel},{attr:{class:"cw"}},${Math.min(w.end + 0.02, hide).toFixed(3)});`);
      }
      if (style === 'pop') js.push(`tl.fromTo(${sel},{scale:.4,opacity:0},{scale:1,opacity:1,duration:.22,ease:"back.out(2.2)"},${w.start.toFixed(3)});`);
      if (style === 'typewriter') js.push(`tl.fromTo(${sel}.querySelectorAll(".ch"),{opacity:0},{opacity:1,duration:.01,stagger:${Math.max(0.01, (w.end - w.start) / Math.max(w.text.length, 1)).toFixed(3)}},${w.start.toFixed(3)});`);
    });
  });
  return { markup: html, css, js: js.join('\n') };
}
