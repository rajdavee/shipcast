import { esc, fit, img, list, logo, page, rich, type Layout, type RenderCtx } from './common.ts';

/**
 * Carousel system: 9 layouts × 4 themes. Layouts own structure and type
 * scale; themes own color, texture and ornament. Designed at 1080×1350
 * (LinkedIn document / Instagram 4:5) and reflow to 1080×1080.
 */

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

export const THEMES: Record<string, { label: string; css: string }> = {
  editorial: {
    label: 'Editorial — huge type on your brand background',
    css: `
:root{--bg:var(--brand-bg);--fg:var(--brand-text);--muted:var(--brand-muted);--accent:var(--accent-on-bg);--card:var(--brand-surface);--rule:color-mix(in srgb,var(--fg) 14%,transparent)}
body{background:var(--bg);color:var(--fg)}
body::after{content:"";position:fixed;inset:0;background:${GRAIN};opacity:.18;mix-blend-mode:overlay;pointer-events:none}
.ghost{color:color-mix(in srgb,var(--fg) 6%,transparent)}
em{font-style:normal;color:var(--accent)}
mark{background:var(--accent);color:var(--bg);padding:0 .12em;border-radius:.08em;box-decoration-break:clone;-webkit-box-decoration-break:clone}`,
  },
  swiss: {
    label: 'Swiss — light grid, rules and big numerals',
    css: `
:root{--bg:#f6f7f9;--fg:#0e1014;--muted:#5d6370;--accent:var(--accent-on-light);--card:#ffffff;--rule:#0e1014}
body{background:var(--bg);color:var(--fg);background-image:linear-gradient(to right,rgba(14,16,20,.05) 1px,transparent 1px);background-size:calc((100% - 192px)/12) 100%;background-position:96px 0}
.ghost{color:rgba(14,16,20,.06)}
em{font-style:normal;color:var(--accent)}
mark{background:var(--accent);color:var(--bg);padding:0 .1em}
.title,.big{letter-spacing:-.045em}
.bottom .bar{background:rgba(14,16,20,.12)}`,
  },
  bold: {
    label: 'Bold — full-bleed brand color, chunky blocks',
    css: `
:root{--bg:var(--brand-primary);--fg:var(--brand-on-primary);--muted:color-mix(in srgb,var(--brand-on-primary) 72%,transparent);--accent:var(--brand-on-primary);--card:color-mix(in srgb,var(--brand-on-primary) 10%,transparent);--rule:color-mix(in srgb,var(--brand-on-primary) 30%,transparent)}
body{background:var(--bg);color:var(--fg)}
body::after{content:"";position:fixed;inset:0;background:${GRAIN};opacity:.22;mix-blend-mode:soft-light;pointer-events:none}
.ghost{color:color-mix(in srgb,var(--fg) 10%,transparent)}
em{font-style:normal;text-decoration:underline;text-decoration-thickness:.09em;text-underline-offset:.1em}
mark{background:var(--fg);color:var(--bg);padding:0 .12em}
img.logo{background:var(--fg);border-radius:12px;padding:6px 10px;height:52px}`,
  },
  midnight: {
    label: 'Midnight — dark glass with a brand-colored glow',
    css: `
:root{--bg:#0b0d12;--fg:#f2f4f8;--muted:#9aa2b2;--accent:var(--accent-on-dark);--card:rgba(255,255,255,.05);--rule:rgba(255,255,255,.12)}
body{background:radial-gradient(900px 700px at 85% -10%,color-mix(in srgb,var(--brand-primary) 55%,transparent),transparent 70%),radial-gradient(800px 600px at -10% 110%,color-mix(in srgb,var(--brand-secondary) 40%,transparent),transparent 70%),var(--bg);color:var(--fg)}
body::after{content:"";position:fixed;inset:0;background:${GRAIN};opacity:.12;mix-blend-mode:overlay;pointer-events:none}
.ghost{color:rgba(255,255,255,.05)}
em{font-style:normal;background:linear-gradient(90deg,var(--accent-on-dark),var(--accent2-on-dark));-webkit-background-clip:text;background-clip:text;color:transparent}
mark{background:var(--accent);color:var(--bg);padding:0 .12em;border-radius:.1em}
.card,.shot{backdrop-filter:blur(8px);border:1px solid var(--rule)}`,
  },
};

