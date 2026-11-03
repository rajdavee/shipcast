import { basename } from 'node:path';
import { brandCss, faqItems, fontLinks, parseFrontMatter, type BrandKit } from '@shipcast/engine';
import { esc, fit, img, logo, rich, type Layout } from './common.ts';

/**
 * Long-form pieces: the cover image a newsletter or article is shared with,
 * in-article figures cut from real screenshots, and the article itself as a
 * readable web page (desktop and phone) with its search metadata.
 */

export const ARTICLE_CARDS: Layout[] = [
  {
    id: 'article-cover',
    label: 'Article / newsletter cover',
    use: 'Cover for a LinkedIn article or newsletter issue (preset article-cover, 1920×1080) or a blog hero / link preview (og-card, 1200×630): kicker, the headline, an optional line and an optional real screenshot on the right.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker (newsletter name · issue, or the topic)', max: 40, optional: true },
      { id: 'title', type: 'text', label: 'Headline (≤ 12 words)', max: 80, help: '*word* = accent' },
      { id: 'sub', type: 'text', label: 'Supporting line', max: 100, optional: true },
      { id: 'image', type: 'image', label: 'Screenshot (crop with #crop=x,y,w,h)', optional: true },
    ],
    html: (f, ctx) => {
      const s = ctx.width / 1920;
      const shot = !!f.image;
      const padX = Math.round(ctx.width * 0.09);
      const padY = Math.round(ctx.height * 0.12);
      const t = fit(f.title, shot ? [[24, 112], [44, 96], [64, 82], [80, 72]] : [[24, 150], [44, 124], [64, 104], [80, 92]], shot ? 66 : 84);
      return `<div class="c" style="padding:${padY}px ${padX}px;--k:${Math.round(34 * s)}px">
<div style="position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(34 * s)}px;width:${shot ? 50 : 80}%">
<div class="hd" style="justify-content:flex-start;gap:${Math.round(22 * s)}px">${logo(ctx)}${f.kicker ? `<span class="kick">${rich(f.kicker)}</span>` : ''}</div>
<h1 data-fit-lines="4" data-min-font="${Math.round(56 * s)}" style="font-size:${Math.round(t * s)}px">${rich(f.title)}</h1>
${f.sub ? `<p style="font-size:${Math.round(38 * s)}px;line-height:1.35">${rich(f.sub)}</p>` : ''}</div>
${shot ? `<div class="frame" style="position:absolute;left:58%;right:-${Math.round(ctx.width * 0.04)}px;top:${padY}px;bottom:-${Math.round(ctx.height * 0.06)}px;transform:perspective(${Math.round(2200 * s)}px) rotateY(-6deg);transform-origin:0 50%"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>` : ''}</div>
<style>.c .logo{height:${Math.round(56 * s)}px}.c .wordmark{font-size:${Math.round(44 * s)}px}</style>`;
    },
  },
  {
    id: 'article-figure',
    label: 'In-article figure (real screenshot)',
    use: 'A figure for a blog post or article (preset article-figure, 1600×1000): one real screenshot, cropped to what the paragraph talks about, in a clean browser frame on the brand ground. Optional short label chip. Put the caption in the article, not on the image.',
    fields: [
      { id: 'image', type: 'image', label: 'Screenshot (crop with #crop=x,y,w,h)' },
      { id: 'label', type: 'text', label: 'Label chip', max: 40, optional: true },
    ],
    html: (f, ctx) => {
      const pad = Math.round(Math.min(ctx.width, ctx.height) * 0.07);
      const bar = 36;
      return `<div class="c" style="padding:${pad}px;align-items:center;justify-content:center;background:radial-gradient(70% 90% at 80% 10%,color-mix(in srgb,var(--accent) 16%,var(--bg)),var(--bg) 70%)">
<div class="frame" style="position:relative;max-width:100%;max-height:100%"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}" style="width:auto;height:auto;flex:none;max-width:${ctx.width - pad * 2}px;max-height:${ctx.height - pad * 2 - bar}px;object-fit:contain">
${f.label ? `<span class="pill" style="position:absolute;left:24px;top:${bar + 20}px;font-size:26px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)">${esc(f.label)}</span>` : ''}</div></div>`;
    },
  },
];

