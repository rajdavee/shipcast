import { esc, fit, img, list, logo, page, rich, type Layout, type RenderCtx } from './common.ts';
import { THEMES } from './carousel.ts';

/**
 * Thumbnails and social graphics. Thumbnails follow the research rules: one
 * focal subject, ≤4 words, extreme contrast, nothing in the bottom-right
 * (duration badge), legible at 160 px wide. Cards reuse the carousel themes.
 */

const THUMB_CSS = `
:root{--bg:var(--brand-bg);--fg:var(--brand-text);--accent:var(--accent-on-bg);--accent2:var(--brand-secondary)}
body{background:radial-gradient(1200px 800px at 80% 50%,color-mix(in srgb,var(--accent) 38%,var(--bg)),var(--bg) 70%);color:var(--fg);position:relative}
.t{position:absolute;inset:0;padding:56px 64px}
.hl{font-family:var(--font-display);font-weight:900;line-height:.9;letter-spacing:-.045em;text-transform:uppercase;text-wrap:balance;
  text-shadow:0 6px 0 rgba(0,0,0,.25),0 18px 40px rgba(0,0,0,.35)}
.hl em{font-style:normal;color:var(--accent);-webkit-text-stroke:0}
.hl mark{background:var(--accent);color:var(--brand-on-primary);padding:0 .08em;border-radius:.06em;text-shadow:none}
.shot{position:absolute;border-radius:22px;overflow:hidden;box-shadow:0 40px 90px -20px rgba(0,0,0,.6),0 0 0 6px color-mix(in srgb,var(--fg) 85%,transparent)}
.shot img{width:100%;height:100%;object-fit:cover;object-position:top left}
.ring{position:absolute;border:12px solid var(--accent);border-radius:50%;box-shadow:0 0 0 6px rgba(0,0,0,.25)}
.arrow{position:absolute;width:190px;height:190px;color:var(--accent);filter:drop-shadow(0 8px 0 rgba(0,0,0,.3))}
.tag{position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:16px;font:800 30px/1 var(--font-body);background:var(--fg);color:var(--bg);padding:14px 22px;border-radius:14px}
.tag .logo{height:34px}
.num{font:900 360px/.8 var(--font-display);letter-spacing:-.07em;color:var(--accent);text-shadow:0 10px 0 rgba(0,0,0,.25)}
.vs{position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr}
.vs>div{position:relative;display:flex;flex-direction:column;justify-content:center;padding:64px}
.vs .old{background:#2a2d33;color:#d9dbe0}
.vs .new{background:var(--accent);color:var(--brand-on-primary)}
.vs h3{font:900 120px/.9 var(--font-display);letter-spacing:-.05em;text-transform:uppercase}
.vs .mark{font:900 150px/1 var(--font-display);position:absolute;top:30px;right:48px;opacity:.95}
.vs .badge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-6deg);background:var(--fg);color:var(--bg);font:900 64px/1 var(--font-display);padding:18px 30px;border-radius:18px;z-index:2;box-shadow:0 20px 40px rgba(0,0,0,.4)}
.cutout{position:absolute;right:20px;bottom:0;height:96%;width:auto;filter:drop-shadow(0 0 0 #fff) drop-shadow(8px 0 0 #fff) drop-shadow(-8px 0 0 #fff) drop-shadow(0 -8px 0 #fff) drop-shadow(0 30px 40px rgba(0,0,0,.5))}
`;

const ARROW = `<svg class="arrow" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20 C 40 22, 70 40, 78 78"/><path d="M58 74 L 80 82 L 88 58"/></svg>`;

