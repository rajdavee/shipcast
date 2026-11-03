import { basename } from 'node:path';
import { brandCss, fontLinks, PLACEHOLDER_NAME, type BrandKit } from '@shipcast/engine';
import { esc, iconTag, list, rich } from './common.ts';

/**
 * Landing-page sections: semantic, responsive HTML/CSS in the brand kit that a
 * marketer can ship as a page, hand to a developer, or paste section by section
 * into a site builder. No framework, no build step, no JavaScript needed.
 */

export interface LandingSection {
  type: 'hero' | 'logos' | 'features' | 'how' | 'stats' | 'testimonials' | 'comparison' | 'versus' | 'choose' | 'pricing' | 'faq' | 'cta' | 'media' | 'event' | 'speakers' | 'agenda';
  [k: string]: any;
}

export interface LandingSpec {
  title: string;
  description?: string;
  theme?: 'light' | 'dark' | 'brand';
  nav?: { label: string; href: string }[];
  sections: LandingSection[];
  footer?: string;
}

const split = (s: string) => s.split('|').map((x) => x.trim());

function icon(name: string, icons: Record<string, string | null>) {
  const uri = icons[name];
  return uri ? iconTag(uri, 'ic') : `<span class="ic mono" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span>`;
}

/** Comparison cells: yes / no / partial (or ✓ ✗ ~), with readable words for screen readers and plain-text copy. */
export function verdict(v: unknown): 'yes' | 'no' | 'partial' | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (/^(yes|✓|✔|y|true)$/.test(t)) return 'yes';
  if (/^(no|✗|✕|×|x|n|false)$/.test(t)) return 'no';
  if (/^(partial|partly|~|◐|some|limited)$/.test(t)) return 'partial';
  return null;
}
function cell(v: unknown): string {
  const k = verdict(v);
  if (!k) return `<td>${rich(v)}</td>`;
  return `<td class="v-${k}"><span aria-hidden="true">${{ yes: '✓', no: '✗', partial: '◐' }[k]}</span><span class="sr">${{ yes: 'Yes', no: 'No', partial: 'Partly' }[k]}</span></td>`;
}