/** Inline markdown: links, code, bold, italics. */
function inline(s: string): string {
  const codes: string[] = [];
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${/^(https?:|#|\/)/.test(u) ? u : '#'}"${/^https?:/.test(u) ? ' rel="noopener"' : ''}>${t}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const anchor = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Block markdown → HTML. Images become figures; their alt text is the caption. */
export function markdownHtml(md: string, image: (src: string) => string): string {
  const out: string[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(l)) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}${n > 1 ? ` id="${anchor(h[2])}"` : ''}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    const im = l.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (im) {
      out.push(`<figure><img src="${esc(image(im[2]))}" alt="${esc(im[1])}" loading="lazy">${im[1] ? `<figcaption>${inline(im[1])}</figcaption>` : ''}</figure>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      const q: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(q.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
      out.push(`<div class="tbl"><table>${rows.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    const p: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|!\[|\s*([-*+]|\d+[.)])\s+|\|)/.test(lines[i]); i++) p.push(lines[i].trim());
    if (!p.length) p.push(lines[i++].trim());
    out.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return out.join('\n');
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:400 19px/1.7 var(--font-body),Georgia,serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent);text-underline-offset:.15em}img{max-width:100%;height:auto;display:block}
.top{border-bottom:1px solid var(--rule)}.top .in{max-width:1100px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;gap:10px;font:800 19px var(--font-display)}.top img{height:28px;width:auto}
article{max-width:720px;margin:0 auto;padding:56px 24px 40px;overflow-wrap:break-word}
.meta{font:600 14px/1.4 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
h1{font:800 clamp(34px,5.4vw,52px)/1.08 var(--font-display);letter-spacing:-.03em;margin:0 0 18px;text-wrap:balance}
.dek{font-size:21px;line-height:1.5;color:var(--muted);margin:0 0 30px}
.hero{margin:0 0 40px;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px var(--rule)}
h2{font:800 clamp(25px,3.4vw,32px)/1.2 var(--font-display);letter-spacing:-.02em;margin:48px 0 12px;text-wrap:balance}
h3{font:700 22px/1.3 var(--font-display);margin:34px 0 8px}h4,h5,h6{font:700 19px/1.35 var(--font-display);margin:26px 0 6px}
p{margin:0 0 20px}ul,ol{margin:0 0 22px;padding-left:24px}li{margin:0 0 8px}
em{font-style:italic}strong{font-weight:700}
blockquote{margin:28px 0;padding:4px 0 4px 22px;border-left:4px solid var(--accent);font-size:21px;color:var(--fg)}blockquote p{margin:0}
code{font:500 .86em var(--font-mono);background:var(--card);border-radius:5px;padding:.1em .35em}
pre{background:var(--card);border-radius:12px;padding:18px 20px;overflow:auto;font-size:15px;line-height:1.55;margin:0 0 24px}pre code{background:none;padding:0}
figure{margin:32px 0}figure img{border-radius:12px;box-shadow:0 0 0 1px var(--rule)}figcaption{font-size:15px;line-height:1.5;color:var(--muted);margin-top:10px}
.tbl{overflow-x:auto;margin:0 0 24px}table{border-collapse:collapse;width:100%;font-size:16px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--rule);vertical-align:top}th{font-family:var(--font-display)}
.faq{margin-top:56px;border-top:1px solid var(--rule);padding-top:8px}.faq details{border-bottom:1px solid var(--rule);padding:16px 0}.faq summary{cursor:pointer;font:700 19px/1.4 var(--font-display)}.faq details p{margin:10px 0 0;color:var(--muted)}
footer{max-width:720px;margin:0 auto;padding:28px 24px 56px;color:var(--muted);font-size:15px;border-top:1px solid var(--rule)}
@media (max-width:600px){body{font-size:18px}article{padding:36px 20px 28px}.dek{font-size:19px}}
`;

const THEMES: Record<string, string> = {
  light: ':root{--bg:#ffffff;--fg:#16191f;--muted:#5d6472;--accent:var(--accent-on-light);--card:#f4f5f7;--rule:#e6e8ec}',
  dark: ':root{--bg:#0e1015;--fg:#eef0f4;--muted:#a1a9b8;--accent:var(--accent-on-dark);--card:#171a21;--rule:#262b36}',
};

export interface RenderedArticle {
  html: string;
  images: { src: string; name: string }[];
  title: string;
}

/**
 * article.md (front matter + markdown) → one standalone, readable page with
 * its title tag, meta description, canonical slug, Open Graph image and
 * Article + FAQPage structured data. Images are copied next to it (images/…).
 */
export function renderArticle(md: string, brand: BrandKit, resolve: (p: string) => string, opts: { theme?: string; url?: string } = {}): RenderedArticle {
  const { data, body } = parseFrontMatter(md);
  const s = (k: string) => (Array.isArray(data[k]) ? (data[k] as string[]).join(', ') : String(data[k] ?? '')).trim();
  const images: { src: string; name: string }[] = [];
  const image = (p: string) => {
    if (/^https?:\/\//.test(p)) return p;
    const src = resolve(p.replace(/#.*$/, ''));
    const hit = images.find((x) => x.src === src);
    if (hit) return hit.name;
    const name = `images/${images.length + 1}-${basename(src).replace(/[^\w.-]/g, '_')}`;
    images.push({ src, name });
    return name;
  };
  const faq = faqItems(data).filter((f) => f.q && f.a);
  const title = s('title') || (body.match(/^#\s+(.+)$/m)?.[1] ?? 'Article');
  const hero = s('hero') || s('image');
  const heroRef = hero ? image(hero) : '';
  const base = (opts.url ?? brand.url ?? '').replace(/\/$/, '');
  const canonical = s('slug') ? `${base}/${s('slug')}` : '';
  const content = markdownHtml(body, image).replace(/(<h1>[\s\S]*?<\/h1>)/, `$1${s('dek') ? `<p class="dek">${inline(s('dek'))}</p>` : ''}${heroRef ? `<figure class="hero"><img src="${esc(heroRef)}" alt="" loading="eager"></figure>` : ''}`);
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: s('description'), ...(s('date') ? { datePublished: s('date') } : {}), ...(s('author') ? { author: { '@type': 'Person', name: s('author') } } : {}), publisher: { '@type': 'Organization', name: brand.name }, ...(canonical ? { mainEntityOfPage: canonical } : {}), keywords: [s('keyword'), s('keywords')].filter(Boolean).join(', ') },
    ...(faq.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
  ];
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${s('description') ? `<meta name="description" content="${esc(s('description'))}">` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">${s('description') ? `<meta property="og:description" content="${esc(s('description'))}">` : ''}${heroRef ? `<meta property="og:image" content="${esc(heroRef)}"><meta name="twitter:card" content="summary_large_image">` : ''}<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>${fontLinks(brand)}<style>${brandCss(brand)}${THEMES[opts.theme ?? 'light'] ?? THEMES.light}${CSS}</style>`;
  const top = `<header class="top"><div class="in">${brand.logo ? `<img src="${esc(image(brand.logo))}" alt="">` : ''}<span>${esc(brand.name)}</span></div></header>`;
  const meta = [s('date'), s('author'), s('readingTime')].filter(Boolean).join(' · ');
  const faqHtml = faq.length ? `<section class="faq"><h2 id="faq">Frequently asked questions</h2>${faq.map((f) => `<details open><summary>${inline(f.q)}</summary><p>${inline(f.a)}</p></details>`).join('')}</section>` : '';
  const html = `<!doctype html><html lang="en"><head>${head}</head><body>${top}<main><article>${meta ? `<p class="meta">${esc(meta)}</p>` : ''}${content}${faqHtml}</article></main><footer>© ${new Date().getFullYear()} ${esc(brand.name)}</footer></body></html>`;
  return { html, images, title };
}