export const THUMBNAIL_LAYOUTS: Layout[] = [
  {
    id: 'headline-shot',
    label: 'Headline + product shot',
    use: 'Default. 2–4 word hook on the left, the product UI tilted on the right with a circle on the one detail that matters.',
    fields: [
      { id: 'headline', type: 'text', label: 'Headline (≤4 words)', max: 28, help: '*word* = accent color, ==word== = highlight box' },
      { id: 'image', type: 'image', label: 'Screenshot' },
      { id: 'focus', type: 'enum', label: 'Circle', choices: ['none', 'top-left', 'center', 'bottom-left'], optional: true },
    ],
    html: (f, ctx) => {
      const ring = { 'top-left': 'left:690px;top:150px', center: 'left:860px;top:250px', 'bottom-left': 'left:690px;top:390px' }[f.focus as string];
      return `<div class="t"><div class="tag">${logo(ctx)}</div>
<h1 class="hl" style="position:absolute;left:64px;top:170px;width:600px;font-size:${fit(f.headline, [[10, 150], [16, 128], [22, 110], [28, 96]], 84)}px">${rich(f.headline)}</h1>
<div class="shot" style="left:640px;top:110px;width:720px;height:470px;transform:rotate(-4deg)"><img src="${img(f.image, ctx)}"></div>
${ring ? `<div class="ring" style="${ring};width:230px;height:230px"></div>${ARROW.replace('class="arrow"', `class="arrow" style="left:${ring.includes('690') ? 520 : 690}px;top:${ring.includes('390') ? 290 : ring.includes('250') ? 120 : 30}px"`)}` : ''}</div>`;
    },
  },
  {
    id: 'big-number',
    label: 'Big number',
    use: 'When a real number is the hook (time saved, price, stars). Number huge, 2–3 words beside it.',
    fields: [
      { id: 'value', type: 'text', label: 'Number', max: 6 },
      { id: 'headline', type: 'text', label: 'Words (≤3)', max: 22 },
      { id: 'image', type: 'image', label: 'Small product shot', optional: true },
    ],
    html: (f, ctx) => `<div class="t"><div class="tag">${logo(ctx)}</div>
<div class="num" style="position:absolute;left:52px;top:150px;font-size:${fit(f.value, [[2, 400], [3, 330], [4, 260], [6, 200]], 180)}px">${esc(f.value)}</div>
<h1 class="hl" style="position:absolute;left:64px;bottom:96px;width:620px;font-size:${fit(f.headline, [[10, 104], [16, 88], [22, 74]], 66)}px">${rich(f.headline)}</h1>
${f.image ? `<div class="shot" style="left:720px;top:120px;width:500px;height:440px;transform:rotate(5deg)"><img src="${img(f.image, ctx)}"></div>` : ''}</div>`,
  },
  {
    id: 'versus',
    label: 'Before vs after',
    use: 'Old way vs your way. One or two words per side.',
    fields: [
      { id: 'left', type: 'text', label: 'Old way', max: 14 },
      { id: 'right', type: 'text', label: 'New way', max: 14 },
      { id: 'badge', type: 'text', label: 'Middle badge', max: 8, optional: true },
    ],
    html: (f) => `<div class="vs"><div class="old"><span class="mark">✕</span><h3>${rich(f.left)}</h3></div><div class="new"><span class="mark">✓</span><h3>${rich(f.right)}</h3></div></div>${f.badge ? `<div class="vs"><span class="badge">${esc(f.badge)}</span></div>` : ''}`,
  },
  {
    id: 'cutout',
    label: 'Cutout subject',
    use: 'A person or product cut out (transparent PNG) on the right with a sticker outline, headline left.',
    fields: [
      { id: 'headline', type: 'text', label: 'Headline (≤4 words)', max: 28 },
      { id: 'image', type: 'image', label: 'Transparent PNG subject' },
    ],
    html: (f, ctx) => `<div class="t"><div class="tag">${logo(ctx)}</div>
<h1 class="hl" style="position:absolute;left:64px;top:190px;width:640px;font-size:${fit(f.headline, [[10, 150], [16, 126], [22, 108], [28, 94]], 84)}px">${rich(f.headline)}</h1>
<img class="cutout" src="${img(f.image, ctx)}"></div>`,
  },
];