const BASE = `
.slide{position:relative;width:100%;height:100%;padding:96px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center;font:600 26px/1 var(--font-body);color:var(--muted);letter-spacing:-.01em;min-height:44px}
.logo{height:40px;width:auto;max-width:240px;object-fit:contain}
.wordmark{font:800 30px/1 var(--font-display);color:var(--fg);letter-spacing:-.03em}
.count{font-variant-numeric:tabular-nums}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}
.bottom{display:flex;align-items:center;gap:24px;font:500 26px/1.2 var(--font-body);color:var(--muted)}
.bar{flex:1;height:6px;border-radius:3px;background:var(--rule);overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);border-radius:3px}
.kicker{font:700 30px/1.2 var(--font-body);color:var(--accent);letter-spacing:-.005em;margin-bottom:36px}
.title{font-family:var(--font-display);font-weight:800;line-height:.98;letter-spacing:-.04em;text-wrap:balance}
.sub{font:500 38px/1.35 var(--font-body);color:var(--muted);margin-top:40px;text-wrap:pretty;max-width:26ch}
.ghost{position:absolute;right:56px;top:40px;font:900 420px/1 var(--font-display);letter-spacing:-.06em;z-index:0;pointer-events:none}
.slide>*{position:relative;z-index:1}
.slide>.ghost{position:absolute;z-index:0}
.swipe{display:inline-flex;align-items:center;gap:14px;font:700 30px/1 var(--font-body);color:var(--fg)}
.swipe svg{width:44px;height:44px}
.points{list-style:none;display:flex;flex-direction:column;gap:30px;margin-top:48px}
.points li{display:grid;grid-template-columns:76px 1fr;gap:24px;align-items:start}
.points b{font:800 44px/1 var(--font-display);color:var(--accent);font-variant-numeric:tabular-nums;letter-spacing:-.03em;padding-top:4px}
.points h4{font:700 40px/1.15 var(--font-display);letter-spacing:-.025em}
.points p{font:500 30px/1.35 var(--font-body);color:var(--muted);margin-top:8px}
.big{font:900 260px/.9 var(--font-display);letter-spacing:-.06em;color:var(--accent);font-variant-numeric:tabular-nums}
.card{background:var(--card);border-radius:28px;padding:48px}
.quote{font:600 58px/1.18 var(--font-display);letter-spacing:-.025em;text-wrap:balance}
.quote::before{content:"“";display:block;font:900 200px/.6 var(--font-display);color:var(--accent);margin-bottom:20px}
.who{display:flex;align-items:center;gap:20px;margin-top:48px;font:600 30px/1.25 var(--font-body)}
.who small{display:block;font-weight:500;color:var(--muted);font-size:26px}
.avatar{width:84px;height:84px;border-radius:50%;object-fit:cover;background:var(--accent);flex:none}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:48px}
.col{border-radius:24px;padding:40px 36px;background:var(--card)}
.col h5{font:800 30px/1 var(--font-body);letter-spacing:.02em;margin-bottom:28px;color:var(--muted)}
.col.good h5{color:var(--accent)}
.col ul{list-style:none;display:flex;flex-direction:column;gap:22px}
.col li{font:600 32px/1.25 var(--font-body);display:grid;grid-template-columns:36px 1fr;gap:12px}
.col.bad li::before{content:"✕";color:var(--muted)}
.col.good li::before{content:"✓";color:var(--accent);font-weight:900}
.shot{margin-top:48px;border-radius:24px;overflow:hidden;box-shadow:0 30px 80px -30px rgba(0,0,0,.55),0 0 0 1px var(--rule);background:var(--card)}
.shot .chrome{height:44px;display:flex;align-items:center;gap:10px;padding:0 18px;background:color-mix(in srgb,var(--fg) 6%,transparent)}
.shot .chrome i{width:13px;height:13px;border-radius:50%;background:color-mix(in srgb,var(--fg) 22%,transparent)}
.shot img{width:100%;height:auto;max-height:620px;object-fit:contain}
.caption{font:500 30px/1.35 var(--font-body);color:var(--muted);margin-top:28px}
.cta-btn{display:inline-flex;align-items:center;gap:14px;margin-top:48px;padding:28px 44px;border-radius:999px;background:var(--accent);color:var(--bg);font:800 36px/1 var(--font-body);letter-spacing:-.01em;align-self:flex-start}
.url{font:600 32px/1.2 var(--font-mono);color:var(--muted);margin-top:28px}
.nudges{display:flex;gap:16px;margin-top:56px;flex-wrap:wrap}
.nudges span{border:2px solid var(--rule);border-radius:999px;padding:16px 26px;font:700 26px/1 var(--font-body)}
.stepnum{font:800 34px/1 var(--font-body);color:var(--accent);margin-bottom:28px;letter-spacing:.01em}
`;

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function frame(inner: string, ctx: RenderCtx, { ghost = '', bare = false } = {}): string {
  const n = ctx.page ?? 1;
  const N = ctx.pages ?? 1;
  const pct = Math.round((n / N) * 100);
  return `<div class="slide">${ghost ? `<div class="ghost" data-safe-ignore>${esc(ghost)}</div>` : ''}
<div class="top">${logo(ctx)}<span class="count">${bare ? '' : `${String(n).padStart(2, '0')} / ${String(N).padStart(2, '0')}`}</span></div>
<div class="body">${inner}</div>
<div class="bottom">${ctx.handle ? `<span>${esc(ctx.handle)}</span>` : ''}<div class="bar"><i style="width:${pct}%"></i></div></div>
</div>`;
}


