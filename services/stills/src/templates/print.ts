import { brandCss, fontLinks, type BrandKit } from '@shipcast/engine';
import { esc, img, list, logo, rich, type RenderCtx } from './common.ts';

/**
 * Print: posters, flyers, roll-up banners, event signage. Sizes are real
 * paper sizes; artwork extends 3 mm past the trim (bleed) and crop marks sit
 * outside it, so the PDF can go straight to a print shop. Type is set for the
 * viewing distance of each format, not the screen.
 */

const MM = 96 / 25.4; // CSS px per millimetre

export const PRINT_SIZES: Record<string, { w: number; h: number; label: string }> = {
  'a5-flyer': { w: 148, h: 210, label: 'A5 flyer' },
  'a4-flyer': { w: 210, h: 297, label: 'A4 flyer / poster' },
  'letter-flyer': { w: 215.9, h: 279.4, label: 'US Letter flyer' },
  'a3-poster': { w: 297, h: 420, label: 'A3 poster' },
  'a2-poster': { w: 420, h: 594, label: 'A2 poster' },
  'poster-18x24': { w: 457.2, h: 609.6, label: '18 × 24 in poster' },
  'poster-24x36': { w: 609.6, h: 914.4, label: '24 × 36 in poster' },
  'rollup-850x2000': { w: 850, h: 2000, label: 'Roll-up banner 850 × 2000 mm' },
  'banner-3000x1000': { w: 3000, h: 1000, label: 'Event banner 3 × 1 m' },
  'table-tent-a6': { w: 105, h: 148, label: 'A6 table card' },
};

export interface PrintSpec {
  size: string;
  theme?: 'brand' | 'light' | 'dark';
  layout: 'headline' | 'event' | 'product' | 'stat';
  fields: Record<string, any>;
  /** Crop marks + 3 mm bleed (default true). */
  marks?: boolean;
}

const BLEED = 3; // mm
const SLUG = 10; // mm of margin outside the bleed for crop marks

export function printGeometry(spec: PrintSpec) {
  const s = PRINT_SIZES[spec.size];
  if (!s) throw new Error(`unknown print size "${spec.size}" (have: ${Object.keys(PRINT_SIZES).join(', ')})`);
  const marks = spec.marks !== false;
  const outer = marks ? BLEED + SLUG : 0;
  return { trimW: s.w * MM, trimH: s.h * MM, bleed: marks ? BLEED * MM : 0, outer: outer * MM, pageW: (s.w + outer * 2) * MM, pageH: (s.h + outer * 2) * MM, label: s.label, mmW: s.w, mmH: s.h };
}

const THEMES: Record<string, string> = {
  brand: `:root{--bg:var(--brand-primary);--fg:var(--brand-on-primary);--muted:color-mix(in srgb,var(--brand-on-primary) 80%,transparent);--card:color-mix(in srgb,var(--brand-on-primary) 12%,transparent);--accent:var(--brand-on-primary)}`,
  light: `:root{--bg:#ffffff;--fg:#111418;--muted:#565d6a;--card:color-mix(in srgb,var(--brand-primary) 8%,#f4f5f7);--accent:var(--brand-primary)}`,
  dark: `:root{--bg:#0d1016;--fg:#f4f6f9;--muted:#a6aebb;--card:rgba(255,255,255,.07);--accent:var(--accent-on-dark)}
.art{background:radial-gradient(70% 50% at 85% 0%,color-mix(in srgb,var(--brand-primary) 55%,transparent),transparent 70%),radial-gradient(60% 45% at 0% 100%,color-mix(in srgb,var(--brand-secondary) 35%,transparent),transparent 70%),var(--bg)!important}`,
};