const CARD_CSS = `
.c{position:absolute;inset:0;display:flex}
.c .logo{height:48px;width:auto;max-width:260px;object-fit:contain}
.c .wordmark{font:800 40px/1 var(--font-display);letter-spacing:-.03em}
.c h1{font-family:var(--font-display);font-weight:800;letter-spacing:-.04em;line-height:1;text-wrap:balance}
.c p{font-family:var(--font-body);color:var(--muted);text-wrap:pretty}
.c .frame{border-radius:18px;overflow:hidden;background:var(--card);box-shadow:0 40px 80px -30px rgba(0,0,0,.55),0 0 0 1px var(--rule)}
.c .frame .bar{height:36px;display:flex;align-items:center;gap:8px;padding:0 14px;background:color-mix(in srgb,var(--fg) 7%,transparent)}
.c .frame .bar i{width:11px;height:11px;border-radius:50%;background:color-mix(in srgb,var(--fg) 25%,transparent)}
.c .frame img{width:100%;height:100%;object-fit:cover;object-position:top left}
.c .pill{display:inline-flex;align-items:center;gap:10px;border-radius:999px;padding:12px 22px;font:700 24px/1 var(--font-body);background:var(--accent);color:var(--bg)}
.c .chip{display:inline-flex;border:2px solid var(--rule);border-radius:999px;padding:10px 18px;font:600 22px/1 var(--font-body);color:var(--fg)}
.c .url{font:600 24px/1 var(--font-mono);color:var(--muted)}
em{font-style:normal;color:var(--accent)}
`;