/** "Label: A, B, C" or "A, B, C" → chips. */
const splitNames = (v: string) => v.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
const chip = (name: string, ctx: RenderCtx) => {
  const icon = ctx.icons?.[name];
  return `<span class="lchip">${icon ? `<i style="background-image:url('${icon}')"></i>` : `<b class="mono">${esc(name[0] ?? '•')}</b>`}${esc(name)}</span>`;
};
/** Every logo name a slide will show, so the service can resolve them first. */
export function carouselIconNames(layout: string, f: Record<string, any>): string[] {
  if (layout === 'platforms') return list(f.groups).flatMap((g) => splitNames(g.includes(':') ? g.split(':').slice(1).join(':') : g));
  if (layout === 'journey') return list(f.steps).flatMap((s) => (s.includes('|') ? splitNames(s.split('|')[1]) : []));
  return [];
}
const VISUAL_CSS = `
.lchip{display:inline-flex;align-items:center;gap:14px;padding:12px 24px 12px 12px;border-radius:999px;background:var(--card);border:2px solid var(--rule);font:700 30px/1 var(--font-body);white-space:nowrap}
.lchip i,.lchip .mono{width:48px;height:48px;flex:none;border-radius:50%;background:#fff center/68% no-repeat;box-shadow:0 0 0 1px rgba(0,0,0,.06)}
.lchip .mono{display:grid;place-items:center;background:var(--accent);color:var(--bg);font:800 24px/1 var(--font-body)}
.groups{display:grid;gap:28px;margin-top:48px}
.group{display:grid;gap:16px}
.group h5{margin:0;font:800 24px/1 var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:14px}
.sticky{position:relative;background:#fde58a;color:#22200f;padding:44px 48px 48px;font:700 60px/1.12 'Kalam','Comic Sans MS',cursive;transform:rotate(-2.2deg);box-shadow:0 30px 50px -28px rgba(0,0,0,.55);max-width:820px}
.sticky::before{content:"";position:absolute;top:-22px;left:50%;width:150px;height:42px;margin-left:-75px;background:rgba(255,255,255,.55);transform:rotate(3deg);box-shadow:0 2px 6px rgba(0,0,0,.12)}
.sticky.sm{font-size:40px;padding:28px 34px;max-width:600px;align-self:flex-end;margin-top:36px;transform:rotate(2deg)}
.jrow{display:grid;grid-template-columns:340px 1fr;gap:36px;align-items:center}
.jpill{display:flex;align-items:center;gap:18px;padding:34px 28px;border-radius:24px;background:var(--fg);color:var(--bg);font:800 40px/1.08 var(--font-display);letter-spacing:-.02em}
.jpill b{flex:none;display:grid;place-items:center;width:54px;height:54px;border-radius:50%;background:var(--accent);color:var(--bg);font:800 22px/1 var(--font-body)}
.jdet p{margin:0 0 16px;font:500 36px/1.28 var(--font-body);color:var(--fg)}
.jdet .chips{gap:10px}.jdet .lchip{font-size:24px;padding:8px 18px 8px 8px}.jdet .lchip i,.jdet .lchip .mono{width:38px;height:38px}
.jdown{width:340px;display:grid;place-items:center;height:64px;color:var(--muted)}
.jdown svg{width:30px;height:30px;transform:rotate(90deg)}
`;

