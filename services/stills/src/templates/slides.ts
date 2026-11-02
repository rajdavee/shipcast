import { esc, img, list, logo, page, rich, type Layout, type RenderCtx } from './common.ts';
import { chartSvg } from './document.ts';

/**
 * Presentations: pitch decks, sales decks, webinar and board slides at
 * 1920×1080. Every piece of text carries the `t` class: the PPTX export
 * measures those boxes in Chrome and rebuilds them as editable text over a
 * text-free render of the same slide, so the deck stays designed and editable.
 */

export const SLIDE_THEMES: Record<string, { label: string; css: string }> = {
  light: {
    label: 'Light — white canvas, brand accents, calm and boardroom-safe',
    css: `:root{--bg:#ffffff;--fg:#12151b;--muted:#5d6472;--accent:var(--accent-on-light);--card:color-mix(in srgb,var(--brand-primary) 6%,#f6f7f9);--rule:#e4e7ec;--hero-bg:var(--brand-primary);--hero-fg:var(--brand-on-primary)}`,
  },
  dark: {
    label: 'Dark — near-black with a brand-colour glow, keynote energy',
    css: `:root{--bg:#0c0e13;--fg:#f3f5f9;--muted:#9aa3b3;--accent:var(--accent-on-dark);--card:rgba(255,255,255,.05);--rule:rgba(255,255,255,.12);--hero-bg:#0c0e13;--hero-fg:#f3f5f9}
body{background:radial-gradient(1100px 760px at 88% -12%,color-mix(in srgb,var(--brand-primary) 50%,transparent),transparent 70%),radial-gradient(900px 700px at -8% 112%,color-mix(in srgb,var(--brand-secondary) 32%,transparent),transparent 70%),var(--bg)!important}`,
  },
  brand: {
    label: 'Brand — title, section and closing slides in full brand colour, content slides light',
    css: `:root{--bg:#ffffff;--fg:#12151b;--muted:#5d6472;--accent:var(--accent-on-light);--card:color-mix(in srgb,var(--brand-primary) 6%,#f6f7f9);--rule:#e4e7ec;--hero-bg:var(--brand-primary);--hero-fg:var(--brand-on-primary)}`,
  },
};