export const CARD_LAYOUTS: Layout[] = [
  {
    id: 'link-card',
    label: 'Link card (OG / GitHub)',
    use: 'Website link preview or GitHub social preview: logo, name, one-liner, real screenshot.',
    fields: [
      { id: 'title', type: 'text', label: 'Title', max: 48 },
      { id: 'subtitle', type: 'text', label: 'One-liner', max: 110 },
      { id: 'image', type: 'image', label: 'Screenshot', optional: true },
      { id: 'chips', type: 'list', label: 'Chips (≤3)', max: 3, optional: true },
    ],
    html: (f, ctx) => {
      const pad = Math.round(ctx.width * 0.085);
      return `<div class="c" style="padding:${pad}px;gap:${pad * 0.8}px;align-items:center">
<div style="flex:1.05;display:flex;flex-direction:column;gap:26px">${logo(ctx)}
<h1 style="font-size:${fit(f.title, [[16, 86], [28, 72], [48, 58]], 52)}px">${rich(f.title)}</h1>
<p style="font-size:28px;line-height:1.35;max-width:24ch">${rich(f.subtitle)}</p>
${list(f.chips).length ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${list(f.chips).slice(0, 3).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}</div>
${f.image ? `<div class="frame" style="flex:1;height:${Math.round(ctx.height * 0.72)}px;transform:perspective(1400px) rotateY(-8deg);margin-right:-${pad * 1.4}px"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>` : ''}</div>`;
    },
  },
  {
    id: 'banner',
    label: 'Profile banner (X / LinkedIn / YouTube)',
    use: 'Wide header. Keep words in the right two-thirds (the avatar covers the bottom-left).',
    fields: [
      { id: 'title', type: 'text', label: 'Tagline', max: 60 },
      { id: 'url', type: 'text', label: 'URL or handle', max: 40, optional: true },
    ],
    html: (f, ctx) => `<div class="c" style="align-items:center;justify-content:flex-end;padding:0 ${Math.round(ctx.width * 0.06)}px">
<div style="display:flex;flex-direction:column;align-items:flex-end;gap:18px;text-align:right;max-width:62%">
<h1 style="font-size:${Math.round(ctx.height * (String(f.title ?? '').length > 34 ? 0.15 : 0.19))}px">${rich(f.title)}</h1>
<div style="display:flex;gap:18px;align-items:center">${f.url ? `<span class="url">${esc(f.url)}</span>` : ''}${logo(ctx)}</div></div></div>`,
  },
  {
    id: 'announcement',
    label: 'Announcement post',
    use: 'Single-image launch post: "Now live" label, headline, product shot, CTA.',
    fields: [
      { id: 'label', type: 'text', label: 'Label', max: 20, help: 'e.g. Now live, New, v2.0' },
      { id: 'title', type: 'text', label: 'Headline', max: 60 },
      { id: 'image', type: 'image', label: 'Screenshot' },
      { id: 'cta', type: 'text', label: 'CTA', max: 30, optional: true },
    ],
    html: (f, ctx) => `<div class="c" style="flex-direction:column;padding:${Math.round(ctx.width * 0.08)}px;gap:36px">
<div style="display:flex;justify-content:space-between;align-items:center">${logo(ctx)}<span class="pill">${esc(f.label)}</span></div>
<h1 style="font-size:${fit(f.title, [[24, 104], [40, 88], [60, 74]], 66)}px">${rich(f.title)}</h1>
<div class="frame" style="flex:1;min-height:0"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>
${f.cta ? `<div style="display:flex;justify-content:space-between;align-items:center"><span class="chip">${esc(f.cta)} →</span><span class="url">${esc(ctx.brand.url ?? '')}</span></div>` : ''}</div>`,
  },
  {
    id: 'story',
    label: 'Story',
    use: '9:16 story frame. Hook top, product middle, CTA/sticker zone kept clear at the bottom.',
    fields: [
      { id: 'title', type: 'text', label: 'Hook', max: 50 },
      { id: 'image', type: 'image', label: 'Screenshot', optional: true },
      { id: 'cta', type: 'text', label: 'CTA', max: 26, optional: true },
    ],
    html: (f, ctx) => `<div class="c" style="flex-direction:column;align-items:center;text-align:center;padding:300px 90px 420px;gap:48px">
${logo(ctx)}<h1 style="font-size:${fit(f.title, [[20, 120], [34, 100], [50, 84]], 76)}px">${rich(f.title)}</h1>
${f.image ? `<div class="frame" style="width:100%;flex:1;min-height:0"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>` : ''}
${f.cta ? `<span class="pill" style="font-size:34px;padding:22px 36px">${esc(f.cta)}</span>` : ''}</div>`,
  },
  {
    id: 'quote-post',
    label: 'Quote post',
    use: 'A real testimonial or founder line as a single image.',
    fields: [
      { id: 'quote', type: 'longtext', label: 'Quote', max: 200 },
      { id: 'name', type: 'text', label: 'Name', max: 40 },
      { id: 'role', type: 'text', label: 'Role', max: 50, optional: true },
    ],
    html: (f, ctx) => `<div class="c" style="flex-direction:column;justify-content:space-between;padding:${Math.round(ctx.width * 0.09)}px">
${logo(ctx)}<div><div style="font:900 220px/.7 var(--font-display);color:var(--accent)">“</div>
<h1 style="font-size:${fit(f.quote, [[60, 76], [110, 62], [160, 52], [200, 46]], 42)}px;line-height:1.12;font-weight:700;margin-top:10px">${rich(f.quote)}</h1></div>
<p style="font-size:30px;color:var(--fg)"><b>${esc(f.name)}</b>${f.role ? ` · ${esc(f.role)}` : ''}</p></div>`,
  },
];

export function renderThumbnail(layoutId: string, fields: Record<string, any>, ctx: RenderCtx): string {
  const l = THUMBNAIL_LAYOUTS.find((x) => x.id === layoutId);
  if (!l) throw new Error(`unknown thumbnail layout "${layoutId}" (have: ${THUMBNAIL_LAYOUTS.map((x) => x.id).join(', ')})`);
  return page(l.html(fields, ctx), ctx, THUMB_CSS);
}

export function renderCard(layoutId: string, theme: string, fields: Record<string, any>, ctx: RenderCtx): string {
  const l = CARD_LAYOUTS.find((x) => x.id === layoutId);
  if (!l) throw new Error(`unknown card layout "${layoutId}" (have: ${CARD_LAYOUTS.map((x) => x.id).join(', ')})`);
  return page(l.html(fields, ctx), ctx, (THEMES[theme] ?? THEMES.editorial).css, CARD_CSS);
}
