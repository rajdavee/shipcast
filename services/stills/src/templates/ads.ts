import { esc, img, logo, page, rich, type RenderCtx } from './common.ts';

/**
 * Static ad sets: one concept, several hooks, every placement size. A single
 * responsive template reflows by aspect ratio (tall, portrait, square, wide,
 * banner, strip) so a leaderboard and a story carry the same idea without
 * anyone designing twelve files.
 */

export const AD_SIZES: Record<string, { w: number; h: number; label: string; platform: string; safe?: { top: number; right: number; bottom: number; left: number } }> = {
  'meta-square': { w: 1080, h: 1080, label: 'Meta / Instagram feed 1:1', platform: 'meta' },
  'meta-portrait': { w: 1080, h: 1350, label: 'Meta / Instagram feed 4:5', platform: 'meta' },
  story: { w: 1080, h: 1920, label: 'Stories / Reels 9:16', platform: 'meta', safe: { top: 270, right: 65, bottom: 380, left: 65 } },
  'linkedin-landscape': { w: 1200, h: 628, label: 'LinkedIn / Facebook link 1.91:1', platform: 'linkedin' },
  'linkedin-square': { w: 1200, h: 1200, label: 'LinkedIn single image 1:1', platform: 'linkedin' },
  'x-landscape': { w: 1600, h: 900, label: 'X image 16:9', platform: 'x' },
  'display-300x250': { w: 300, h: 250, label: 'Display medium rectangle', platform: 'google' },
  'display-336x280': { w: 336, h: 280, label: 'Display large rectangle', platform: 'google' },
  'display-728x90': { w: 728, h: 90, label: 'Display leaderboard', platform: 'google' },
  'display-970x250': { w: 970, h: 250, label: 'Display billboard', platform: 'google' },
  'display-160x600': { w: 160, h: 600, label: 'Display skyscraper', platform: 'google' },
  'display-300x600': { w: 300, h: 600, label: 'Display half page', platform: 'google' },
  'display-320x50': { w: 320, h: 50, label: 'Mobile leaderboard', platform: 'google' },
};
export const DEFAULT_AD_SIZES = ['meta-square', 'meta-portrait', 'story', 'linkedin-landscape', 'display-300x250', 'display-728x90', 'display-160x600', 'display-300x600'];

export const AD_THEMES: Record<string, string> = {
  brand: `:root{--bg:var(--brand-primary);--fg:var(--brand-on-primary);--muted:color-mix(in srgb,var(--brand-on-primary) 78%,transparent);--btn-bg:var(--brand-on-primary);--btn-fg:var(--brand-primary);--panel:color-mix(in srgb,var(--brand-on-primary) 10%,transparent)}`,
  light: `:root{--bg:#ffffff;--fg:#11141a;--muted:#5b6270;--btn-bg:var(--brand-primary);--btn-fg:var(--brand-on-primary);--panel:color-mix(in srgb,var(--brand-primary) 7%,#f5f6f8)}`,
  dark: `:root{--bg:#0c0e13;--fg:#f3f5f9;--muted:#a3abba;--btn-bg:var(--brand-primary);--btn-fg:var(--brand-on-primary);--panel:rgba(255,255,255,.06)}
.ad{background:radial-gradient(120% 90% at 100% 0%,color-mix(in srgb,var(--brand-primary) 45%,transparent),transparent 60%),var(--bg)!important}`,
};

export interface AdVariant {
  /** Short slug used in file names ("pain", "stat", "before-after"). */
  name: string;
  /** The hook on the image. ≤ 8 words reads at thumbnail size. */
  headline: string;
  sub?: string;
  /** Platform primary text (above the image), ≤ 125 chars before "more". */
  primary?: string;
  /** Link description / Google description. */
  description?: string;
}

export interface AdSpec {
  theme?: string;
  image?: string;
  /** "cover" (photo fills the visual area) or "shot" (screenshot in a framed card). */
  imageStyle?: 'cover' | 'shot';
  cta: string;
  url?: string;
  offer?: string;
  sizes?: string[];
  variants: AdVariant[];
  /** Small "Ad · AI image" style disclosure when the visual is synthetic. */
  disclosure?: string;
}

function shape(w: number, h: number): 'strip' | 'banner' | 'wide' | 'square' | 'portrait' | 'tall' {
  const r = w / h;
  if (r >= 5) return 'strip';
  if (r >= 2.4) return 'banner';
  if (r >= 1.3) return 'wide';
  if (r >= 0.92) return 'square';
  if (r >= 0.7) return 'portrait';
  return 'tall';
}