const BASE = `
html,body{background:var(--bg);color:var(--fg)}
.s{position:relative;width:100%;height:100%;padding:96px 120px 88px;display:flex;flex-direction:column;gap:36px}
.s.hero{background:var(--hero-bg);color:var(--hero-fg)}
.theme-light .s.hero{background:var(--bg);color:var(--fg)}
.foot{position:absolute;left:120px;right:120px;bottom:40px;display:flex;justify-content:space-between;align-items:center;font:600 20px/1 var(--font-body);color:var(--muted)}
.s.hero .foot{color:color-mix(in srgb,currentColor 70%,transparent)}
.logo{height:40px;width:auto;max-width:240px;object-fit:contain;align-self:flex-start;flex:none}
.s.hero img.logo{background:#fff;border-radius:12px;padding:8px 12px;height:58px;box-shadow:0 10px 30px -14px rgba(0,0,0,.4)}
.theme-light .s.hero img.logo{background:none;padding:0;box-shadow:none;height:40px}
.s.hero .src{color:inherit;opacity:.78}
.wordmark{font:800 30px/1 var(--font-display)}
.kicker{font:700 24px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.s.hero .kicker{color:inherit;opacity:.85}
h1{font:800 104px/1.0 var(--font-display);letter-spacing:-.04em;text-wrap:balance;max-width:1500px}
h2{font:800 68px/1.06 var(--font-display);letter-spacing:-.035em;text-wrap:balance;max-width:1500px}
.sub{font:500 34px/1.4 var(--font-body);color:var(--muted);max-width:1300px;text-wrap:pretty}
.s.hero .sub{color:inherit;opacity:.85}
em{font-style:normal;color:var(--accent)}
.s.hero em{color:inherit;text-decoration:underline;text-decoration-thickness:.08em;text-underline-offset:.12em}
mark{background:color-mix(in srgb,var(--brand-primary) 24%,transparent);color:inherit;padding:0 .1em}
.grow{flex:1;min-height:0;display:flex;gap:56px}
.col{flex:1;min-width:0;display:flex;flex-direction:column;gap:22px;justify-content:center}
ul.bul{list-style:none;display:grid;gap:22px}
ul.bul li{font:500 34px/1.35 var(--font-body);padding-left:42px;position:relative}
ul.bul li::before{content:"";position:absolute;left:0;top:.48em;width:16px;height:16px;border-radius:5px;background:var(--brand-primary)}
.shot{border-radius:24px;overflow:hidden;box-shadow:0 40px 80px -36px rgba(0,0,0,.5),0 0 0 1px var(--rule);flex:1.25;min-width:0;align-self:center;max-height:100%}
.shot img{width:100%;height:100%;object-fit:cover;object-position:top left}
.cards{display:grid;gap:28px;margin:auto 0;align-items:stretch}
.cards.n2{grid-template-columns:repeat(2,1fr)}.cards.n3{grid-template-columns:repeat(3,1fr)}.cards.n4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border-radius:28px;padding:40px;display:flex;flex-direction:column;gap:16px;border:1px solid var(--rule)}
.card h3{font:750 40px/1.15 var(--font-display);letter-spacing:-.02em}
.card p{font:450 28px/1.42 var(--font-body);color:var(--muted)}
.ic{width:64px;height:64px;border-radius:16px;object-fit:contain;background:color-mix(in srgb,var(--brand-primary) 12%,transparent);padding:12px}
.ic.mono{display:grid;place-items:center;font:800 28px var(--font-display);color:var(--brand-primary)}
.big{font:800 128px/0.95 var(--font-display);letter-spacing:-.05em;color:var(--brand-primary)}
.lbl{font:600 30px/1.3 var(--font-body)}
.src{font:500 20px/1.3 var(--font-body);color:var(--muted)}
.quote{font:650 64px/1.22 var(--font-display);letter-spacing:-.025em;text-wrap:balance;max-width:1560px}
.qm{font:800 220px/0.5 var(--font-display);color:var(--brand-primary);height:110px}
.who{display:flex;gap:24px;align-items:center}.who img{width:96px;height:96px;border-radius:50%;object-fit:cover}
.who b{display:block;font:700 32px/1.2 var(--font-body)}.who span{font:500 26px/1.3 var(--font-body);color:var(--muted)}
.steps{display:grid;gap:24px;flex:1;align-content:center}
.steps.h{grid-auto-flow:column;grid-auto-columns:1fr;align-content:center;margin:auto 0;gap:40px}
.step{display:grid;gap:14px;align-content:start;border-top:6px solid var(--brand-primary);padding-top:28px}
.step .n{font:800 30px/1 var(--font-display);color:var(--brand-primary)}
.step h3{font:750 42px/1.12 var(--font-display);letter-spacing:-.02em}.step p{font:450 28px/1.42 var(--font-body);color:var(--muted)}
.step .n{font-size:36px!important}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:auto 0}
.vs .side{border-radius:28px;padding:48px;display:flex;flex-direction:column;gap:20px}
.vs .old{background:color-mix(in srgb,var(--fg) 6%,transparent);color:var(--muted)}.vs .new{background:var(--brand-primary);color:var(--brand-on-primary)}
.vs h3{font:800 44px/1.1 var(--font-display)}.vs li{font:500 36px/1.35 var(--font-body);margin-left:36px;margin-top:16px}
.vs .side{min-height:440px}
.tiers{display:grid;gap:28px;margin:auto 0}
.tier{background:var(--card);border:1px solid var(--rule);border-radius:28px;padding:44px;display:flex;flex-direction:column;gap:14px}
.tier.hot{background:var(--brand-primary);color:var(--brand-on-primary);border-color:transparent}
.tier .price{font:800 72px/1 var(--font-display);letter-spacing:-.04em}
.tier li{font:500 26px/1.4 var(--font-body);margin-left:28px}
.team{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:32px;flex:1;align-content:center}
.person{display:grid;gap:10px;justify-items:start}.person img{width:180px;height:180px;border-radius:50%;object-fit:cover}
.person .ph{width:180px;height:180px;border-radius:50%;display:grid;place-items:center;background:var(--card);font:800 64px var(--font-display);color:var(--brand-primary)}
.person b{font:750 36px/1.15 var(--font-display)}.person span{font:500 26px/1.35 var(--font-body);color:var(--muted)}
.chartbox{flex:1.3;min-width:0;background:var(--card);border-radius:28px;padding:44px;display:flex;align-items:center}
.chart .cl{font:500 15px var(--font-body);fill:var(--fg)}.chart .cv{font:700 16px var(--font-body);fill:var(--fg)}
.agenda{list-style:none;display:grid;gap:8px;counter-reset:a;flex:1;align-content:center}
.agenda li{counter-increment:a;display:flex;gap:36px;align-items:baseline;padding:22px 0;border-bottom:2px solid var(--rule);font:700 48px/1.15 var(--font-display);letter-spacing:-.02em}
.agenda li::before{content:counter(a,decimal-leading-zero);font:800 30px/1 var(--font-display);color:var(--brand-primary);min-width:60px}
.full{position:absolute;inset:0}.full img{width:100%;height:100%;object-fit:cover}
.cap{position:absolute;left:120px;bottom:80px;max-width:1200px;padding:28px 36px;border-radius:24px;background:rgba(10,12,16,.72);color:#fff;font:600 34px/1.35 var(--font-body);backdrop-filter:blur(10px)}
.btn{display:inline-flex;align-items:center;gap:14px;background:var(--hero-fg);color:var(--hero-bg);font:750 34px/1 var(--font-body);padding:28px 40px;border-radius:999px;width:max-content}
.theme-light .s.hero .btn{background:var(--brand-primary);color:var(--brand-on-primary)}
.url{font:700 36px/1 var(--font-body)}
.center{justify-content:center}
`;