export const CAROUSEL_LAYOUTS: Layout[] = [
  {
    id: 'cover',
    label: 'Cover',
    use: 'Slide 1. A specific promise, number or tension that makes people swipe. Never "Introducing X".',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', max: 40, optional: true },
      { id: 'title', type: 'text', label: 'Headline', max: 70, help: 'Wrap one or two words in *stars* for the accent color.' },
      { id: 'subtitle', type: 'text', label: 'Subline', max: 110, optional: true },
    ],
    html: (f, ctx) =>
      frame(
        `${f.kicker ? `<div class="kicker">${rich(f.kicker)}</div>` : ''}<h1 class="title" style="font-size:${fit(f.title, [[22, 150], [36, 128], [52, 108], [70, 92]], 80)}px">${rich(f.title)}</h1>${f.subtitle ? `<p class="sub">${rich(f.subtitle)}</p>` : ''}<div style="margin-top:64px"><span class="swipe">Swipe ${ARROW}</span></div>`,
        ctx,
        { bare: true },
      ),
  },
  {
    id: 'statement',
    label: 'Statement',
    use: 'One idea, said big. Problem, stakes, or a turning point.',
    fields: [
      { id: 'title', type: 'text', label: 'Statement', max: 90 },
      { id: 'body', type: 'longtext', label: 'Support', max: 180, optional: true },
    ],
    html: (f, ctx) => frame(`<h2 class="title" style="font-size:${fit(f.title, [[30, 116], [50, 96], [70, 84], [90, 72]], 64)}px">${rich(f.title)}</h2>${f.body ? `<p class="sub" style="max-width:30ch">${rich(f.body)}</p>` : ''}`, ctx, { ghost: String(ctx.page ?? '') }),
  },
  {
    id: 'points',
    label: 'Numbered points',
    use: 'A framework, checklist or "N things". 3–5 items, each a short title and an optional detail.',
    fields: [
      { id: 'title', type: 'text', label: 'Heading', max: 60 },
      { id: 'items', type: 'list', label: 'Items (one per line, "Title — detail")', max: 5 },
    ],
    html: (f, ctx) => {
      const items = list(f.items).slice(0, 5);
      const tight = items.length > 4;
      return frame(
        `<h2 class="title" style="font-size:${fit(f.title, [[24, 84], [40, 72], [60, 62]], 56)}px">${rich(f.title)}</h2><ol class="points" style="${tight ? 'gap:22px' : ''}">${items
          .map((it, i) => {
            const [t, d] = it.split(/\s+[—–-]\s+/);
            return `<li><b>${String(i + 1).padStart(2, '0')}</b><div><h4>${rich(t)}</h4>${d ? `<p>${rich(d)}</p>` : ''}</div></li>`;
          })
          .join('')}</ol>`,
        ctx,
      );
    },
  },
  {
    id: 'step',
    label: 'Step',
    use: 'One step of a how-to. Optional screenshot of the real product for that step.',
    fields: [
      { id: 'step', type: 'text', label: 'Step label', max: 20, help: 'e.g. "Step 2"' },
      { id: 'title', type: 'text', label: 'Title', max: 60 },
      { id: 'body', type: 'longtext', label: 'Body', max: 160, optional: true },
      { id: 'image', type: 'image', label: 'Screenshot', optional: true },
    ],
    html: (f, ctx) =>
      frame(
        `<div class="stepnum">${esc(f.step)}</div><h2 class="title" style="font-size:${fit(f.title, [[24, 88], [40, 74], [60, 62]], 56)}px">${rich(f.title)}</h2>${f.body ? `<p class="sub" style="max-width:32ch;font-size:34px">${rich(f.body)}</p>` : ''}${f.image ? `<div class="shot"><div class="chrome"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}" style="max-height:${ctx.height > 1200 ? 540 : 360}px"></div>` : ''}`,
        ctx,
      ),
  },
  {
    id: 'stat',
    label: 'Big number',
    use: 'A real, sourced number from the brief. Never invent one.',
    fields: [
      { id: 'value', type: 'text', label: 'Number', max: 8, help: 'e.g. 10×, 92%, 3 min' },
      { id: 'label', type: 'text', label: 'What it measures', max: 70 },
      { id: 'context', type: 'longtext', label: 'Context / source', max: 140, optional: true },
    ],
    html: (f, ctx) =>
      frame(`<div class="big" style="font-size:${fit(f.value, [[3, 300], [5, 240], [8, 180]], 150)}px">${esc(f.value)}</div><h2 class="title" style="font-size:64px;margin-top:36px">${rich(f.label)}</h2>${f.context ? `<p class="sub">${rich(f.context)}</p>` : ''}`, ctx),
  },
  {
    id: 'quote',
    label: 'Quote',
    use: 'A real testimonial or a line from the founder. Attribution required.',
    fields: [
      { id: 'quote', type: 'longtext', label: 'Quote', max: 170 },
      { id: 'name', type: 'text', label: 'Name', max: 40 },
      { id: 'role', type: 'text', label: 'Role', max: 50, optional: true },
      { id: 'avatar', type: 'image', label: 'Photo', optional: true },
    ],
    html: (f, ctx) =>
      frame(
        `<div class="card"><p class="quote" style="font-size:${fit(f.quote, [[70, 64], [120, 54], [170, 46]], 42)}px">${rich(f.quote)}</p><div class="who">${f.avatar ? `<img class="avatar" src="${img(f.avatar, ctx)}">` : `<span class="avatar"></span>`}<span>${esc(f.name)}${f.role ? `<small>${esc(f.role)}</small>` : ''}</span></div></div>`,
        ctx,
      ),
  },
  {
    id: 'compare',
    label: 'Before / after',
    use: 'Old way vs new way, myth vs reality. 2–4 short lines per side.',
    fields: [
      { id: 'title', type: 'text', label: 'Heading', max: 50 },
      { id: 'leftLabel', type: 'text', label: 'Left label', max: 18 },
      { id: 'left', type: 'list', label: 'Left items', max: 4 },
      { id: 'rightLabel', type: 'text', label: 'Right label', max: 18 },
      { id: 'right', type: 'list', label: 'Right items', max: 4 },
    ],
    html: (f, ctx) =>
      frame(
        `<h2 class="title" style="font-size:${fit(f.title, [[24, 80], [50, 64]], 56)}px">${rich(f.title)}</h2><div class="cols"><div class="col bad"><h5>${esc(f.leftLabel)}</h5><ul>${list(f.left)
          .slice(0, 4)
          .map((x) => `<li><span>${rich(x)}</span></li>`)
          .join('')}</ul></div><div class="col good"><h5>${esc(f.rightLabel)}</h5><ul>${list(f.right)
          .slice(0, 4)
          .map((x) => `<li><span>${rich(x)}</span></li>`)
          .join('')}</ul></div></div>`,
        ctx,
      ),
  },
  {
    id: 'image',
    label: 'Product shot',
    use: 'Show the real product. Title above, framed screenshot, one-line caption.',
    fields: [
      { id: 'title', type: 'text', label: 'Title', max: 60 },
      { id: 'image', type: 'image', label: 'Screenshot' },
      { id: 'caption', type: 'text', label: 'Caption', max: 100, optional: true },
    ],
    html: (f, ctx) =>
      frame(
        `<h2 class="title" style="font-size:${fit(f.title, [[24, 80], [44, 66]], 58)}px">${rich(f.title)}</h2><div class="shot"><div class="chrome"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}" style="max-height:${ctx.height > 1200 ? 680 : 470}px"></div>${f.caption ? `<p class="caption">${rich(f.caption)}</p>` : ''}`,
        ctx,
      ),
  },
  {
    id: 'platforms',
    label: 'Where it happens (logos)',
    use: 'Show the real places/tools your audience uses, grouped, with real logos. For "where buyers research", "your stack", "where to post". 2–4 groups of 2–6 names. Optional sticky-note thought.',
    fields: [
      { id: 'title', type: 'text', label: 'Heading', max: 60 },
      { id: 'groups', type: 'list', label: 'Groups (one per line, "Label: A, B, C")', max: 4 },
      { id: 'note', type: 'text', label: 'Sticky-note thought', max: 60, optional: true },
    ],
    html: (f, ctx) => {
      const groups = list(f.groups).slice(0, 4).map((g) => (g.includes(':') ? { label: g.split(':')[0].trim(), names: splitNames(g.split(':').slice(1).join(':')) } : { label: '', names: splitNames(g) }));
      return frame(
        `<h2 class="title" style="font-size:${fit(f.title, [[24, 84], [40, 72], [60, 62]], 56)}px">${rich(f.title)}</h2><div class="groups">${groups
          .map((g) => `<div class="group">${g.label ? `<h5>${esc(g.label)}</h5>` : ''}<div class="chips">${g.names.slice(0, 6).map((n) => chip(n, ctx)).join('')}</div></div>`)
          .join('')}</div>${f.note ? `<div class="sticky sm">“${esc(String(f.note).replace(/^[“"]|[”"]$/g, ''))}”</div>` : ''}`,
        ctx,
      );
    },
  },
  {
    id: 'journey',
    label: 'Mini journey (stages + logos)',
    use: 'A 3–4 stage journey on one slide: each stage pill, what happens, and the real platforms. Lines like "Discover — they ask AI and Reddit | ChatGPT, Reddit, YouTube".',
    fields: [
      { id: 'title', type: 'text', label: 'Heading', max: 60 },
      { id: 'steps', type: 'list', label: 'Stages ("Stage — what happens | A, B, C")', max: 4 },
    ],
    html: (f, ctx) => {
      const steps = list(f.steps).slice(0, 4).map((l) => {
        const [main, names] = l.split('|');
        const [stage, ...rest] = main.split(/\s+[—–-]\s+/);
        return { stage: stage.trim(), what: rest.join(' — ').trim(), names: names ? splitNames(names) : [] };
      });
      const down = `<div class="jdown">${ARROW}</div>`;
      return frame(
        `<h2 class="title" style="font-size:${fit(f.title, [[24, 80], [40, 68], [60, 58]], 52)}px;margin-bottom:40px">${rich(f.title)}</h2>${steps
          .map((st, i) => `${i ? down : ''}<div class="jrow"><div class="jpill"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(st.stage)}</span></div><div class="jdet">${st.what ? `<p>${rich(st.what)}</p>` : ''}${st.names.length ? `<div class="chips">${st.names.slice(0, 4).map((n) => chip(n, ctx)).join('')}</div>` : ''}</div></div>`)
          .join('')}`,
        ctx,
      );
    },
  },
  {
    id: 'note',
    label: 'Sticky note',
    use: 'One human thought, hand-written on a sticky note — what your customer is really thinking. Great slide 2 or a pattern break.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Who / when', max: 40, optional: true, help: 'e.g. "What your buyer thinks at 11pm"' },
      { id: 'thought', type: 'text', label: 'Thought', max: 90 },
      { id: 'body', type: 'longtext', label: 'What it means', max: 160, optional: true },
    ],
    html: (f, ctx) =>
      frame(
        `${f.kicker ? `<div class="kicker">${rich(f.kicker)}</div>` : ''}<div class="sticky" style="font-size:${fit(f.thought, [[30, 76], [60, 64], [90, 54]], 50)}px;margin-top:24px">“${esc(String(f.thought).replace(/^[“"]|[”"]$/g, ''))}”</div>${f.body ? `<p class="sub" style="margin-top:72px;max-width:30ch">${rich(f.body)}</p>` : ''}`,
        ctx,
      ),
  },
  {
    id: 'cta',
    label: 'Call to action',
    use: 'Last slide. One clear action, the URL, and a save/repost nudge.',
    fields: [
      { id: 'title', type: 'text', label: 'Closing line', max: 60 },
      { id: 'button', type: 'text', label: 'Action', max: 28 },
      { id: 'url', type: 'text', label: 'URL', max: 60, optional: true },
    ],
    html: (f, ctx) =>
      frame(
        `<h2 class="title" style="font-size:${fit(f.title, [[22, 120], [40, 96], [60, 80]], 72)}px">${rich(f.title)}</h2><span class="cta-btn">${esc(f.button)} ${ARROW.replace('<svg', '<svg width="36" height="36"')}</span>${f.url ? `<div class="url">${esc(f.url)}</div>` : ''}<div class="nudges"><span>♡ Save for later</span><span>↻ Repost</span></div>`,
        ctx,
        { bare: true },
      ),
  },
];

export function renderCarouselSlide(layoutId: string, theme: string, fields: Record<string, any>, ctx: RenderCtx): string {
  const layout = CAROUSEL_LAYOUTS.find((l) => l.id === layoutId);
  if (!layout) throw new Error(`unknown carousel layout "${layoutId}" (have: ${CAROUSEL_LAYOUTS.map((l) => l.id).join(', ')})`);
  const t = THEMES[theme] ?? THEMES.editorial;
  const square = ctx.height <= ctx.width;
  const html = layout.html(fields, ctx);
  const hand = /sticky/.test(html) ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kalam:wght@700&display=swap">` : '';
  return page(hand + html, ctx, t.css, BASE + VISUAL_CSS + (square ? '.slide{padding:80px}.title{zoom:.86}.sub{font-size:32px}.points{gap:20px;margin-top:32px}' : ''));
}