const CSS = (w: number, h: number) => {
  const u = Math.min(w, h * 1.1) / 1080;
  // Small placements need type that is large relative to the box, but not so large it can't fit.
  const px = (n: number) => `${Math.max(9, Math.round(n * u * (w < 400 || h < 120 ? 1.35 : 1)))}px`;
  return `
.ad{position:absolute;inset:0;background:var(--bg);color:var(--fg);display:grid;overflow:hidden;font-family:var(--font-body)}
.ad .logo{height:${Math.max(24, Math.round(54 * Math.min(w, h * 1.1) / 1080 * (w < 400 || h < 120 ? 1.35 : 1)))}px;width:auto;max-width:40%;object-fit:contain;align-self:flex-start;flex:none}
.ad img.logo{background:#fff;border-radius:${px(10)};padding:${px(6)} ${px(10)}}
.theme-light .ad img.logo{background:none;padding:0}
.ad .wordmark{font:800 ${px(40)}/1 var(--font-display)}
.hl{font:800 ${px(96)}/1.02 var(--font-display);letter-spacing:-.035em;text-wrap:balance}
.hl em{font-style:normal;color:inherit;text-decoration:underline;text-decoration-thickness:.08em;text-underline-offset:.1em}
.theme-light .hl em,.theme-dark .hl em{color:var(--brand-primary);text-decoration:none}
.sub{font:500 ${px(38)}/1.3 var(--font-body);color:var(--muted);text-wrap:pretty}
.btn{display:inline-flex;align-items:center;gap:.4em;background:var(--btn-bg);color:var(--btn-fg);font:750 ${px(36)}/1 var(--font-body);padding:${px(22)} ${px(34)};border-radius:999px;white-space:nowrap;width:max-content}
.offer{position:absolute;top:${px(36)};right:${px(36)};background:#ffd84d;color:#1a1400;font:800 ${px(30)}/1 var(--font-body);padding:${px(14)} ${px(20)};border-radius:${px(12)};transform:rotate(3deg);z-index:3}
.vis{position:relative;overflow:hidden;min-height:0;min-width:0}
.vis.cover img{width:100%;height:100%;object-fit:cover}
.vis.shot{display:grid;place-items:center;padding:${px(36)}}
.vis.shot img{max-width:100%;max-height:100%;border-radius:${px(18)};box-shadow:0 ${px(30)} ${px(60)} -${px(26)} rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);object-fit:contain}
.txt{display:flex;flex-direction:column;gap:${px(24)};justify-content:center;padding:${px(64)};min-width:0;min-height:0}
.url{font:600 ${px(26)}/1 var(--font-body);color:var(--muted)}
.disc{position:absolute;left:${px(14)};bottom:${px(10)};font:500 ${px(18)}/1 var(--font-body);color:var(--muted);opacity:.85;z-index:4}
/* shapes */
.square .txt{padding-bottom:${px(20)}}
.square .vis.shot{padding-top:0;padding-bottom:0}
.square .ad,.portrait .ad,.tall .ad{grid-template-rows:auto 1fr auto}
.square .vis:empty{display:none}
/* No visual (small rectangles): headline and button share the space instead of leaving a hole. */
.square .ad:has(.vis:empty){grid-template-rows:auto auto;align-content:center}
.tall .txt.top{padding-top:${px(300)}}
.tall .foot{padding-bottom:${px(400)}}
.foot{display:flex;justify-content:space-between;align-items:center;gap:${px(20)};padding:${px(10)} ${px(64)} ${px(56)}}
.wide .ad{grid-template-columns:1.05fr 1fr}
.banner .ad{grid-template-columns:auto 1fr auto auto;align-items:center;gap:${px(30)};padding:0 ${px(40)}}
.banner .hl{font-size:${Math.round(h * 0.17)}px;line-height:1.05}.banner .sub{display:none}.banner .vis{height:100%;width:${Math.round(h * 1.5)}px}.banner .vis.shot{padding:${Math.round(h * 0.08)}px}
.banner .btn{font-size:${Math.round(h * 0.1)}px;padding:${Math.round(h * 0.07)}px ${Math.round(h * 0.11)}px}.banner .logo{height:${Math.round(h * 0.26)}px}
.strip .ad{grid-template-columns:auto 1fr auto;align-items:center;gap:${Math.max(8, Math.round(h * 0.18))}px;padding:0 ${Math.round(h * 0.18)}px}
.strip .hl{font-size:${Math.round(h * 0.34)}px;line-height:1.05;letter-spacing:-.02em}
.strip .btn{font-size:${Math.round(h * 0.24)}px;padding:${Math.round(h * 0.16)}px ${Math.round(h * 0.26)}px}
.strip .logo{height:${Math.round(h * 0.5)}px}.strip img.logo{padding:${Math.round(h * 0.06)}px}
.strip .sub,.strip .vis,.strip .url{display:none}
.tall.narrow .hl{font-size:${Math.round(w * 0.15)}px}.tall.narrow .sub{font-size:${Math.round(w * 0.085)}px}.tall.narrow .btn{font-size:${Math.round(w * 0.085)}px;padding:${Math.round(w * 0.05)}px ${Math.round(w * 0.07)}px}
.tall.narrow .txt{padding:${Math.round(w * 0.09)}px}.tall.narrow .foot{padding:${Math.round(w * 0.06)}px ${Math.round(w * 0.09)}px ${Math.round(w * 0.09)}px;flex-direction:column;align-items:flex-start}
.tall.narrow .logo{height:${Math.round(w * 0.14)}px}
.tall.narrow .disc{left:0;right:0;bottom:${Math.round(w * 0.025)}px;text-align:center;font-size:${Math.max(8, Math.round(w * 0.05))}px}
.tall.narrow .foot{padding-bottom:${Math.round(w * 0.16)}px}
`;
};