const ic = (name: unknown, ctx: RenderCtx) => {
  const uri = ctx.icons?.[String(name ?? '')];
  return uri ? `<img class="ic" src="${uri}" alt="">` : `<span class="ic mono">${esc(String(name ?? '•').slice(0, 1).toUpperCase())}</span>`;
};
const foot = (ctx: RenderCtx) => `<div class="foot"><span class="t">${logo(ctx)}</span><span class="t">${ctx.page ?? ''}</span></div>`;
const split = (s: string) => s.split('|').map((x) => x.trim());

export const SLIDE_LAYOUTS: Layout[] = [
  {
    id: 'title',
    label: 'Title',
    use: 'Opening slide: kicker, a promise-shaped title, one-line subtitle, presenter/date line; optional product image.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', max: 40, optional: true },
      { id: 'title', type: 'text', label: 'Title', max: 70, help: '*word* = accent' },
      { id: 'subtitle', type: 'text', label: 'Subtitle', max: 140, optional: true },
      { id: 'meta', type: 'text', label: 'Presenter · date', max: 80, optional: true },
      { id: 'image', type: 'image', label: 'Product image', optional: true },
    ],
    html: (f, ctx) => `<div class="s hero"><div>${logo(ctx)}</div><div class="grow"><div class="col">${f.kicker ? `<div class="kicker t">${esc(f.kicker)}</div>` : ''}<h1 class="t">${rich(f.title)}</h1>${f.subtitle ? `<p class="sub t">${rich(f.subtitle)}</p>` : ''}${f.meta ? `<p class="src t">${esc(f.meta)}</p>` : ''}</div>${f.image ? `<div class="shot"><img src="${img(f.image, ctx)}" alt=""></div>` : ''}</div></div>`,
  },
  {
    id: 'agenda',
    label: 'Agenda',
    use: '3–6 agenda items, short.',
    fields: [{ id: 'heading', type: 'text', label: 'Heading', max: 40, optional: true }, { id: 'items', type: 'list', label: 'Items', max: 6 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading ?? 'Agenda')}</h2><ol class="agenda">${list(f.items).map((x) => `<li class="t">${rich(x)}</li>`).join('')}</ol>${foot(ctx)}</div>`,
  },
  {
    id: 'section',
    label: 'Section divider',
    use: 'Starts a part of the talk: number and title.',
    fields: [{ id: 'number', type: 'text', label: 'Number', max: 4, optional: true }, { id: 'title', type: 'text', label: 'Title', max: 60 }],
    html: (f, ctx) => `<div class="s hero center">${f.number ? `<div class="big t" style="color:inherit;opacity:.35">${esc(f.number)}</div>` : ''}<h1 class="t">${rich(f.title)}</h1>${foot(ctx)}</div>`,
  },
  {
    id: 'statement',
    label: 'Big statement',
    use: 'One bold claim or insight that the next slides prove. Huge type, optional one-line support.',
    fields: [{ id: 'title', type: 'text', label: 'Statement', max: 110, help: '*accent* the key phrase' }, { id: 'sub', type: 'text', label: 'Support line', max: 160, optional: true }],
    html: (f, ctx) => `<div class="s center"><h1 class="t">${rich(f.title)}</h1>${f.sub ? `<p class="sub t">${rich(f.sub)}</p>` : ''}${foot(ctx)}</div>`,
  },
  {
    id: 'bullets',
    label: 'Points + image',
    use: 'Headline that states the takeaway, 3–5 short points, optional product shot on the right. The default content slide.',
    fields: [{ id: 'heading', type: 'text', label: 'Takeaway headline', max: 80 }, { id: 'points', type: 'list', label: 'Points (≤ 12 words each)', max: 5 }, { id: 'image', type: 'image', label: 'Image', optional: true }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="grow"><div class="col"><ul class="bul t">${list(f.points).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div>${f.image ? `<div class="shot"><img src="${img(f.image, ctx)}" alt=""></div>` : ''}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'cards',
    label: 'Cards (problems, features, benefits)',
    use: '2–4 cards with an icon name, a title and one or two sentences: the problem, the features, the benefits.',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 80 }, { id: 'items', type: 'list', label: 'Cards: "icon | title | body" — icon is a brand name ("Slack") or a plain icon word ("inbox", "shield-check", "calendar-clock")', max: 4 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="cards n${Math.min(4, Math.max(2, list(f.items).length))}">${list(f.items).map((x) => { const [i, t, b] = split(x); return `<div class="card">${ic(i, ctx)}<h3 class="t">${rich(t ?? '')}</h3><p class="t">${rich(b ?? '')}</p></div>`; }).join('')}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'product',
    label: 'Product shot',
    use: 'A large real screenshot with a headline and up to 3 callouts beside it.',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 70 }, { id: 'image', type: 'image', label: 'Screenshot' }, { id: 'points', type: 'list', label: 'Callouts', max: 3, optional: true }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="grow"><div class="shot" style="flex:2.2"><img src="${img(f.image, ctx)}" alt=""></div>${list(f.points).length ? `<div class="col"><ul class="bul t">${list(f.points).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div>` : ''}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'metrics',
    label: 'Metrics',
    use: '2–4 big verified numbers with labels and sources (traction, results, market).',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 80 }, { id: 'stats', type: 'list', label: '"value | label | source"', max: 4 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="cards n${Math.min(4, Math.max(2, list(f.stats).length))}">${list(f.stats).map((x) => { const [v, l, s] = split(x); return `<div class="card" style="justify-content:center"><div class="big t">${esc(v)}</div><div class="lbl t">${rich(l ?? '')}</div>${s ? `<div class="src t">${esc(s)}</div>` : ''}</div>`; }).join('')}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'chart',
    label: 'Chart',
    use: 'One chart proving one point (bar, column, line, donut) plus 1–3 takeaways and a source.',
    fields: [{ id: 'heading', type: 'text', label: 'Takeaway headline', max: 80 }, { id: 'chart', type: 'text', label: 'Chart JSON: {"type","unit","data":[{"label","value"}]}' }, { id: 'points', type: 'list', label: 'Takeaways', max: 3, optional: true }, { id: 'source', type: 'text', label: 'Source', max: 120, optional: true }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="grow"><div class="chartbox">${chartSvg(typeof f.chart === 'string' ? (() => { try { return JSON.parse(f.chart); } catch { return {}; } })() : f.chart ?? {}, 900, 460)}</div>${list(f.points).length ? `<div class="col"><ul class="bul t">${list(f.points).map((x) => `<li>${rich(x)}</li>`).join('')}</ul>${f.source ? `<p class="src t">Source: ${esc(f.source)}</p>` : ''}</div>` : ''}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'comparison',
    label: 'Before / after',
    use: 'The old way vs your way, 3–5 points a side.',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 80 }, { id: 'leftTitle', type: 'text', label: 'Left title', max: 30 }, { id: 'left', type: 'list', label: 'Left', max: 5 }, { id: 'rightTitle', type: 'text', label: 'Right title', max: 30 }, { id: 'right', type: 'list', label: 'Right', max: 5 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="vs"><div class="side old"><h3 class="t">${rich(f.leftTitle)}</h3><ul class="t">${list(f.left).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div><div class="side new"><h3 class="t">${rich(f.rightTitle)}</h3><ul class="t">${list(f.right).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div></div>${foot(ctx)}</div>`,
  },
  {
    id: 'timeline',
    label: 'Timeline / how it works / roadmap',
    use: '3–5 steps left to right: "title | body" (prefix a date for a roadmap).',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 80 }, { id: 'steps', type: 'list', label: '"title | body"', max: 5 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="steps h">${list(f.steps).map((x, i) => { const [t, b] = split(x); return `<div class="step"><div class="n t">${String(i + 1).padStart(2, '0')}</div><h3 class="t">${rich(t)}</h3><p class="t">${rich(b ?? '')}</p></div>`; }).join('')}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'quote',
    label: 'Quote',
    use: 'A real customer or expert quote (never invented) with name, role and optional photo/logo.',
    fields: [{ id: 'quote', type: 'longtext', label: 'Quote', max: 220 }, { id: 'name', type: 'text', label: 'Name', max: 50 }, { id: 'role', type: 'text', label: 'Role, company', max: 70, optional: true }, { id: 'image', type: 'image', label: 'Photo or logo', optional: true }],
    html: (f, ctx) => `<div class="s center"><div class="qm">“</div><blockquote class="quote t">${rich(f.quote)}</blockquote><div class="who">${f.image ? `<img src="${img(f.image, ctx)}" alt="">` : ''}<div><b class="t">${esc(f.name)}</b><span class="t">${esc(f.role ?? '')}</span></div></div>${foot(ctx)}</div>`,
  },
  {
    id: 'team',
    label: 'Team',
    use: 'Founders/team from the brief: "name | role | photo path (optional)". Never generate or guess faces; without a photo an initial is shown.',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 60 }, { id: 'people', type: 'list', label: '"name | role | photo?"', max: 6 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="team">${list(f.people).map((x) => { const [n, r, p] = split(x); return `<div class="person">${p ? `<img src="${img(p, ctx)}" alt="">` : `<div class="ph">${esc((n ?? '?').slice(0, 1))}</div>`}<b class="t">${esc(n)}</b><span class="t">${esc(r ?? '')}</span></div>`; }).join('')}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'pricing',
    label: 'Pricing',
    use: '2–4 tiers: "name | price | note | feature; feature; feature". Mark the recommended tier with a leading "*". Only real prices from the brief.',
    fields: [{ id: 'heading', type: 'text', label: 'Headline', max: 60 }, { id: 'tiers', type: 'list', label: 'Tiers', max: 4 }],
    html: (f, ctx) => `<div class="s"><h2 class="t">${rich(f.heading)}</h2><div class="tiers" style="grid-template-columns:repeat(${Math.min(4, Math.max(2, list(f.tiers).length))},1fr)">${list(f.tiers).map((x) => { const hot = x.startsWith('*'); const [n, p, note, feats] = split(x.replace(/^\*/, '')); return `<div class="tier ${hot ? 'hot' : ''}"><div class="lbl t">${esc(n)}</div><div class="price t">${esc(p ?? '')}</div>${note ? `<div class="src t" style="color:inherit;opacity:.8">${esc(note)}</div>` : ''}<ul class="t">${(feats ?? '').split(';').map((y) => y.trim()).filter(Boolean).map((y) => `<li>${rich(y)}</li>`).join('')}</ul></div>`; }).join('')}</div>${foot(ctx)}</div>`,
  },
  {
    id: 'image',
    label: 'Full-bleed image',
    use: 'A full-slide photo or screenshot with one caption line. Use sparingly for emotion or proof.',
    fields: [{ id: 'image', type: 'image', label: 'Image' }, { id: 'caption', type: 'text', label: 'Caption', max: 120, optional: true }],
    html: (f, ctx) => `<div class="s" style="padding:0"><div class="full"><img src="${img(f.image, ctx)}" alt=""></div>${f.caption ? `<div class="cap t">${rich(f.caption)}</div>` : ''}</div>`,
  },
  {
    id: 'closing',
    label: 'Closing / CTA',
    use: 'Last slide: the ask, one button-style CTA, URL and contact.',
    fields: [{ id: 'title', type: 'text', label: 'The ask', max: 70 }, { id: 'cta', type: 'text', label: 'CTA', max: 36 }, { id: 'url', type: 'text', label: 'URL', max: 60 }, { id: 'contact', type: 'text', label: 'Contact', max: 100, optional: true }],
    html: (f, ctx) => `<div class="s hero center">${logo(ctx)}<h1 class="t">${rich(f.title)}</h1><div class="btn t">${esc(f.cta)} →</div><div class="url t">${esc(f.url)}</div>${f.contact ? `<p class="sub t">${esc(f.contact)}</p>` : ''}</div>`,
  },
];