export function renderPrint(spec: PrintSpec, ctx: RenderCtx): string {
  const g = printGeometry(spec);
  // One unit of type scale per format: the short side of the trim, so a roll-up and a flyer both read at their distance.
  const u = Math.min(g.trimW, g.trimH) / 100;
  const tall = g.trimH / g.trimW > 1.8;
  const wide = g.trimW / g.trimH > 2;
  const f = spec.fields ?? {};
  const pts = list(f.points);
  const body = (() => {
    const lg = `<div class="lg">${logo(ctx)}</div>`;
    const cta = f.cta ? `<div class="cta"><b>${esc(f.cta)}</b>${f.url ? `<span>${esc(f.url)}</span>` : ''}</div>` : '';
    const image = f.image ? `<div class="pic"><img src="${img(f.image, ctx)}" alt=""></div>` : '';
    if (spec.layout === 'event')
      return `${lg}<div class="kick">${esc(f.kicker ?? '')}</div><h1>${rich(f.title)}</h1>${f.sub ? `<p class="sub">${rich(f.sub)}</p>` : ''}<div class="when">${f.date ? `<div><small>When</small><b>${esc(f.date)}</b></div>` : ''}${f.place ? `<div><small>Where</small><b>${esc(f.place)}</b></div>` : ''}${f.booth ? `<div><small>Find us</small><b>${esc(f.booth)}</b></div>` : ''}</div>${pts.length ? `<ul>${pts.map((p) => `<li>${rich(p)}</li>`).join('')}</ul>` : ''}${image}${cta}`;
    if (spec.layout === 'stat')
      return `${lg}<div class="big">${esc(f.stat)}</div><h1>${rich(f.title)}</h1>${f.sub ? `<p class="sub">${rich(f.sub)}</p>` : ''}${f.source ? `<p class="src">${esc(f.source)}</p>` : ''}${cta}`;
    if (spec.layout === 'product')
      return `${lg}<div class="kick">${esc(f.kicker ?? '')}</div><h1>${rich(f.title)}</h1>${f.sub ? `<p class="sub">${rich(f.sub)}</p>` : ''}${image}${pts.length ? `<ul class="ticks">${pts.map((p) => `<li>${rich(p)}</li>`).join('')}</ul>` : ''}${cta}`;
    return `${lg}<div class="kick">${esc(f.kicker ?? '')}</div><h1>${rich(f.title)}</h1>${f.sub ? `<p class="sub">${rich(f.sub)}</p>` : ''}${image}${cta}`;
  })();
  const markLen = 7 * MM;
  const o = g.outer;
  const t = (x: number) => x.toFixed(2);
  const marks = g.outer
    ? `<svg class="marks" width="${t(g.pageW)}" height="${t(g.pageH)}" viewBox="0 0 ${t(g.pageW)} ${t(g.pageH)}">${[
        [o, 0, o, o - g.bleed - 2], [0, o, o - g.bleed - 2, o],
        [o + g.trimW, 0, o + g.trimW, o - g.bleed - 2], [o + g.trimW + g.bleed + 2, o, g.pageW, o],
        [o, g.pageH, o, o + g.trimH + g.bleed + 2], [0, o + g.trimH, o - g.bleed - 2, o + g.trimH],
        [o + g.trimW, g.pageH, o + g.trimW, o + g.trimH + g.bleed + 2], [o + g.trimW + g.bleed + 2, o + g.trimH, g.pageW, o + g.trimH],
      ].map(([x1, y1, x2, y2]) => `<line x1="${t(x1)}" y1="${t(y1)}" x2="${t(x2)}" y2="${t(y2)}" stroke="#000" stroke-width="0.5"/>`).join('')}<text x="${t(o)}" y="${t(Math.max(8, o - g.bleed - markLen))}" font-size="8" font-family="sans-serif" fill="#000">${esc(`${g.label} · trim ${g.mmW} × ${g.mmH} mm · bleed ${BLEED} mm`)}</text></svg>`
    : '';
  const css = `
@page{size:${t(g.pageW)}px ${t(g.pageH)}px;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${t(g.pageW)}px;height:${t(g.pageH)}px;overflow:hidden;background:#fff}
body{font-family:var(--font-body);-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.marks{position:absolute;inset:0;z-index:3}
.art{position:absolute;left:${t(o - g.bleed)}px;top:${t(o - g.bleed)}px;width:${t(g.trimW + 2 * g.bleed)}px;height:${t(g.trimH + 2 * g.bleed)}px;background:var(--bg);color:var(--fg);overflow:hidden}
.safe{position:absolute;inset:${t(g.bleed + 6 * u)}px;display:flex;flex-direction:${wide ? 'row' : 'column'};${wide ? 'align-items:center;' : ''}gap:${t(3.2 * u)}px}
.lg .logo{height:${t(7 * u)}px;width:auto;max-width:${t(40 * u)}px;object-fit:contain}
.lg img.logo{background:#fff;border-radius:${t(1.6 * u)}px;padding:${t(1 * u)}px ${t(1.6 * u)}px}
.lg .wordmark{font:800 ${t(5.5 * u)}px/1 var(--font-display)}
.kick{font:800 ${t(2.6 * u)}px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{font:800 ${t((tall ? 13 : wide ? 9 : 11) * u)}px/1.0 var(--font-display);letter-spacing:-.035em;text-wrap:balance}
h1 em{font-style:normal;color:var(--accent);text-decoration:${'underline'};text-decoration-thickness:.07em;text-underline-offset:.08em}
.sub{font:500 ${t(3.6 * u)}px/1.3 var(--font-body);color:var(--muted);max-width:${t(85 * u)}px;text-wrap:pretty}
.big{font:900 ${t(30 * u)}px/.9 var(--font-display);letter-spacing:-.05em;color:var(--accent)}
.src{font:500 ${t(1.8 * u)}px/1.3 var(--font-body);color:var(--muted)}
.pic{flex:1;min-height:0;border-radius:${t(2.4 * u)}px;overflow:hidden;box-shadow:0 ${t(2 * u)}px ${t(5 * u)}px -${t(2 * u)}px rgba(0,0,0,.45)}
.pic img{width:100%;height:100%;object-fit:cover;object-position:top}
ul{list-style:none;display:grid;gap:${t(1.6 * u)}px;font:600 ${t(3.2 * u)}px/1.25 var(--font-body)}
ul li{padding-left:${t(4.2 * u)}px;position:relative}ul li::before{content:"";position:absolute;left:0;top:.35em;width:${t(2 * u)}px;height:${t(2 * u)}px;border-radius:${t(.5 * u)}px;background:var(--accent)}
.when{display:flex;gap:${t(6 * u)}px;flex-wrap:wrap}.when small{display:block;font:700 ${t(1.8 * u)}px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:${t(.8 * u)}px}.when b{font:800 ${t(4.2 * u)}px/1.1 var(--font-display)}
.cta{margin-top:auto;display:flex;align-items:baseline;justify-content:space-between;gap:${t(3 * u)}px;flex-wrap:wrap;border-top:${t(.4 * u)}px solid currentColor;padding-top:${t(2.4 * u)}px}
.cta b{font:800 ${t(4.6 * u)}px/1.1 var(--font-display)}.cta span{font:700 ${t(3.4 * u)}px/1.1 var(--font-body);color:var(--muted)}
${wide ? `.safe>.pic{flex:1.1;height:100%}.safe>h1{flex:1.4}.cta{margin:0;border:0;flex-direction:column;align-items:flex-start}` : ''}
${tall ? `.pic{flex:0 1 auto}.pic img{height:auto;object-fit:contain}.safe{justify-content:flex-start}` : ''}
`;
  return `<!doctype html><html><head><meta charset="utf-8">${fontLinks(ctx.brand)}<style>${brandCss(ctx.brand)}${THEMES[spec.theme ?? 'brand'] ?? THEMES.brand}${css}</style></head><body><div class="art"><div class="safe">${body}</div></div>${marks}</body></html>`;
}

/** Render scale for the PNG: aim for 300 dpi, capped so huge banners stay renderable. */
export function printScale(spec: PrintSpec): number {
  const g = printGeometry(spec);
  // Chrome can't capture much beyond ~8k px or ~40 MP in one shot; the PDF keeps text vector at any size.
  return Math.max(1, Math.min(300 / 96, 8000 / Math.max(g.pageW, g.pageH), Math.sqrt(40e6 / (g.pageW * g.pageH))));
}

export type { BrandKit };