export function renderAd(spec: AdSpec, v: AdVariant, sizeId: string, ctx: RenderCtx): string {
  const s = AD_SIZES[sizeId];
  if (!s) throw new Error(`unknown ad size "${sizeId}" (have: ${Object.keys(AD_SIZES).join(', ')})`);
  const k = shape(s.w, s.h);
  const narrow = k === 'tall' && s.w < 400;
  const theme = AD_THEMES[spec.theme ?? 'brand'] ? spec.theme ?? 'brand' : 'brand';
  // Small rectangles can't show a screenshot legibly; the hook and the button get the room instead.
  const vis = spec.image && !(k === 'square' && s.w < 600) ? `<div class="vis ${spec.imageStyle === 'cover' ? 'cover' : 'shot'}"><img src="${img(spec.image, ctx)}" alt=""></div>` : '<div class="vis"></div>';
  const head = `<h1 class="hl">${rich(v.headline)}</h1>`;
  const sub = v.sub ? `<p class="sub">${rich(v.sub)}</p>` : '';
  const btn = `<span class="btn">${esc(spec.cta)} →</span>`;
  const offer = spec.offer && k !== 'strip' && k !== 'banner' ? `<div class="offer">${esc(spec.offer)}</div>` : '';
  const disc = spec.disclosure && k !== 'strip' ? `<div class="disc">${esc(spec.disclosure)}</div>` : '';
  let body: string;
  if (k === 'strip') body = `${logo(ctx)}${head}${btn}`;
  else if (k === 'banner') body = `${logo(ctx)}${head}${vis}${btn}`;
  else if (k === 'wide') body = `<div class="txt">${logo(ctx)}${head}${sub}<div>${btn}</div>${spec.url ? `<div class="url">${esc(spec.url)}</div>` : ''}</div>${vis}`;
  else body = `<div class="txt top">${logo(ctx)}${head}${narrow || (k === 'square' && s.w < 600) ? '' : sub}</div>${vis}<div class="foot">${btn}${spec.url && !narrow && s.w >= 600 ? `<span class="url">${esc(spec.url)}</span>` : ''}</div>`;
  // Shrink the headline (then drop the subline) until nothing overflows or collides with the button.
  const fit = `<script>window.__shipcastFit = () => {
    const hl = document.querySelector('.hl'), btn = document.querySelector('.btn'), sub = document.querySelector('.sub');
    if (!hl) return 0;
    const hit = (a, b) => { if (!a || !b) return false; const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom; };
    const over = () => [...document.querySelectorAll('.txt, .foot, .ad')].some((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) || hit(hl, btn) || hit(sub, btn) || hl.getBoundingClientRect().bottom > innerHeight || hl.getBoundingClientRect().right > innerWidth;
    let n = 0, size = parseFloat(getComputedStyle(hl).fontSize);
    while (over() && n < 60) {
      if (sub && size < parseFloat(getComputedStyle(sub).fontSize) * 1.6 && sub.style.display !== 'none') { sub.style.display = 'none'; n++; continue; }
      if (size <= 10) break;
      size *= 0.94; hl.style.fontSize = size + 'px';
      if (sub) sub.style.fontSize = Math.max(9, parseFloat(getComputedStyle(sub).fontSize) * 0.95) + 'px';
      n++;
    }
    return n;
  };</script>`;
  return page(`${fit}<div class="theme-${theme} ${k}${narrow ? ' narrow' : ''}" style="position:absolute;inset:0"><div class="ad">${body}</div>${offer}${disc}</div>`, { ...ctx, width: s.w, height: s.h }, AD_THEMES[theme], CSS(s.w, s.h));
}
