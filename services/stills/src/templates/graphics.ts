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
.tag{position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:16px;font:800 30px/1 var(--font-body);background:#fff;color:#111;padding:14px 22px;border-radius:14px;box-shadow:0 10px 30px -12px rgba(0,0,0,.35)}
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
      if (ctx.width / ctx.height < 1.4) {
        // Square and tall feeds: headline across the top, the shot bleeding off the bottom-right below it.
        const top = Math.round(ctx.height * 0.4);
        // No callout ring here: its position can't know where the detail sits in the screenshot, and a ring on empty space looks broken.
        const ringAt = '';
        return `<div class="t"><div class="tag">${logo(ctx)}</div>
<h1 class="hl" style="position:absolute;left:64px;top:170px;width:${ctx.width - 128}px;font-size:${fit(f.headline, [[10, 170], [16, 150], [22, 128], [28, 112]], 96)}px">${rich(f.headline)}</h1>
<div class="shot" style="left:110px;top:${top}px;width:${ctx.width}px;height:${ctx.height - top + 80}px;transform:rotate(-4deg)"><img src="${img(f.image, ctx)}"></div>
${ringAt}</div>`;
      }
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
.c .frame{display:flex;flex-direction:column;border-radius:18px;overflow:hidden;background:var(--card);box-shadow:0 40px 80px -30px rgba(0,0,0,.55),0 0 0 1px var(--rule)}
.c .frame .bar{height:36px;display:flex;align-items:center;gap:8px;padding:0 14px;background:color-mix(in srgb,var(--fg) 7%,transparent)}
.c .frame .bar i{width:11px;height:11px;border-radius:50%;background:color-mix(in srgb,var(--fg) 25%,transparent)}
.c .frame .bar{flex:none}.c .frame img{width:100%;flex:1;min-height:0;height:auto;object-fit:cover;object-position:top left}
.c .pill{display:inline-flex;align-items:center;gap:10px;border-radius:999px;padding:12px 22px;font:700 24px/1 var(--font-body);background:var(--accent);color:var(--bg)}
.c .chip{display:inline-flex;border:2px solid var(--rule);border-radius:999px;padding:10px 18px;font:600 22px/1 var(--font-body);color:var(--fg)}
.c .url{font:600 24px/1 var(--font-mono);color:var(--muted)}
em{font-style:normal;color:var(--accent)}
.c .hd,.c .ft{display:flex;align-items:center;justify-content:space-between;gap:24px}
.c .kick{font:700 var(--k,28px)/1.2 var(--font-body);color:var(--accent)}
.c .sample{flex:none;border:2px dashed currentColor;border-radius:999px;padding:.45em .9em;font:700 var(--s,22px)/1 var(--font-body);color:var(--muted);white-space:nowrap}
.c .av{flex:none;display:grid;place-items:center;border-radius:50%;object-fit:cover;background:var(--accent);color:var(--bg);font-family:var(--font-display);font-weight:800;letter-spacing:-.02em;overflow:hidden}
.c .av img{width:62%;height:62%;object-fit:contain}
.pq-body{display:flex;flex-direction:column;gap:12px;min-height:0}
.pq-mark{font:900 1em/.62 var(--font-display);color:var(--accent);flex:none}
.c .pq-q{font-weight:700;line-height:1.1;letter-spacing:-.03em}
.ft .src{display:flex;align-items:center;gap:20px;font:600 var(--s,30px)/1.25 var(--font-body);color:var(--fg)}
.ft .src small{display:block;font-weight:500;color:var(--muted)}
.ft .rule{width:64px;height:6px;border-radius:3px;background:var(--accent);flex:none}
.tm{display:flex;flex-direction:column;background:var(--card);border-radius:36px;box-shadow:0 0 0 1px color-mix(in srgb,var(--rule) 45%,transparent),0 40px 80px -40px rgba(0,0,0,.45)}
.tm-q{font-family:var(--font-display);font-weight:600;letter-spacing:-.02em;line-height:1.2;text-wrap:pretty}
.tm-who{display:flex;align-items:center;font-family:var(--font-body);line-height:1.25}
.tm-who b{display:block;font-weight:700;color:var(--fg)}
.tm-who small{display:block;font-weight:500;color:var(--muted);font-size:.86em}
.post{display:grid;background:#fff;color:#14171c;border-radius:32px;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 40px 90px -40px rgba(0,0,0,.55);font-family:var(--font-body)}
.post.dk{background:#16181d;color:#eef0f4;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 40px 90px -40px rgba(0,0,0,.7)}
.post header{display:flex;align-items:center;gap:.6em}
.post .pn{flex:1;min-width:0;line-height:1.2}.post .pn b{display:block;font-weight:700}.post .pn span{display:block;color:#69707d;font-size:.82em}
.post.dk .pn span,.post.dk footer{color:#9aa1ad}
.post .dots{font-style:normal;color:#9aa1ad;letter-spacing:.1em}
.post .pt{line-height:1.32;white-space:pre-line;text-wrap:pretty;color:inherit}
.post .pt em{color:var(--brand-primary)}.post.dk .pt em{color:var(--accent-on-dark)}
.post .pimg{border-radius:20px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.08);min-height:0}
.post .pimg img{width:100%;height:auto}
.post footer{display:flex;justify-content:space-between;color:#69707d}
.app{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;text-align:center}
.app h1{max-width:100%;font-family:var(--font-display);font-weight:800;letter-spacing:-.04em;line-height:1.02;text-wrap:balance}
.app .sub{font-family:var(--font-body);font-weight:500;color:var(--muted);line-height:1.3;text-wrap:balance}
.app .stage{position:relative;flex:1;width:100%;min-height:0;container-type:size}
.dev{--dw:min(96cqw,calc(100cqh / 2.08));position:absolute;left:50%;top:0;transform:translateX(-50%);width:var(--dw);height:calc(var(--dw) * 2.08);padding:calc(var(--dw) * .03);border-radius:calc(var(--dw) * .13);background:#15171c;
  box-shadow:inset 0 0 0 calc(var(--dw) * .006) #3b3f48,0 calc(var(--dw) * .06) calc(var(--dw) * .12) calc(var(--dw) * -.04) rgba(0,0,0,.5)}
.dev.bleed{--dw:92cqw}
.dev::before,.dev::after{content:"";position:absolute;width:calc(var(--dw) * .012);border-radius:3px;background:#2b2e35}
.dev::before{right:calc(var(--dw) * -.011);top:calc(var(--dw) * .42);height:calc(var(--dw) * .2)}
.dev::after{left:calc(var(--dw) * -.011);top:calc(var(--dw) * .34);height:calc(var(--dw) * .28)}
.dev .scr{position:relative;width:100%;height:100%;border-radius:calc(var(--dw) * .105);overflow:hidden;background:#fff}
.dev .scr>img{width:100%;height:auto}
.dev .cam{position:absolute;z-index:6;left:50%;top:calc(var(--dw) * .055);width:calc(var(--dw) * .04);height:calc(var(--dw) * .04);margin-left:calc(var(--dw) * -.02);border-radius:50%;background:#0b0c0f;box-shadow:0 0 0 calc(var(--dw) * .006) #23262c}
.dev .ui-label{font-size:calc(var(--dw) * .028)}
.pf-bg{position:absolute;inset:0}
.pf-box{position:absolute;display:flex;align-items:center}
.pf-in{display:flex;flex-direction:column;width:100%;min-width:0}
.pf-in.row{flex-direction:row;align-items:center}.pf-in.shot{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center}.pf-in.shot .frame{min-width:0}
.pf-txt{display:flex;flex-direction:column;min-width:0;flex:1}
.pf-in h1{line-height:1.02;max-width:100%}.pf-in p{line-height:1.3;max-width:34ch}
.pf-logo{display:inline-flex;flex:none;line-height:1}.pf-logo .logo{height:1em;width:auto;max-width:6em;object-fit:contain}.pf-logo .wordmark{font:800 1em/1 var(--font-display);letter-spacing:-.03em}
.pf-url{font-family:var(--font-mono);font-weight:600;color:var(--muted);max-width:100%;white-space:nowrap;overflow:hidden}
.pf-rule{flex:none;width:3px;align-self:stretch;border-radius:2px;background:var(--accent)}
.cs-client{font-family:var(--font-body);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.cs-nums{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:24px}.cs-nums.col{grid-template-columns:1fr;flex:1;align-content:center}
.cs-n{display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--card);border-radius:28px;padding:28px;box-shadow:0 0 0 1px color-mix(in srgb,var(--rule) 45%,transparent)}
.cs-nums.col .cs-n{padding:18px 24px;gap:4px;border-radius:20px}
.cs-n b{font-family:var(--font-display);font-weight:800;line-height:1;letter-spacing:-.04em;color:var(--accent);white-space:nowrap}
.cs-n span{font-family:var(--font-body);font-weight:600;line-height:1.25;color:var(--fg)}
.cs-q{font-family:var(--font-display);font-weight:600;line-height:1.3;color:var(--fg);border-left:6px solid var(--accent);padding-left:.8em}
.cs-q small{display:block;margin-top:.5em;font:500 .72em/1.3 var(--font-body);color:var(--muted)}
.post footer svg{width:1.15em;height:1.15em;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
`;

/** Initials for an avatar circle — the card never needs a real person's photo. */
const initials = (name: unknown) =>
  String(name ?? '').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '•';

/** Placeholder quotes are labelled on the image itself, so a sample can't pass for a real customer. */
const isSample = (f: Record<string, any>) => /^(yes|true)$/i.test(String(f.sample ?? ''));
const sampleTag = (f: Record<string, any>) => (isSample(f) ? '<span class="sample" data-sample>Sample copy — not a real customer</span>' : '');

function avatar(f: Record<string, any>, ctx: RenderCtx, px: number): string {
  const st = `width:${px}px;height:${px}px;font-size:${Math.round(px * 0.4)}px`;
  if (f.avatar === 'logo' && ctx.brand.logo) return `<span class="av" style="${st};background:#fff"><img src="${img(ctx.brand.logo, ctx)}" alt=""></span>`;
  if (f.avatar && f.avatar !== 'logo') return `<img class="av" style="${st}" src="${img(f.avatar, ctx)}" alt="">`;
  return `<span class="av" style="${st}">${esc(String(f.initials ?? '').slice(0, 3) || initials(f.name))}</span>`;
}

// Generic outline glyphs (reply, share-again, like, send) so a post card reads as "a post" without any platform's marks.
const POST_ICONS = ['<path d="M4 5h16v11H10l-6 4z"/>', '<path d="M7 7h11v5M17 17H6v-5M15 4l3 3-3 3M9 20l-3-3 3-3"/>', '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', '<path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/>']
  .map((p) => `<svg viewBox="0 0 24 24">${p}</svg>`)
  .join('');

/** Quote-card geometry: one design that recomposes for square, 4:5 and 1.91:1. */
const quoteBox = (ctx: RenderCtx) => {
  const land = ctx.width / ctx.height > 1.4;
  // 4:5 has a fifth more height than square: spend it on bigger type rather than empty card.
  return { land, u: land ? 0.72 : ctx.height / ctx.width > 1.2 ? 1.1 : 1, pad: land ? 64 : 96 };
};

/** The part of a banner every device shows, minus the corner a profile photo or page logo covers. */
function contentBox(ctx: RenderCtx) {
  const s = ctx.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const gap = Math.round(ctx.width * 0.02);
  let l = s.left;
  let r = ctx.width - s.right;
  // Photos sit in a bottom corner and cover most of a short banner's height: keep the whole block beside them.
  for (const a of s.avoid ?? []) {
    if (a.x <= l) l = Math.max(l, a.x + a.w + gap);
    else if (a.x + a.w >= r) r = Math.min(r, a.x - gap);
  }
  return { x: l, y: s.top, w: r - l, h: ctx.height - s.top - s.bottom };
}

const MOTIFS: Record<string, string> = {
  grid: 'background-image:linear-gradient(color-mix(in srgb,var(--fg) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--fg) 7%,transparent) 1px,transparent 1px);background-size:var(--cell) var(--cell);background-position:var(--cx) var(--cy)',
  rings: 'background-image:repeating-radial-gradient(circle at var(--cx) var(--cy),transparent 0 calc(var(--cell) - 2px),color-mix(in srgb,var(--fg) 9%,transparent) calc(var(--cell) - 2px) var(--cell))',
  dots: 'background-image:radial-gradient(color-mix(in srgb,var(--fg) 16%,transparent) 1.5px,transparent 2.5px);background-size:var(--cell) var(--cell);background-position:var(--cx) var(--cy)',
  plain: '',
};

// Banner copy scales down together until it fits the safe box; text pushed under its data-min-font floor is reported.
const PROFILE_FIT = `<script>window.__shipcastFit = () => {
  const box = document.querySelector('.pf-box'), inn = document.querySelector('.pf-in');
  if (!box || !inn) return 0;
  const room = () => box.clientHeight - parseFloat(getComputedStyle(box).paddingTop) * 2;
  const over = () => inn.getBoundingClientRect().height > room() + 1 || inn.scrollWidth > inn.clientWidth + 1 || [...inn.querySelectorAll('h1,p,.pf-url')].some((e) => e.scrollWidth > e.clientWidth + 2);
  let n = 0;
  while (over() && n < 40) { inn.querySelectorAll('[data-s]').forEach((e) => { e.style.fontSize = parseFloat(getComputedStyle(e).fontSize) * 0.95 + 'px'; }); n++; }
  return n;
};</script>`;

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
  {
    id: 'pull-quote',
    label: 'Pull quote',
    use: 'One striking line from the brief, a founder post, a review or an article, set big with its source. Square, 4:5 or 1.91:1.',
    fields: [
      { id: 'quote', type: 'longtext', label: 'Quote (exact words)', max: 180, help: '*word* = accent' },
      { id: 'source', type: 'text', label: 'Who said it / where', max: 60, help: 'e.g. "Jane Doe, CTO at Acme" or "From our launch post"' },
      { id: 'kicker', type: 'text', label: 'Kicker', max: 32, optional: true },
      { id: 'sample', type: 'enum', label: 'Sample copy', choices: ['no', 'yes'], optional: true, help: 'yes = placeholder words, labelled on the image' },
    ],
    html: (f, ctx) => {
      const { land, u, pad } = quoteBox(ctx);
      const q = Math.round(fit(f.quote, [[50, 96], [90, 80], [130, 68], [180, 58]], 52) * u);
      return `<div class="c" style="flex-direction:column;justify-content:space-between;padding:${pad}px;gap:${Math.round(28 * u)}px;--k:${Math.round(28 * u)}px;--s:${Math.round(30 * u)}px">
<div class="hd">${logo(ctx)}${f.kicker ? `<span class="kick">${rich(f.kicker)}</span>` : ''}</div>
<div class="pq-body" style="${land ? 'flex-direction:row;gap:28px' : ''}"><div class="pq-mark" style="font-size:${Math.round(220 * u)}px">“</div>
<h1 class="pq-q" data-min-font="${Math.round(q * 0.72)}" style="font-size:${q}px">${rich(f.quote)}</h1></div>
<div class="ft"><span class="src"><span class="rule"></span><span>${esc(f.source)}</span></span>${sampleTag(f)}</div></div>`;
    },
  },
  {
    id: 'testimonial',
    label: 'Customer testimonial',
    use: 'A real customer quote with name, role and company, on a card with an initials avatar (or their photo if the brief has one). Only quotes found in the brief/source; otherwise set sample: yes.',
    fields: [
      { id: 'quote', type: 'longtext', label: 'Quote (exact words)', max: 220 },
      { id: 'name', type: 'text', label: 'Name', max: 40 },
      { id: 'role', type: 'text', label: 'Role', max: 50, optional: true },
      { id: 'company', type: 'text', label: 'Company', max: 40, optional: true },
      { id: 'initials', type: 'text', label: 'Avatar initials', max: 3, optional: true, help: 'defaults to the name' },
      { id: 'avatar', type: 'image', label: 'Photo from the brief', optional: true },
      { id: 'sample', type: 'enum', label: 'Sample copy', choices: ['no', 'yes'], optional: true, help: 'yes = placeholder quote, labelled on the image' },
    ],
    html: (f, ctx) => {
      const { land, u, pad } = quoteBox(ctx);
      const q = Math.round(fit(f.quote, [[60, 64], [110, 54], [160, 46], [220, 40]], 38) * u);
      const who = [f.role, f.company].filter(Boolean).map(esc).join(' · ');
      return `<div class="c" style="flex-direction:column;justify-content:center;padding:${pad}px;gap:${Math.round(36 * u)}px;--s:${Math.round(22 * u)}px">
<div class="hd">${logo(ctx)}${sampleTag(f)}</div>
<div class="tm" style="padding:${Math.round((land ? 44 : 64) * u)}px;gap:${Math.round(40 * u)}px;${land ? '' : 'flex:1;min-height:0;justify-content:center'}">
<div class="pq-mark" style="font-size:${Math.round(150 * u)}px">“</div>
<p class="tm-q" data-min-font="${Math.round(q * 0.72)}" style="font-size:${q}px;color:var(--fg)">${rich(f.quote)}</p>
<div class="tm-who" style="gap:${Math.round(24 * u)}px;font-size:${Math.round(32 * u)}px">${avatar(f, ctx, Math.round(96 * u))}<span><b>${esc(f.name)}</b>${who ? `<small>${who}</small>` : ''}</span></div></div></div>`;
    },
  },
  {
    id: 'post-card',
    label: 'Post screenshot card',
    use: 'Looks like a generic social post (avatar, name, handle, text, optional image, reply/share/like icons) with no platform logo. For the brand\'s own posts or a real post quoted in the brief; otherwise set sample: yes.',
    fields: [
      { id: 'name', type: 'text', label: 'Display name', max: 32 },
      { id: 'handle', type: 'text', label: 'Handle', max: 28, help: 'e.g. @acme' },
      { id: 'text', type: 'longtext', label: 'Post text (exact words)', max: 280 },
      { id: 'time', type: 'text', label: 'Time label', max: 12, optional: true, help: 'e.g. 2h, Mar 4' },
      { id: 'image', type: 'image', label: 'Attached image', optional: true },
      { id: 'avatar', type: 'image', label: 'Avatar ("logo" = brand logo)', optional: true },
      { id: 'initials', type: 'text', label: 'Avatar initials', max: 3, optional: true },
      { id: 'look', type: 'enum', label: 'Post look', choices: ['light', 'dark'], optional: true },
      { id: 'sample', type: 'enum', label: 'Sample copy', choices: ['no', 'yes'], optional: true, help: 'yes = placeholder post, labelled on the image' },
    ],
    html: (f, ctx) => {
      const { land, u, pad } = quoteBox(ctx);
      const n = String(f.text ?? '').length;
      const t = Math.round(fit(f.text, [[80, 52], [140, 46], [210, 40], [280, 36]], 34) * u * (f.image && !land ? 0.86 : 1));
      const side = land && f.image;
      const pp = Math.round(48 * u);
      const head = `<header style="font-size:${Math.round(32 * u)}px">${avatar(f, ctx, Math.round(84 * u))}<span class="pn"><b>${esc(f.name)}</b><span>${esc(f.handle)}${f.time ? ` · ${esc(f.time)}` : ''}</span></span><i class="dots">•••</i></header>`;
      const text = `<p class="pt" data-min-font="${Math.round(t * 0.72)}" style="font-size:${t}px">${rich(f.text)}</p>`;
      const pic = f.image ? `<div class="pimg" style="${side ? 'grid-row:1 / span 3;grid-column:2;align-self:center' : `max-height:${Math.round(ctx.height * (n > 160 ? 0.3 : 0.4))}px`}"><img src="${img(f.image, ctx)}"></div>` : '';
      const foot = `<footer style="font-size:${Math.round(34 * u)}px">${POST_ICONS}</footer>`;
      return `<div class="c" style="flex-direction:column;align-items:center;justify-content:center;padding:${pad}px;gap:${Math.round(28 * u)}px;--s:${Math.round(22 * u)}px">
<article class="post${f.look === 'dark' ? ' dk' : ''}" style="width:100%;min-height:0;padding:${pp}px;gap:${Math.round(28 * u)}px;${side ? `grid-template-columns:1fr 0.82fr;column-gap:${pp}px;align-items:start` : ''}">${head}${text}${side ? foot + pic : pic + foot}</article>${sampleTag(f)}</div>`;
    },
  },
  {
    id: 'app-screen',
    label: 'App store screenshot',
    use: 'App Store / Google Play screen: a caption headline above a real product screenshot in a neutral phone frame. Presets app-store-ios (1290×2796) and play-store (1080×1920).',
    fields: [
      { id: 'headline', type: 'text', label: 'Caption (benefit, ≤ 5 words)', max: 32, help: '*word* = accent; must fit 2 lines' },
      { id: 'sub', type: 'text', label: 'Supporting line', max: 60, optional: true },
      { id: 'image', type: 'image', label: 'Phone screenshot (crop with #crop=x,y,w,h)' },
      { id: 'frame', type: 'enum', label: 'Device', choices: ['auto', 'full', 'bleed'], optional: true, help: 'bleed = the phone runs off the bottom for a bigger screen; auto = bleed on 9:16, full on taller canvases' },
    ],
    html: (f, ctx) => {
      const W = ctx.width;
      const pad = Math.round(W * 0.075);
      const hl = Math.round(fit(f.headline, [[14, W * 0.11], [22, W * 0.094], [32, W * 0.078]], W * 0.07));
      const bleed = f.frame === 'bleed' || (f.frame !== 'full' && ctx.height / W < 2);
      return `<div class="app" style="padding:${Math.round(pad * 1.25)}px ${pad}px ${bleed ? 0 : pad}px;gap:${Math.round(W * 0.05)}px">
<div style="display:flex;flex-direction:column;gap:${Math.round(W * 0.022)}px;width:100%"><h1 data-fit-lines="2" data-min-font="${Math.round(W * 0.06)}" style="font-size:${hl}px">${rich(f.headline)}</h1>${f.sub ? `<p class="sub" style="font-size:${Math.round(W * 0.04)}px">${rich(f.sub)}</p>` : ''}</div>
<div class="stage"><div class="dev${bleed ? ' bleed' : ''}"><i class="cam"></i><div class="scr"><img src="${img(f.image, ctx)}" alt=""></div></div></div></div>`;
    },
  },
  {
    id: 'gallery-shot',
    label: 'Launch gallery: headline + product',
    use: 'Launch-page gallery image (preset producthunt-gallery, 1270×760): one benefit headline over a big real screenshot that runs off the bottom. Use for the first image and most of the set.',
    fields: [
      { id: 'title', type: 'text', label: 'Headline (≤ 8 words)', max: 56, help: '*word* = accent' },
      { id: 'sub', type: 'text', label: 'Supporting line', max: 90, optional: true },
      { id: 'kicker', type: 'text', label: 'Kicker', max: 28, optional: true },
      { id: 'image', type: 'image', label: 'Screenshot (crop with #crop=x,y,w,h)' },
    ],
    html: (f, ctx) => {
      const pad = Math.round(ctx.width * 0.06);
      const t = fit(f.title, [[24, 76], [40, 64], [56, 54]], 48);
      return `<div class="c" style="flex-direction:column;padding:${pad}px ${pad}px 0;gap:22px;--k:26px">
<div class="hd">${logo(ctx)}${f.kicker ? `<span class="kick">${rich(f.kicker)}</span>` : ''}</div>
<h1 data-fit-lines="2" data-min-font="44" style="font-size:${t}px">${rich(f.title)}</h1>${f.sub ? `<p style="font-size:28px;line-height:1.3;margin-top:-6px">${rich(f.sub)}</p>` : ''}
<div class="frame" style="flex:1;min-height:0;margin:8px 0 -30px"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div></div>`;
    },
  },
  {
    id: 'gallery-points',
    label: 'Launch gallery: three reasons',
    use: 'A gallery image with a headline and three numbered reasons ("Title — detail"). Use once, mid-set, for the "why it\'s different" beat.',
    fields: [
      { id: 'title', type: 'text', label: 'Headline', max: 56 },
      { id: 'items', type: 'list', label: 'Reasons ("Title — detail", 3)', max: 3 },
    ],
    html: (f, ctx) => {
      const pad = Math.round(ctx.width * 0.06);
      const items = list(f.items).slice(0, 3);
      return `<div class="c" style="flex-direction:column;padding:${pad}px;gap:44px;justify-content:center">
<div class="hd">${logo(ctx)}</div>
<h1 data-fit-lines="2" data-min-font="44" style="font-size:${fit(f.title, [[24, 72], [40, 62], [56, 54]], 48)}px">${rich(f.title)}</h1>
<div style="display:grid;grid-template-columns:repeat(${Math.max(1, items.length)},1fr);gap:24px">${items
        .map((it, i) => {
          const [t, d] = it.split(/\s+[—–-]\s+/);
          return `<div style="background:var(--card);border-radius:24px;padding:32px;box-shadow:0 0 0 1px color-mix(in srgb,var(--rule) 45%,transparent)"><b style="display:block;font:800 40px/1 var(--font-display);color:var(--accent);margin-bottom:18px">${String(i + 1).padStart(2, '0')}</b><h3 style="font:700 32px/1.15 var(--font-display);letter-spacing:-.02em">${rich(t)}</h3>${d ? `<p style="font-size:24px;line-height:1.35;margin-top:10px">${rich(d)}</p>` : ''}</div>`;
        })
        .join('')}</div></div>`;
    },
  },
  {
    id: 'launch-thumb',
    label: 'Launch thumbnail (logo mark)',
    use: 'The 240×240 product thumbnail (preset producthunt-thumb): the brand mark alone, big and centred. No words — it is shown at 80 px.',
    fields: [
      { id: 'mark', type: 'text', label: 'Monogram if there is no logo', max: 2, optional: true },
      { id: 'bg', type: 'enum', label: 'Background', choices: ['light', 'dark', 'brand'], optional: true },
    ],
    html: (f, ctx) => {
      const bg = { dark: '#0f1115', brand: 'var(--brand-primary)' }[f.bg as string] ?? '#ffffff';
      const fg = f.bg === 'brand' ? 'var(--brand-on-primary)' : f.bg === 'dark' ? 'var(--accent-on-dark)' : 'var(--accent-on-light)';
      const s = Math.min(ctx.width, ctx.height);
      const mark = ctx.brand.logo
        ? `<img src="${img(ctx.brand.logo, ctx)}" alt="" style="width:${Math.round(s * 0.66)}px;height:${Math.round(s * 0.66)}px;object-fit:contain">`
        : `<span style="font:800 ${Math.round(s * 0.5)}px/1 var(--font-display);letter-spacing:-.05em;color:${fg}">${esc(String(f.mark ?? '').slice(0, 2) || initials(ctx.brand.name))}</span>`;
      return `<div class="c" style="align-items:center;justify-content:center;background:${bg}">${mark}</div>`;
    },
  },
  {
    id: 'profile-banner',
    label: 'Profile banner, cover or link preview',
    use: "One design for every profile header and link preview — linkedin-banner (personal), linkedin-company-banner, x-header, youtube-banner, facebook-cover, og-card and github-banner. Words and logo sit inside the preset's safe area and beside the profile photo; only the background motif bleeds to the edges. Use the same theme, motif and words on every size so the set reads as one brand.",
    fields: [
      { id: 'title', type: 'text', label: 'Headline (≤ 6 words)', max: 48, help: '*word* = accent' },
      { id: 'sub', type: 'text', label: 'Supporting line (≤ 12 words)', max: 90, optional: true },
      { id: 'url', type: 'text', label: 'URL or handle', max: 40, optional: true },
      { id: 'motif', type: 'enum', label: 'Background motif', choices: ['grid', 'rings', 'dots', 'plain'], optional: true },
      { id: 'align', type: 'enum', label: 'Alignment', choices: ['auto', 'center', 'start', 'end'], optional: true, help: 'auto = beside the profile photo, centred elsewhere' },
      { id: 'image', type: 'image', label: 'Screenshot (og-card and github-banner only; crop it)', optional: true },
    ],
    html: (f, ctx) => {
      const b = contentBox(ctx);
      const pad = Math.round(Math.min(b.w, b.h) * 0.08);
      const iw = b.w - pad * 2;
      const ih = b.h - pad * 2;
      const n = Math.max(10, String(f.title ?? '').replace(/[*=]/g, '').length);
      const shot = !!f.image && b.h >= 480;
      const row = !shot && b.w / b.h > 4.4;
      const tw = shot ? iw * 0.5 : row ? iw * 0.72 : iw;
      // Wide banners aim for a one-line headline; beside a screenshot the column is narrow, so two lines.
      const h1 = Math.round(Math.min(ih * (row ? 0.36 : shot ? 0.17 : 0.24), ((shot ? 2 : 1) * tw) / (n * (shot ? 0.6 : 0.5))));
      const sub = Math.round(h1 * (row || shot ? 0.5 : 0.42));
      // Banners are seen scaled to the screen: floors follow the strip every device shows, not the whole canvas.
      const floor = (k: number, min: number) => Math.max(min, Math.round(b.w * k));
      const align = f.align && f.align !== 'auto' ? String(f.align) : shot ? 'start' : ctx.safe?.avoid?.length ? 'end' : 'center';
      const ai = { start: 'flex-start', end: 'flex-end' }[align] ?? 'center';
      const ta = row || align === 'start' ? 'left' : align === 'end' ? 'right' : 'center';
      const mark = (px: number) => `<span class="pf-logo" data-s style="font-size:${px}px">${logo(ctx)}</span>`;
      const text = `<div class="pf-txt" style="align-items:${row ? 'flex-start' : ai};text-align:${ta};gap:${Math.round(h1 * 0.3)}px">${row ? '' : mark(Math.round(h1 * 0.7))}
<h1 data-s data-fit-lines="2" data-min-font="${floor(0.034, 20)}" style="font-size:${h1}px">${rich(f.title)}</h1>${f.sub ? `<p data-s data-min-font="${floor(0.017, 14)}" style="font-size:${sub}px">${rich(f.sub)}</p>` : ''}${f.url ? `<span class="pf-url" data-s data-min-font="${floor(0.015, 13)}" style="font-size:${Math.round(sub * 0.85)}px">${esc(f.url)}</span>` : ''}</div>`;
      const inner = row ? `${mark(Math.round(ih * 0.5))}<i class="pf-rule"></i>${text}` : shot ? `${text}<div class="frame" style="height:${ih - 8}px"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>` : text;
      const cx = Math.round(b.x + b.w / 2);
      const cy = Math.round(b.y + b.h / 2);
      return `<div class="pf-bg" style="--cx:${cx}px;--cy:${cy}px;--cell:${Math.max(24, Math.round(b.h / 6))}px;${MOTIFS[f.motif as string] ?? MOTIFS.grid}"></div>
<div class="pf-bg" style="background:radial-gradient(${Math.round(b.w * 0.7)}px ${Math.round(b.h * 1.3)}px at ${cx}px ${cy}px,color-mix(in srgb,var(--accent) 20%,transparent),transparent 70%)"></div>
<div class="c pf-box" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;padding:${pad}px;justify-content:${row ? 'flex-start' : ai}"><div class="pf-in${row ? ' row' : ''}${shot ? ' shot' : ''}" style="gap:${Math.round(row ? ih * 0.3 : pad)}px">${inner}</div></div>${PROFILE_FIT}`;
    },
  },
  {
    id: 'profile-avatar',
    label: 'Avatar / profile logo (circle-safe)',
    use: 'The 400×400 profile picture for every platform (preset profile-avatar): the brand mark alone, centred well inside the circle the platforms crop to, on the same ground as the banners. No words; a 1–2 letter monogram only when the brand has no logo.',
    fields: [
      { id: 'mark', type: 'text', label: 'Monogram if there is no logo', max: 2, optional: true },
      { id: 'bg', type: 'enum', label: 'Background', choices: ['theme', 'light', 'dark', 'brand'], optional: true, help: "theme = the set's ground (default)" },
    ],
    html: (f, ctx) => {
      const s = Math.min(ctx.width, ctx.height);
      const plain = { light: '#ffffff', dark: '#0f1115', brand: 'var(--brand-primary)' }[f.bg as string];
      const fg = f.bg === 'brand' ? 'var(--brand-on-primary)' : f.bg === 'dark' ? 'var(--accent-on-dark)' : f.bg === 'light' ? 'var(--accent-on-light)' : 'var(--accent)';
      // A square mark 0.58 × the side has its corners 0.41 × the side from the centre: inside the 0.5 circle with room to spare.
      const mark = ctx.brand.logo
        ? `<img src="${img(ctx.brand.logo, ctx)}" alt="" style="width:${Math.round(s * 0.58)}px;height:${Math.round(s * 0.58)}px;object-fit:contain">`
        : `<span style="font:800 ${Math.round(s * 0.36)}px/1 var(--font-display);letter-spacing:-.05em;color:${fg}">${esc(String(f.mark ?? '').slice(0, 2) || initials(ctx.brand.name))}</span>`;
      const bg = plain ?? 'var(--bg);background-image:radial-gradient(circle at 50% 50%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 62%)';
      return `<div class="c" style="align-items:center;justify-content:center;background:${bg}">${mark}</div>`;
    },
  },
  {
    id: 'case-card',
    label: 'Case study card',
    use: 'Social summary of a case study at linkedin-image (1080×1350) and linkedin-landscape (1200×627): customer, the result as the headline, 1–3 big numbers and an optional short quote. Real customers, numbers and words only; with no real story set sample: yes — the card is then labelled "Sample — replace with your customer".',
    fields: [
      { id: 'client', type: 'text', label: 'Customer', max: 40 },
      { id: 'title', type: 'text', label: 'Headline: the result (≤ 10 words)', max: 70, help: '*word* = accent' },
      { id: 'stats', type: 'list', label: 'Results: "value | label" (1–3)', max: 3 },
      { id: 'quote', type: 'text', label: 'Short quote (exact words)', max: 140, optional: true },
      { id: 'who', type: 'text', label: 'Quote by ("Name, Role")', max: 60, optional: true },
      { id: 'kicker', type: 'text', label: 'Kicker', max: 24, optional: true, help: 'default "Case study"' },
      { id: 'sample', type: 'enum', label: 'Sample story', choices: ['no', 'yes'], optional: true, help: 'yes = template copy, labelled on the image' },
    ],
    html: (f, ctx) => {
      const { land, u, pad } = quoteBox(ctx);
      const stats = list(f.stats).slice(0, 3).map((s) => s.split('|').map((x) => x.trim()));
      const k = Math.max(1, stats.length);
      const t = Math.round(fit(f.title, land ? [[30, 60], [50, 52], [70, 46]] : [[30, 92], [50, 80], [70, 70]], land ? 42 : 64));
      const vsz = land ? [[4, 76], [7, 62]] : k === 1 ? [[4, 190], [7, 150]] : k === 2 ? [[4, 140], [7, 112]] : [[4, 104], [7, 84]];
      const tag = isSample(f) ? '<span class="sample" data-sample>Sample — replace with your customer</span>' : '';
      const nums = `<div class="cs-nums${land ? ' col' : ''}" style="--n:${k}">${stats.map(([v, l]) => `<div class="cs-n"><b class="big" data-min-font="${land ? 40 : 56}" style="font-size:${fit(v, vsz as [number, number][], land ? 52 : 72)}px">${esc(v)}</b><span style="font-size:${land ? 22 : 28}px">${rich(l ?? '')}</span></div>`).join('')}</div>`;
      const quote = f.quote ? `<div class="cs-q" style="font-size:${land ? 24 : 34}px"><p style="color:inherit">“${rich(f.quote)}”</p>${f.who ? `<small>${esc(f.who)}</small>` : ''}</div>` : '';
      const head = `<div class="hd">${logo(ctx)}<span class="kick">${esc(f.kicker || 'Case study')}</span></div>`;
      const h = `<div style="display:flex;flex-direction:column;gap:${land ? 14 : 20}px"><div class="cs-client" style="font-size:${land ? 22 : 30}px">${esc(f.client)}</div><h1 data-min-font="${Math.round(t * 0.75)}" style="font-size:${t}px">${rich(f.title)}</h1></div>`;
      if (land) return `<div class="c" style="padding:${pad}px;gap:${pad}px;--k:22px;--s:18px"><div style="flex:1.3;min-width:0;display:flex;flex-direction:column;gap:22px;justify-content:space-between">${head}${h}${quote || tag ? `<div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start">${quote}${tag}</div>` : ''}</div>${nums}</div>`;
      return `<div class="c" style="flex-direction:column;justify-content:space-between;padding:${pad}px;gap:${Math.round(36 * u)}px;--k:30px;--s:24px">${head}${h}${nums}${quote}${tag ? `<div class="ft">${tag}</div>` : ''}</div>`;
    },
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