const initials = (n: string) => n.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function section(s: LandingSection, img: (p: string) => string, icons: Record<string, string | null>): string {
  const head = (k?: string, h?: string, sub?: string) => `${k ? `<p class="eyebrow">${esc(k)}</p>` : ''}${h ? `<h2>${rich(h)}</h2>` : ''}${sub ? `<p class="lede">${rich(sub)}</p>` : ''}`;
  switch (s.type) {
    case 'hero':
      return `<section class="hero" id="top"><div class="wrap hero-grid"><div class="hero-copy">${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}<h1>${rich(s.headline)}</h1>${s.sub ? `<p class="lede">${rich(s.sub)}</p>` : ''}<div class="actions">${s.cta ? `<a class="btn" href="${esc(s.url ?? '#')}">${esc(s.cta)}</a>` : ''}${s.secondary ? `<a class="btn ghost" href="${esc(s.secondaryUrl ?? '#')}">${esc(s.secondary)}</a>` : ''}</div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div>${s.image ? `<figure class="shot"><img src="${img(s.image)}" alt="${esc(s.alt ?? 'Product screenshot')}" loading="eager"></figure>` : ''}</div></section>`;
    case 'logos':
      return `<section class="logos"><div class="wrap">${s.heading ? `<p class="eyebrow center">${esc(s.heading)}</p>` : ''}<ul>${list(s.items).map((x) => `<li>${icons[x] ? iconTag(icons[x], 'lg-ic', 'var(--muted)', x) : esc(x)}</li>`).join('')}</ul></div></section>`;
    case 'features':
      return `<section class="features" id="features"><div class="wrap">${head(s.eyebrow, s.heading, s.sub)}<div class="grid g${Math.min(4, Math.max(2, list(s.items).length % 3 === 0 ? 3 : list(s.items).length >= 4 ? 4 : 2))}">${list(s.items).map((x) => { const [i, t, b] = split(x); return `<article class="card">${icon(i, icons)}<h3>${rich(t ?? '')}</h3><p>${rich(b ?? '')}</p></article>`; }).join('')}</div></div></section>`;
    case 'media':
      if (!s.image) return section({ ...s, type: 'features', items: s.points ?? [], sub: s.body }, img, icons);
      return `<section class="media"><div class="wrap split ${s.side === 'left' ? 'flip' : ''}"><div>${head(s.eyebrow, s.heading, s.body)}${list(s.points).length ? `<ul class="checks">${list(s.points).map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}</div><figure class="shot"><img src="${img(s.image)}" alt="${esc(s.alt ?? s.heading ?? '')}" loading="lazy"></figure></div></section>`;
    case 'how':
      return `<section class="how" id="how"><div class="wrap">${head(s.eyebrow, s.heading, s.sub)}<ol class="steps">${list(s.steps).map((x, n) => { const [t, b] = split(x); return `<li><span class="n">${n + 1}</span><h3>${rich(t)}</h3><p>${rich(b ?? '')}</p></li>`; }).join('')}</ol></div></section>`;
    case 'stats':
      return `<section class="stats"><div class="wrap">${head(s.eyebrow, s.heading)}<dl>${list(s.stats).map((x) => { const [v, l, src] = split(x); return `<div><dt>${esc(v)}</dt><dd>${rich(l ?? '')}${src ? `<small>${esc(src)}</small>` : ''}</dd></div>`; }).join('')}</dl></div></section>`;
    case 'testimonials':
      return `<section class="quotes"><div class="wrap">${head(s.eyebrow, s.heading)}<div class="grid g${Math.min(3, Math.max(1, list(s.items).length))}">${list(s.items).map((x) => { const [q, n, r] = split(x); return `<figure class="card quote"><blockquote>“${rich(q)}”</blockquote><figcaption><b>${esc(n ?? '')}</b>${r ? `<span>${esc(r)}</span>` : ''}</figcaption></figure>`; }).join('')}</div></div></section>`;
    case 'comparison':
      return `<section class="compare"><div class="wrap">${head(s.eyebrow, s.heading)}<div class="vs"><div class="side old"><h3>${rich(s.leftTitle ?? 'Before')}</h3><ul>${list(s.left).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div><div class="side new"><h3>${rich(s.rightTitle ?? 'After')}</h3><ul>${list(s.right).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div></div></div></section>`;
    case 'versus':
      // Names only, never marks: a comparison page shows no one else's logo.
      return `<section class="versus" id="compare"><div class="wrap">${head(s.eyebrow, s.heading, s.sub)}<div class="vt-wrap"><table class="vt"><thead><tr><th scope="col"></th><th scope="col" class="us">${esc(s.us ?? 'Us')}</th><th scope="col">${esc(s.them ?? 'Them')}</th></tr></thead><tbody>${list(s.rows).map((x) => { const [f, a, b, note] = split(x); return `<tr><th scope="row">${rich(f)}${note ? `<small>${rich(note)}</small>` : ''}</th>${cell(a)}${cell(b)}</tr>`; }).join('')}</tbody></table></div>${list(s.sources).length ? `<p class="vt-src">${list(s.sources).map(esc).join(' · ')}</p>` : ''}</div></section>`;
    case 'choose':
      return `<section class="choose"><div class="wrap">${head(s.eyebrow, s.heading ?? 'Who should pick which', s.sub)}<div class="grid g2"><article class="card pick us"><h3>Pick ${esc(s.us ?? 'us')} if…</h3><ul class="checks">${list(s.usFor).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></article><article class="card pick"><h3>Pick ${esc(s.them ?? 'them')} if…</h3><ul class="checks">${list(s.themFor).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></article></div></div></section>`;
    case 'pricing':
      return `<section class="pricing" id="pricing"><div class="wrap">${head(s.eyebrow, s.heading, s.sub)}<div class="grid g${Math.min(4, Math.max(2, list(s.tiers).length))}">${list(s.tiers).map((x) => { const hot = x.startsWith('*'); const [n, p, note, feats, cta] = split(x.replace(/^\*/, '')); return `<article class="card tier ${hot ? 'hot' : ''}">${hot ? '<span class="badge">Most popular</span>' : ''}<h3>${esc(n)}</h3><p class="price">${esc(p ?? '')}</p>${note ? `<p class="muted">${esc(note)}</p>` : ''}<ul class="checks">${(feats ?? '').split(';').map((y) => y.trim()).filter(Boolean).map((y) => `<li>${rich(y)}</li>`).join('')}</ul><a class="btn ${hot ? '' : 'ghost'}" href="${esc(s.url ?? '#')}">${esc(cta || s.cta || 'Get started')}</a></article>`; }).join('')}</div></div></section>`;
    case 'faq':
      return `<section class="faq" id="faq"><div class="wrap narrow">${head(s.eyebrow, s.heading ?? 'Questions')}${list(s.items).map((x) => { const [q, a] = split(x); return `<details><summary>${rich(q)}</summary><p>${rich(a ?? '')}</p></details>`; }).join('')}</div></section>`;
    case 'event':
      // An event hero: the when is as prominent as the what, and the register button sits right under it.
      return `<section class="hero event" id="top"><div class="wrap hero-grid"><div class="hero-copy">${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}<h1>${rich(s.headline)}</h1>${s.sub ? `<p class="lede">${rich(s.sub)}</p>` : ''}<div class="actions">${s.cta ? `<a class="btn" href="${esc(s.url ?? '#')}">${esc(s.cta)}</a>` : ''}</div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div><dl class="when"><div><dt>Date</dt><dd>${esc(s.date)}</dd></div><div><dt>Time</dt><dd>${esc(s.time)} ${esc(s.timezone)}</dd></div>${s.where ? `<div><dt>Where</dt><dd>${esc(s.where)}</dd></div>` : ''}${s.length ? `<div><dt>Length</dt><dd>${esc(s.length)}</dd></div>` : ''}</dl></div></section>`;
    case 'speakers':
      return `<section class="speakers" id="speakers"><div class="wrap">${head(s.eyebrow, s.heading ?? 'Speakers', s.sub)}<div class="grid g${Math.min(3, Math.max(1, list(s.items).length))}">${list(s.items).map((x) => { const [n, r, p] = split(x); const ph = PLACEHOLDER_NAME.test((n ?? '').trim()); return `<article class="card person${ph ? ' ph' : ''}">${p ? `<img src="${img(p)}" alt="${esc(n ?? '')}">` : `<span class="av" aria-hidden="true">${ph ? '?' : esc(initials(n ?? ''))}</span>`}<h3>${esc(n ?? '')}</h3>${r ? `<p>${esc(r)}</p>` : ''}${ph ? '<p class="note">Speaker to be confirmed</p>' : ''}</article>`; }).join('')}</div></div></section>`;
    case 'agenda':
      return `<section class="agenda" id="agenda"><div class="wrap narrow">${head(s.eyebrow, s.heading ?? 'Agenda', s.sub)}<ol class="ag">${list(s.items).map((x) => { const [t, ti, d] = split(x); return `<li><span class="t">${esc(t)}</span><div><h3>${rich(ti ?? '')}</h3>${d ? `<p>${rich(d)}</p>` : ''}</div></li>`; }).join('')}</ol></div></section>`;
    case 'cta':
      return `<section class="final"><div class="wrap center">${head(undefined, s.heading, s.sub)}<div class="actions center">${s.cta ? `<a class="btn" href="${esc(s.url ?? '#')}">${esc(s.cta)}</a>` : ''}</div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div></section>`;
  }
  return '';
}

const CSS = `
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font:400 17px/1.6 var(--font-body),system-ui,sans-serif;color:var(--fg);background:var(--bg);-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}a{color:inherit}
.wrap{max-width:1160px;margin:0 auto;padding:0 24px}.narrow{max-width:760px}.center{text-align:center;justify-content:center}
section{padding:96px 0}section+section{border-top:1px solid var(--rule)}
h1{font:800 clamp(40px,6vw,68px)/1.04 var(--font-display);letter-spacing:-.035em;margin:0 0 20px;text-wrap:balance}
h2{font:800 clamp(30px,4vw,44px)/1.1 var(--font-display);letter-spacing:-.03em;margin:0 0 14px;text-wrap:balance}
h3{font:700 20px/1.3 var(--font-display);margin:0 0 8px}
em{font-style:normal;color:var(--accent)}mark{background:color-mix(in srgb,var(--brand-primary) 22%,transparent);color:inherit}
.eyebrow{font:700 13px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
.lede{font-size:20px;color:var(--muted);max-width:680px;margin:0 0 8px;text-wrap:pretty}.center .lede{margin-left:auto;margin-right:auto}
.note{font-size:14px;color:var(--muted);margin-top:14px}.muted{color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 24px;border-radius:999px;background:var(--brand-primary);color:var(--brand-on-primary);font:700 16px/1 var(--font-body);text-decoration:none;border:2px solid var(--brand-primary)}
.btn:hover{filter:brightness(1.07)}.btn.ghost{background:transparent;color:var(--fg);border-color:var(--rule)}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.topbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--rule)}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;height:68px;gap:20px}
.topbar nav{display:flex;gap:22px;font:600 15px var(--font-body)}.topbar nav a{text-decoration:none;color:var(--muted)}
.brandmark{display:flex;align-items:center;gap:10px;font:800 20px var(--font-display);text-decoration:none}.brandmark img{height:30px;width:auto}
.hero{padding:88px 0 96px}.hero-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:56px;align-items:center}
.shot{margin:0;border-radius:18px;overflow:hidden;box-shadow:0 40px 80px -40px rgba(0,0,0,.45),0 0 0 1px var(--rule)}
.logos{padding:44px 0}.logos ul{list-style:none;display:flex;flex-wrap:wrap;justify-content:center;gap:28px 48px;margin:18px 0 0;padding:0;font:700 18px var(--font-display);color:var(--muted)}.logos img,.logos .lg-ic{height:30px;width:auto;max-width:140px;object-fit:contain;filter:grayscale(1);opacity:.75}.logos .lg-ic.icm{width:30px;-webkit-mask-size:contain!important;mask-size:contain!important}
.grid{display:grid;gap:24px;margin-top:40px}.g2{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}.g1{grid-template-columns:1fr}
.card{background:var(--card);border:1px solid var(--rule);border-radius:20px;padding:28px}
.card p{color:var(--muted);margin:0}
.ic{width:44px;height:44px;border-radius:12px;background:color-mix(in srgb,var(--brand-primary) 12%,transparent);padding:9px;margin-bottom:16px;object-fit:contain}
.ic.mono{display:grid;place-items:center;font:800 18px var(--font-display);color:var(--brand-primary)}
.split{display:grid;grid-template-columns:1fr 1.2fr;gap:56px;align-items:center}.split.flip>figure{order:-1}
.checks{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:10px}.checks li{padding-left:30px;position:relative}.checks li::before{content:"✓";position:absolute;left:0;color:var(--accent);font-weight:800}
.steps{list-style:none;padding:0;margin:40px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px}
.steps .n{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--brand-primary);color:var(--brand-on-primary);font:800 18px var(--font-display);margin-bottom:14px}.steps p{color:var(--muted);margin:0}
.stats dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;margin:36px 0 0}
.stats dt{font:800 56px/1 var(--font-display);letter-spacing:-.04em;color:var(--accent)}.stats dd{margin:10px 0 0;font-weight:600}.stats small{display:block;color:var(--muted);font-weight:400;margin-top:4px}
.quote blockquote{margin:0 0 18px;font:600 19px/1.5 var(--font-display)}.quote figcaption b{display:block}.quote figcaption span{color:var(--muted);font-size:15px}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:36px}.side{border-radius:20px;padding:32px}.side.old{background:color-mix(in srgb,var(--fg) 5%,transparent);color:var(--muted)}.side.new{background:var(--brand-primary);color:var(--brand-on-primary)}.side ul{margin:12px 0 0;padding-left:20px;display:grid;gap:8px}
.tier{display:flex;flex-direction:column;gap:6px;position:relative}.tier .price{font:800 40px/1.1 var(--font-display);letter-spacing:-.03em;color:var(--fg);margin:6px 0}.tier .btn{margin-top:auto;justify-content:center}.tier .checks{margin-bottom:24px}
.tier.hot{border:2px solid var(--brand-primary)}.badge{position:absolute;top:-13px;left:24px;background:var(--brand-primary);color:var(--brand-on-primary);font:700 12px/1 var(--font-body);padding:7px 12px;border-radius:999px}
.vt-wrap{overflow-x:auto;margin-top:36px;border:1px solid var(--rule);border-radius:20px}
.vt{width:100%;border-collapse:collapse;font-size:16px}.vt th,.vt td{padding:16px 20px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}.vt tr:last-child>*{border-bottom:0}
.vt thead th{font:800 17px/1.2 var(--font-display);background:var(--card)}.vt thead th.us{color:var(--accent)}
.vt td{text-align:center;width:22%;font-size:20px;font-weight:800}.vt td.v-yes{color:var(--accent)}.vt td.v-no{color:var(--muted)}.vt td.v-partial{color:var(--fg)}
.vt tbody th{font-weight:600}.vt tbody th small{display:block;font-weight:400;font-size:14px;color:var(--muted);margin-top:4px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.vt-src{font-size:14px;color:var(--muted);margin-top:14px}
.pick.us{border:2px solid var(--brand-primary)}.pick h3{font-size:22px}
details{border-bottom:1px solid var(--rule);padding:20px 0}summary{cursor:pointer;font:700 19px/1.35 var(--font-display);list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:"+";float:right;color:var(--accent)}details[open] summary::after{content:"–"}details p{color:var(--muted);margin:12px 0 0}
.final{background:var(--hero-bg);color:var(--hero-fg)}.final em{color:inherit;text-decoration:underline;text-decoration-thickness:.08em;text-underline-offset:.1em}.final .lede{color:inherit;opacity:.85}.final .btn{background:var(--hero-fg);color:var(--hero-bg);border-color:var(--hero-fg)}
.when{display:grid;gap:14px;margin:0;align-self:center;background:var(--card);border:1px solid var(--rule);border-radius:24px;padding:32px}.when div{display:grid;gap:4px}.when dt{font:700 13px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.when dd{margin:0;font:800 clamp(24px,3vw,34px)/1.15 var(--font-display);letter-spacing:-.02em}
.hero.event .hero-grid{grid-template-columns:1.3fr 1fr}
.person{display:grid;justify-items:start;gap:6px}.person img,.person .av{width:72px;height:72px;border-radius:50%;object-fit:cover;margin-bottom:10px}.person .av{display:grid;place-items:center;background:var(--brand-primary);color:var(--brand-on-primary);font:800 24px var(--font-display)}.person.ph{border-style:dashed}.person.ph .av{background:var(--rule);color:var(--muted)}
.ag{list-style:none;padding:0;margin:36px 0 0;display:grid}.ag li{display:grid;grid-template-columns:110px 1fr;gap:20px;padding:20px 0;border-bottom:1px solid var(--rule)}.ag li:last-child{border-bottom:0}.ag .t{font:700 16px/1.5 var(--font-mono);color:var(--accent)}.ag h3{margin:0}.ag p{color:var(--muted);margin:6px 0 0}
footer{padding:40px 0;color:var(--muted);font-size:14px;border-top:1px solid var(--rule)}
@media (max-width:860px){section{padding:64px 0}.hero-grid,.split,.hero.event .hero-grid{grid-template-columns:1fr}.split.flip>figure{order:0}.g3,.g4{grid-template-columns:1fr 1fr}.vs{grid-template-columns:1fr}.topbar nav{display:none}}
@media (max-width:560px){.g2,.g3,.g4{grid-template-columns:1fr}h1{font-size:40px}.ag li{grid-template-columns:1fr;gap:4px}}
`;

const THEMES: Record<string, string> = {
  light: `:root{--bg:#ffffff;--fg:#12151b;--muted:#5d6472;--accent:var(--accent-on-light);--card:#f7f8fa;--rule:#e6e8ec;--hero-bg:var(--brand-primary);--hero-fg:var(--brand-on-primary)}`,
  dark: `:root{--bg:#0c0e13;--fg:#f2f4f8;--muted:#a1a9b8;--accent:var(--accent-on-dark);--card:#141821;--rule:#232834;--hero-bg:#141821;--hero-fg:#f2f4f8}
.hero{background:radial-gradient(900px 500px at 85% 0%,color-mix(in srgb,var(--brand-primary) 40%,transparent),transparent 70%)}`,
  brand: `:root{--bg:#ffffff;--fg:#12151b;--muted:#5d6472;--accent:var(--accent-on-light);--card:#f7f8fa;--rule:#e6e8ec;--hero-bg:var(--brand-primary);--hero-fg:var(--brand-on-primary)}
.hero{background:var(--brand-primary);color:var(--brand-on-primary)}.hero .lede,.hero .note{color:inherit;opacity:.85}.hero .eyebrow{color:inherit;opacity:.85}.hero em{color:inherit;text-decoration:underline;text-decoration-thickness:.08em;text-underline-offset:.1em}
.hero .btn{background:var(--brand-on-primary);color:var(--brand-primary);border-color:var(--brand-on-primary)}.hero .btn.ghost{background:transparent;color:inherit;border-color:color-mix(in srgb,currentColor 40%,transparent)}`,
};

export interface RenderedLanding {
  html: string;
  sections: { type: string; html: string }[];
  images: { src: string; name: string }[];
  copy: string;
}

/** Render the page; images are referenced as images/… next to index.html. */
export function renderLanding(spec: LandingSpec, brand: BrandKit, resolve: (p: string) => string, icons: Record<string, string | null>): RenderedLanding {
  const images: { src: string; name: string }[] = [];
  const img = (p: string) => {
    const src = resolve(p);
    const hit = images.find((x) => x.src === src);
    if (hit) return hit.name;
    const name = `images/${images.length + 1}-${basename(src).replace(/[^\w.-]/g, '_')}`;
    images.push({ src, name });
    return name;
  };
  const theme = THEMES[spec.theme ?? 'light'] ?? THEMES.light;
  const sections = spec.sections.map((s) => ({ type: s.type, html: section(s, img, icons) }));
  const logo = brand.logo ? `<img src="${img(brand.logo)}" alt="">` : '';
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.title)}</title>${spec.description ? `<meta name="description" content="${esc(spec.description)}">` : ''}<meta property="og:title" content="${esc(spec.title)}">${spec.description ? `<meta property="og:description" content="${esc(spec.description)}">` : ''}${fontLinks(brand)}<style>${brandCss(brand)}${theme}${CSS}</style>`;
  const nav = `<header class="topbar"><div class="wrap"><a class="brandmark" href="#top">${logo}<span>${esc(brand.name)}</span></a><nav>${(spec.nav ?? []).map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join('')}</nav></div></header>`;
  const html = `<!doctype html><html lang="en"><head>${head}</head><body>${nav}<main>${sections.map((s) => s.html).join('\n')}</main><footer><div class="wrap">${esc(spec.footer ?? `© ${new Date().getFullYear()} ${brand.name}`)}</div></footer></body></html>`;
  const copy = [`# ${spec.title}`, spec.description ? `\n${spec.description}` : '', ...spec.sections.map((s) => `\n## ${s.type}\n${Object.entries(s).filter(([k]) => k !== 'type' && k !== 'image').map(([k, v]) => `- **${k}:** ${Array.isArray(v) ? `\n${v.map((x) => `  - ${x}`).join('\n')}` : v}`).join('\n')}`)].join('\n');
  return { html, sections, images, copy };
}

export function landingIconNames(spec: LandingSpec): string[] {
  return spec.sections.flatMap((s) => (s.type === 'features' ? list(s.items).map((x) => split(x)[0]) : s.type === 'logos' ? list(s.items) : [])).filter(Boolean);
}