export interface SlidePage {
  layout: string;
  fields: Record<string, any>;
  /** Speaker notes for this slide. */
  notes?: string;
}

export function slideIconNames(slides: SlidePage[]): string[] {
  return slides.flatMap((s) => list(s.fields?.items).map((x) => x.split('|')[0].trim())).filter(Boolean);
}

export function renderSlide(s: SlidePage, theme: string, ctx: RenderCtx): string {
  const l = SLIDE_LAYOUTS.find((x) => x.id === s.layout);
  if (!l) throw new Error(`unknown slide layout "${s.layout}" (have: ${SLIDE_LAYOUTS.map((x) => x.id).join(', ')})`);
  const t = SLIDE_THEMES[theme] ? theme : 'brand';
  return page(`<div class="theme-${t}" style="width:100%;height:100%">${l.html(s.fields ?? {}, ctx)}</div>`, ctx, SLIDE_THEMES[t].css, BASE);
}

/**
 * Measure every `.t` box for the editable PPTX layer, in slide pixels. Runs in
 * the page; returns plain data.
 */
export const MEASURE_TEXT_SCRIPT = `(() => {
  const hex = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g); if (!m) return '000000'; return m.slice(0, 3).map((x) => Math.round(+x).toString(16).padStart(2, '0')).join(''); };
  const alpha = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return 1; const p = m[1].split(','); return p.length > 3 ? +p[3] : 1; };
  const out = [];
  document.querySelectorAll('.t').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const cs = getComputedStyle(el);
    const isList = el.tagName === 'UL' || el.tagName === 'OL';
    const text = isList ? [...el.querySelectorAll('li')].map((li) => li.innerText.trim()).join('\\n') : el.innerText.trim();
    if (!text) return;
    // Text painted with a gradient clip reports a transparent colour; fall back to the first coloured child or white.
    let color = cs.color; if (alpha(color) < 0.2) { const k = el.querySelector('*'); color = k ? getComputedStyle(k).color : 'rgb(255,255,255)'; }
    const li = isList ? el.querySelector('li') : null;
    const fcs = li ? getComputedStyle(li) : cs;
    const fs = parseFloat(fcs.fontSize);
    const lh = parseFloat(fcs.lineHeight);
    out.push({ text, x: r.left, y: r.top, w: r.width, h: r.height, size: fs, bold: (+fcs.fontWeight || 400) >= 600, color: hex(color), font: fcs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), align: ['center', 'right'].includes(cs.textAlign) ? cs.textAlign : 'left', bullets: isList, lineSpacing: lh && fs ? lh / fs : 1.2 });
  });
  return out;
})()`;

/** Hide the editable text so the background render carries only the design. */
export const HIDE_TEXT_CSS = `.t,.t *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important}.t li::before{opacity:0!important}.t img{opacity:1}`;
