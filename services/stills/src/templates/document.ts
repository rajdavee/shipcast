import { esc, img, list, logo, rich, type Layout, type RenderCtx } from './common.ts';
import { brandCss, fontLinks } from '@shipcast/engine';

/**
 * Print documents: one-pagers, sales sheets, case studies, datasheets,
 * ebooks, whitepapers and reports. Pages are real HTML printed by Chrome, so
 * the PDF keeps selectable, searchable text. Layouts own structure; the theme
 * dresses covers, section openers and the back page while inner pages stay
 * light for reading and printing.
 */

export const PAGE_SIZES: Record<string, { width: number; height: number; css: string; label: string }> = {
  a4: { width: 794, height: 1123, css: 'A4', label: 'A4 (210 × 297 mm)' },
  letter: { width: 816, height: 1056, css: 'letter', label: 'US Letter (8.5 × 11 in)' },
};

export const DOC_THEMES: Record<string, { label: string; css: string }> = {
  clean: {
    label: 'Clean — white pages, brand-colour cover and openers',
    css: `:root{--cover-bg:var(--brand-primary);--cover-fg:var(--brand-on-primary);--accent:var(--accent-on-light);--paper:#ffffff;--ink:#14171c;--soft:#5b6270;--tint:color-mix(in srgb,var(--brand-primary) 7%,#fff);--rule:#e3e6ec}`,
  },
  editorial: {
    label: 'Editorial — warm paper, serif-leaning display, quiet colour',
    css: `:root{--cover-bg:#f3efe7;--cover-fg:#1b1a17;--accent:var(--accent-on-light);--paper:#fbf9f5;--ink:#1b1a17;--soft:#6a655c;--tint:#f1ece2;--rule:#e2dccf}
.pg h1,.pg h2,.big,.cover h1{font-family:var(--font-display),Georgia,serif;letter-spacing:-.025em}`,
  },
  dark: {
    label: 'Dark — near-black cover and openers with a brand glow',
    css: `:root{--cover-bg:#0d1016;--cover-fg:#f2f4f8;--accent:var(--accent-on-light);--paper:#ffffff;--ink:#14171c;--soft:#5b6270;--tint:color-mix(in srgb,var(--brand-primary) 7%,#fff);--rule:#e3e6ec}
.cover,.opener,.back{background:radial-gradient(700px 520px at 85% 0%,color-mix(in srgb,var(--brand-primary) 55%,transparent),transparent 70%),radial-gradient(600px 500px at 0% 100%,color-mix(in srgb,var(--brand-secondary) 35%,transparent),transparent 70%),var(--cover-bg)!important}`,
  },
};

/** Light markdown for body copy: paragraphs, "- " bullets, "1. " steps, "### " subheads, "> " callouts. */
export function md(src: unknown): string {
  const blocks = String(src ?? '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks
    .map((b) => {
      const lines = b.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${rich(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${rich(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      // A subhead may sit directly on top of its paragraph or list.
      if (/^#{2,4}\s/.test(lines[0])) return `<h3>${rich(lines[0].replace(/^#+\s*/, ''))}</h3>${lines.length > 1 ? md(lines.slice(1).join('\n')) : ''}`;
      if (lines.every((l) => /^>\s?/.test(l))) return `<blockquote>${rich(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}</blockquote>`;
      return `<p>${rich(lines.join(' '))}</p>`;
    })
    .join('');
}

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Charts drawn as SVG so they print sharp: bar (horizontal), column, line, donut. */
export function chartSvg(chart: { type?: string; data?: { label: string; value: number | string }[]; unit?: string }, w = 620, h = 300): string {
  const data = (chart.data ?? []).slice(0, 12).map((d) => ({ label: String(d.label ?? ''), value: num(d.value) }));
  if (!data.length) return '';
  const unit = esc(chart.unit ?? '');
  const max = Math.max(...data.map((d) => d.value), 1);
  const type = chart.type ?? 'bar';
  const shade = (i: number) => (i === data.findIndex((d) => d.value === max) ? 'var(--brand-primary)' : `color-mix(in srgb,var(--brand-primary) ${Math.max(28, 70 - i * 8)}%,#cfd5df)`);
  if (type === 'donut') {
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    let a0 = -Math.PI / 2;
    const r = 110;
    const cx = 140;
    const cy = h / 2;
    const arcs = data
      .map((d, i) => {
        const a1 = a0 + (d.value / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
        a0 = a1;
        return `<path d="${p}" stroke="${shade(i)}" stroke-width="44" fill="none"/>`;
      })
      .join('');
    const legend = data.map((d, i) => `<g transform="translate(300 ${40 + i * 30})"><rect width="14" height="14" rx="3" fill="${shade(i)}"/><text x="24" y="12" class="cl">${esc(d.label)} — <tspan class="cv">${Math.round((d.value / total) * 100)}%</tspan></text></g>`).join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img">${arcs}${legend}</svg>`;
  }
  if (type === 'line') {
    const pad = 40;
    const xs = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
    const ys = (v: number) => h - pad - (v / max) * (h - pad * 2);
    const pts = data.map((d, i) => `${xs(i)},${ys(d.value)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--rule)"/><polygon points="${xs(0)},${h - pad} ${pts} ${xs(data.length - 1)},${h - pad}" fill="color-mix(in srgb,var(--brand-primary) 12%,transparent)"/><polyline points="${pts}" fill="none" stroke="var(--brand-primary)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>${data.map((d, i) => `<circle cx="${xs(i)}" cy="${ys(d.value)}" r="5" fill="var(--brand-primary)"/><text x="${xs(i)}" y="${h - 12}" text-anchor="middle" class="cl">${esc(d.label)}</text><text x="${xs(i)}" y="${ys(d.value) - 12}" text-anchor="middle" class="cv">${d.value}${unit}</text>`).join('')}</svg>`;
  }
  if (type === 'column') {
    const pad = 36;
    const bw = (w - pad * 2) / data.length;
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img">${data.map((d, i) => { const bh = (d.value / max) * (h - pad * 2 - 10); return `<rect x="${pad + i * bw + bw * 0.18}" y="${h - pad - bh}" width="${bw * 0.64}" height="${bh}" rx="6" fill="${shade(i)}"/><text x="${pad + i * bw + bw / 2}" y="${h - pad - bh - 10}" text-anchor="middle" class="cv">${d.value}${unit}</text><text x="${pad + i * bw + bw / 2}" y="${h - 10}" text-anchor="middle" class="cl">${esc(d.label)}</text>`; }).join('')}</svg>`;
  }
  const rowH = Math.min(46, (h - 10) / data.length);
  const labelW = 190;
  return `<svg class="chart" viewBox="0 0 ${w} ${Math.round(rowH * data.length + 10)}" width="100%" role="img">${data.map((d, i) => { const bw = ((w - labelW - 90) * d.value) / max; return `<text x="0" y="${i * rowH + rowH * 0.62}" class="cl">${esc(d.label)}</text><rect x="${labelW}" y="${i * rowH + rowH * 0.18}" width="${Math.max(4, bw)}" height="${rowH * 0.64}" rx="6" fill="${shade(i)}"/><text x="${labelW + bw + 10}" y="${i * rowH + rowH * 0.62}" class="cv">${d.value}${unit}</text>`; }).join('')}</svg>`;
}

const icon = (name: unknown, ctx: RenderCtx) => {
  const uri = ctx.icons?.[String(name ?? '')];
  return uri ? `<img class="ic" src="${uri}" alt="">` : `<span class="ic mono">${esc(String(name ?? '•').slice(0, 1).toUpperCase())}</span>`;
};

export const DOC_LAYOUTS: Layout[] = [
  {
    id: 'cover',
    label: 'Cover',
    use: 'First page. Kicker (document type), a promise-shaped title, one-line subtitle, optional hero image, author/date line.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker (e.g. "Case study", "Guide")', max: 40, optional: true },
      { id: 'title', type: 'text', label: 'Title', max: 80, help: '*word* = accent' },
      { id: 'subtitle', type: 'text', label: 'Subtitle', max: 160, optional: true },
      { id: 'image', type: 'image', label: 'Hero image or product shot', optional: true },
      { id: 'meta', type: 'text', label: 'Author · date line', max: 80, optional: true },
    ],
    html: (f, ctx) => `<section class="pg cover">${logo(ctx, 'logo cover-logo')}<div class="cover-body"><div class="kicker">${esc(f.kicker ?? '')}</div><h1 class="title">${rich(f.title)}</h1>${f.subtitle ? `<p class="lede">${rich(f.subtitle)}</p>` : ''}</div>${f.image ? `<div class="cover-shot"><img src="${img(f.image, ctx)}" alt=""></div>` : ''}${f.meta ? `<div class="cover-meta">${esc(f.meta)}</div>` : ''}</section>`,
  },
  {
    id: 'toc',
    label: 'Contents',
    use: 'Contents page for ebooks, whitepapers and reports (5+ pages). Entries are filled from section and article titles automatically; give an optional intro.',
    fields: [{ id: 'intro', type: 'longtext', label: 'Intro (optional)', max: 400, optional: true }],
    html: () => '',
  },
  {
    id: 'section',
    label: 'Section opener',
    use: 'Starts a chapter in long documents: number, title, 1–3 sentence intro. Full theme colour.',
    fields: [
      { id: 'number', type: 'text', label: 'Number ("01")', max: 4, optional: true },
      { id: 'title', type: 'text', label: 'Title', max: 60 },
      { id: 'intro', type: 'longtext', label: 'Intro', max: 320, optional: true },
    ],
    html: (f) => `<section class="pg opener"><div class="num">${esc(f.number ?? '')}</div><h1 class="title">${rich(f.title)}</h1>${f.intro ? `<p class="lede">${rich(f.intro)}</p>` : ''}</section>`,
  },
  {
    id: 'article',
    label: 'Article page',
    use: 'The workhorse reading page: heading, body copy (markdown: blank-line paragraphs, "- " bullets, "### " subheads, "> " callouts), optional side note (a pull quote or one stat) and optional image. ~280 words max per page with an image, ~420 without; split longer text across pages. Fill the page: a page that is half empty looks unfinished.',
    fields: [
      { id: 'heading', type: 'text', label: 'Heading', max: 80 },
      { id: 'body', type: 'longtext', label: 'Body (light markdown)', max: 3200 },
      { id: 'aside', type: 'longtext', label: 'Side note / pull quote', max: 220, optional: true },
      { id: 'image', type: 'image', label: 'Image', optional: true },
      { id: 'columns', type: 'enum', label: 'Columns', choices: ['1', '2'], optional: true },
    ],
    html: (f, ctx) => `<section class="pg article">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2><div class="cols ${f.columns === '2' ? 'two' : ''} ${f.aside ? 'with-aside' : ''}"><div class="copy">${md(f.body)}</div>${f.aside ? `<aside class="aside">${rich(f.aside)}</aside>` : ''}</div>${f.image ? `<figure class="shot"><img src="${img(f.image, ctx)}" alt=""></figure>` : ''}</div></section>`,
  },
  {
    id: 'stats',
    label: 'Key numbers',
    use: '2–4 big numbers with labels and sources, plus a short paragraph. Only verified numbers.',
    fields: [
      { id: 'heading', type: 'text', label: 'Heading', max: 80 },
      { id: 'stats', type: 'list', label: 'Stats: "value | label | source"', max: 4 },
      { id: 'body', type: 'longtext', label: 'Body', max: 900, optional: true },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2><div class="stat-grid n${Math.min(4, list(f.stats).length)}">${list(f.stats).map((s) => { const [v, l, src] = s.split('|').map((x) => x.trim()); return `<div class="stat"><div class="big">${esc(v)}</div><div class="lbl">${rich(l ?? '')}</div>${src ? `<div class="src">${esc(src)}</div>` : ''}</div>`; }).join('')}</div>${f.body ? `<div class="copy">${md(f.body)}</div>` : ''}</div></section>`,
  },
  {
    id: 'chart',
    label: 'Chart page',
    use: 'One chart that proves one point: bar (ranked), column (over time / categories), line (trend), donut (share). Title states the takeaway; cite the source.',
    fields: [
      { id: 'heading', type: 'text', label: 'Takeaway headline', max: 90 },
      { id: 'chart', type: 'text', label: 'Chart JSON: {"type":"bar|column|line|donut","unit":"%","data":[{"label","value"}]}' },
      { id: 'body', type: 'longtext', label: 'What it means', max: 900, optional: true },
      { id: 'source', type: 'text', label: 'Source', max: 140, optional: true },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2><div class="chart-box">${chartSvg(typeof f.chart === 'string' ? safeJson(f.chart) : f.chart ?? {})}</div>${f.source ? `<div class="src">Source: ${esc(f.source)}</div>` : ''}${f.body ? `<div class="copy">${md(f.body)}</div>` : ''}</div></section>`,
  },
  {
    id: 'table',
    label: 'Table',
    use: 'Specs, pricing tiers, feature matrices. ≤ 6 columns, ≤ 14 rows. Use ✓ and — for yes/no.',
    fields: [
      { id: 'heading', type: 'text', label: 'Heading', max: 80 },
      { id: 'columns', type: 'list', label: 'Column headers', max: 6 },
      { id: 'rows', type: 'list', label: 'Rows: cells separated by " | "', max: 14 },
      { id: 'note', type: 'text', label: 'Footnote', max: 200, optional: true },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2><table><thead><tr>${list(f.columns).map((c) => `<th>${rich(c)}</th>`).join('')}</tr></thead><tbody>${list(f.rows).map((r) => `<tr>${r.split('|').map((c) => `<td>${rich(c.trim())}</td>`).join('')}</tr>`).join('')}</tbody></table>${f.note ? `<div class="src">${rich(f.note)}</div>` : ''}</div></section>`,
  },
  {
    id: 'quote',
    label: 'Quote',
    use: 'A real customer or expert quote with name and role (never invented), optional portrait or logo.',
    fields: [
      { id: 'quote', type: 'longtext', label: 'Quote', max: 360 },
      { id: 'name', type: 'text', label: 'Name', max: 60 },
      { id: 'role', type: 'text', label: 'Role, company', max: 80, optional: true },
      { id: 'image', type: 'image', label: 'Portrait or logo', optional: true },
    ],
    html: (f, ctx) => `<section class="pg quote-pg">${chrome(ctx)}<div class="pg-body center"><div class="qmark">“</div><blockquote class="big-quote">${rich(f.quote)}</blockquote><div class="who">${f.image ? `<img src="${img(f.image, ctx)}" alt="">` : ''}<div><b>${esc(f.name)}</b><span>${esc(f.role ?? '')}</span></div></div></div></section>`,
  },
  {
    id: 'features',
    label: 'Features grid',
    use: '3–6 capabilities with an icon name (lucide or a brand/tool name), title and one or two sentences each, optional intro and product image.',
    fields: [
      { id: 'heading', type: 'text', label: 'Heading', max: 80 },
      { id: 'intro', type: 'longtext', label: 'Intro', max: 300, optional: true },
      { id: 'items', type: 'list', label: 'Items: "icon | title | body"', max: 6 },
      { id: 'image', type: 'image', label: 'Product image', optional: true },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2>${f.intro ? `<p class="lede ink">${rich(f.intro)}</p>` : ''}${f.image ? `<figure class="shot sm"><img src="${img(f.image, ctx)}" alt=""></figure>` : ''}<div class="feat-grid">${list(f.items).map((s) => { const [ic, t, b] = s.split('|').map((x) => x.trim()); return `<div class="feat">${icon(ic, ctx)}<h4>${rich(t ?? '')}</h4><p>${rich(b ?? '')}</p></div>`; }).join('')}</div></div></section>`,
  },
  {
    id: 'steps',
    label: 'Steps / timeline',
    use: 'How it works, onboarding, a roadmap or a timeline: 3–6 steps with a title and one or two sentences.',
    fields: [
      { id: 'heading', type: 'text', label: 'Heading', max: 80 },
      { id: 'steps', type: 'list', label: 'Steps: "title | body" (or "date — title | body")', max: 6 },
      { id: 'body', type: 'longtext', label: 'Closing paragraph', max: 500, optional: true },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2><ol class="steps">${list(f.steps).map((s, i) => { const [t, b] = s.split('|').map((x) => x.trim()); return `<li><span class="dot">${i + 1}</span><div><h4>${rich(t)}</h4><p>${rich(b ?? '')}</p></div></li>`; }).join('')}</ol>${f.body ? `<div class="copy">${md(f.body)}</div>` : ''}</div></section>`,
  },
  {
    id: 'comparison',
    label: 'Comparison',
    use: 'Before/after or "the old way vs with us": two columns of 3–6 points. Honest, no competitor names unless the brief allows.',
    fields: [
      { id: 'heading', type: 'text', label: 'Heading', max: 80 },
      { id: 'leftTitle', type: 'text', label: 'Left title', max: 30 },
      { id: 'left', type: 'list', label: 'Left points', max: 6 },
      { id: 'rightTitle', type: 'text', label: 'Right title', max: 30 },
      { id: 'right', type: 'list', label: 'Right points', max: 6 },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><h2>${rich(f.heading)}</h2><div class="compare"><div class="col old"><h4>${rich(f.leftTitle)}</h4><ul>${list(f.left).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div><div class="col new"><h4>${rich(f.rightTitle)}</h4><ul>${list(f.right).map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div></div></div></section>`,
  },
  {
    id: 'case-study',
    label: 'Case study (one page)',
    use: 'Challenge → solution → results on one page for a real, named customer from the brief. Results are verified numbers only.',
    fields: [
      { id: 'client', type: 'text', label: 'Client', max: 60 },
      { id: 'heading', type: 'text', label: 'Headline (the result)', max: 90 },
      { id: 'challenge', type: 'longtext', label: 'Challenge', max: 600 },
      { id: 'solution', type: 'longtext', label: 'Solution', max: 700 },
      { id: 'results', type: 'list', label: 'Results: "value | label"', max: 3 },
      { id: 'quote', type: 'longtext', label: 'Quote "text — name, role"', max: 300, optional: true },
      { id: 'image', type: 'image', label: 'Image', optional: true },
    ],
    html: (f, ctx) => { const [qt, qb] = String(f.quote ?? '').split(/\s+—\s+/); return `<section class="pg">${chrome(ctx)}<div class="pg-body"><div class="kicker ink">${esc(f.client)}</div><h2>${rich(f.heading)}</h2><div class="stat-grid n${Math.min(3, list(f.results).length)} tight">${list(f.results).map((s) => { const [v, l] = s.split('|').map((x) => x.trim()); return `<div class="stat"><div class="big">${esc(v)}</div><div class="lbl">${rich(l ?? '')}</div></div>`; }).join('')}</div><div class="cols two"><div><h3>The challenge</h3>${md(f.challenge)}</div><div><h3>What changed</h3>${md(f.solution)}</div></div>${f.image ? `<figure class="shot sm"><img src="${img(f.image, ctx)}" alt=""></figure>` : ''}${qt ? `<blockquote class="cs-quote">${rich(qt)}${qb ? `<cite>${esc(qb)}</cite>` : ''}</blockquote>` : ''}</div></section>`; },
  },
  {
    id: 'one-pager',
    label: 'One-pager / sales sheet',
    use: 'The whole pitch on one page: headline, subhead, product image, 3–4 benefits ("icon | title | body"), up to 3 proof numbers, CTA and contact. Use alone as a one-page document.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', max: 40, optional: true },
      { id: 'title', type: 'text', label: 'Headline', max: 70 },
      { id: 'subtitle', type: 'text', label: 'Subhead', max: 180 },
      { id: 'image', type: 'image', label: 'Product image', optional: true },
      { id: 'items', type: 'list', label: 'Benefits: "icon | title | body"', max: 4 },
      { id: 'stats', type: 'list', label: 'Proof: "value | label"', max: 3, optional: true },
      { id: 'cta', type: 'text', label: 'Call to action', max: 40 },
      { id: 'contact', type: 'text', label: 'URL · email · phone', max: 120 },
    ],
    html: (f, ctx) => `<section class="pg one-pager"><header class="op-head">${logo(ctx, 'logo cover-logo')}<div class="kicker">${esc(f.kicker ?? '')}</div><h1 class="title">${rich(f.title)}</h1><p class="lede">${rich(f.subtitle)}</p></header><div class="op-body">${f.image ? `<figure class="shot"><img src="${img(f.image, ctx)}" alt=""></figure>` : ''}<div class="feat-grid two">${list(f.items).map((s) => { const [ic, t, b] = s.split('|').map((x) => x.trim()); return `<div class="feat">${icon(ic, ctx)}<h4>${rich(t ?? '')}</h4><p>${rich(b ?? '')}</p></div>`; }).join('')}</div>${list(f.stats).length ? `<div class="stat-grid n${Math.min(3, list(f.stats).length)} tight">${list(f.stats).map((s) => { const [v, l] = s.split('|').map((x) => x.trim()); return `<div class="stat"><div class="big">${esc(v)}</div><div class="lbl">${rich(l ?? '')}</div></div>`; }).join('')}</div>` : ''}</div><footer class="op-foot"><span class="btn">${esc(f.cta)} →</span><span>${esc(f.contact)}</span></footer></section>`,
  },
  {
    id: 'image',
    label: 'Full image',
    use: 'A full-page product screenshot, photo or diagram with a caption. Use sparingly.',
    fields: [
      { id: 'image', type: 'image', label: 'Image' },
      { id: 'caption', type: 'text', label: 'Caption', max: 200, optional: true },
    ],
    html: (f, ctx) => `<section class="pg">${chrome(ctx)}<div class="pg-body"><figure class="shot full"><img src="${img(f.image, ctx)}" alt=""></figure>${f.caption ? `<figcaption>${rich(f.caption)}</figcaption>` : ''}</div></section>`,
  },
  {
    id: 'cta',
    label: 'Back page / CTA',
    use: 'Last page: one clear next step, a short reason, the URL and contact details.',
    fields: [
      { id: 'title', type: 'text', label: 'Headline', max: 70 },
      { id: 'body', type: 'longtext', label: 'Why now', max: 300, optional: true },
      { id: 'cta', type: 'text', label: 'Button text', max: 40 },
      { id: 'url', type: 'text', label: 'URL', max: 80 },
      { id: 'contact', type: 'text', label: 'Contact line', max: 120, optional: true },
    ],
    html: (f, ctx) => `<section class="pg back">${logo(ctx, 'logo cover-logo')}<div class="cover-body"><h1 class="title">${rich(f.title)}</h1>${f.body ? `<p class="lede">${rich(f.body)}</p>` : ''}<div class="btn big-btn">${esc(f.cta)} →</div><div class="url">${esc(f.url)}</div>${f.contact ? `<div class="cover-meta">${esc(f.contact)}</div>` : ''}</div></section>`,
  },
];

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Running head and folio, filled per page by the document renderer. */
const chrome = (ctx: RenderCtx) => `<div class="run">${esc((ctx as DocCtx).docTitle ?? '')}<span class="run-logo">${logo(ctx, 'logo run-mark')}</span></div><div class="folio">${ctx.page ?? ''}${(ctx as DocCtx).footer ? `<span>${esc((ctx as DocCtx).footer)}</span>` : ''}</div>`;

export interface DocCtx extends RenderCtx {
  docTitle?: string;
  footer?: string;
}

export interface DocPage {
  layout: string;
  fields: Record<string, any>;
}

export function docIconNames(pages: DocPage[]): string[] {
  const out: string[] = [];
  for (const p of pages) for (const it of list(p.fields?.items)) out.push(it.split('|')[0].trim());
  return out.filter(Boolean);
}

const DOC_CSS = (w: number, h: number) => `
@page{size:${w}px ${h}px;margin:0}
html,body{width:${w}px;height:auto!important;overflow:visible!important;background:#888}
.pg{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:var(--paper);color:var(--ink);page-break-after:always;break-after:page;padding:96px 64px 80px;font:400 15.5px/1.62 var(--font-body)}
.pg:last-child{page-break-after:auto;break-after:auto}
.pg-body{height:100%;display:flex;flex-direction:column;gap:24px;overflow:hidden}
.pg-body.center{justify-content:center}
.run{position:absolute;top:34px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center;font:600 11px/1 var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--soft);border-bottom:1px solid var(--rule);padding-bottom:12px}
.run-mark{height:16px;width:auto;max-width:110px;object-fit:contain}
.run .wordmark{font:700 12px/1 var(--font-display);letter-spacing:0;text-transform:none;color:var(--ink)}
.folio{position:absolute;bottom:30px;left:64px;right:64px;display:flex;justify-content:space-between;font:600 11px/1 var(--font-body);color:var(--soft)}
h2{font:800 36px/1.1 var(--font-display);letter-spacing:-.03em;text-wrap:balance;max-width:640px}
h3{font:700 18px/1.3 var(--font-display);margin:16px 0 6px}
h4{font:700 17px/1.3 var(--font-display)}
em{font-style:normal;color:var(--accent)}
mark{background:color-mix(in srgb,var(--brand-primary) 22%,transparent);color:inherit;padding:0 .1em}
.copy p,.cols p{margin:0 0 10px;text-wrap:pretty}
.copy ul,.copy ol,.cols ul{margin:0 0 10px 18px}
.copy li{margin:3px 0}
blockquote{border-left:3px solid var(--brand-primary);padding:6px 0 6px 16px;margin:8px 0;font:600 16px/1.45 var(--font-display);color:var(--ink)}
.cols{display:grid;gap:28px}.cols.two{grid-template-columns:1fr 1fr}.cols.with-aside{grid-template-columns:1fr 220px}.cols.two.with-aside{grid-template-columns:1fr 1fr}
.aside{background:var(--tint);border-radius:16px;padding:22px;font:600 18px/1.45 var(--font-display);align-self:start}
.shot{border-radius:14px;overflow:hidden;box-shadow:0 18px 40px -22px rgba(0,0,0,.45),0 0 0 1px var(--rule);flex:0 1 auto;min-height:0}
.shot img{width:100%;height:100%;max-height:430px;object-fit:cover;object-position:top}
.shot.sm img{max-height:260px}.shot.full{flex:1}.shot.full img{max-height:none;height:100%}
figcaption,.src{font-size:11.5px;color:var(--soft)}
.kicker{font:700 12px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;opacity:.85}
.kicker.ink{color:var(--accent);opacity:1}
.lede{font:500 19px/1.45 var(--font-body);opacity:.9;text-wrap:pretty}
.lede.ink{font-size:16px;color:var(--soft)}
.stat-grid{display:grid;gap:16px}.stat-grid.n1{grid-template-columns:1fr}.stat-grid.n2{grid-template-columns:repeat(2,1fr)}.stat-grid.n3{grid-template-columns:repeat(3,1fr)}.stat-grid.n4{grid-template-columns:repeat(4,1fr)}
.stat{background:var(--tint);border-radius:18px;padding:26px 22px}
.stat .big{font:800 64px/1 var(--font-display);letter-spacing:-.045em;color:var(--brand-primary)}
.stat-grid.tight .stat .big{font-size:40px}
.stat .lbl{margin-top:10px;font:600 15px/1.35 var(--font-body)}
.stat .src{margin-top:6px}
.chart-box{background:var(--tint);border-radius:18px;padding:28px}
.chart .cl{font:500 14px var(--font-body);fill:var(--ink)}.chart .cv{font:700 15px var(--font-body);fill:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font:700 12px/1.3 var(--font-body);text-transform:uppercase;letter-spacing:.05em;color:var(--soft);border-bottom:2px solid var(--ink);padding:10px 8px}
td{border-bottom:1px solid var(--rule);padding:10px 8px;vertical-align:top}
tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--tint) 60%,transparent)}
.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.feat-grid.two{grid-template-columns:repeat(2,1fr)}
.feat{border:1px solid var(--rule);border-radius:18px;padding:22px;display:grid;gap:8px;align-content:start}
.feat p{font-size:14px;line-height:1.5;color:var(--soft)}
.ic{width:40px;height:40px;border-radius:9px;object-fit:contain;background:var(--tint);padding:6px}
.ic.mono{display:grid;place-items:center;font:800 15px var(--font-display);color:var(--brand-primary)}
.steps{list-style:none;display:grid;gap:26px;position:relative;margin-top:8px}
.steps li{display:grid;grid-template-columns:56px 1fr;gap:18px;align-items:start;padding-bottom:22px;border-bottom:1px solid var(--rule)}
.steps li:last-child{border-bottom:0}
.steps .dot{width:50px;height:50px;font-size:18px!important;border-radius:50%;display:grid;place-items:center;background:var(--brand-primary);color:var(--brand-on-primary);font:800 15px var(--font-display)}
.steps h4{font-size:20px}.steps p{font-size:15.5px;color:var(--soft);margin-top:4px}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.compare .col{border-radius:20px;padding:30px;font-size:17px;line-height:1.45}
.compare h4{font-size:22px}.compare .old{background:#f1f2f4;color:#4b515c}.compare .new{background:var(--brand-primary);color:var(--brand-on-primary)}
.compare ul{margin:16px 0 0 20px;display:grid;gap:14px}
.qmark{font:800 120px/0.6 var(--font-display);color:var(--brand-primary)}
.big-quote{border:0;padding:0;font:600 28px/1.35 var(--font-display);letter-spacing:-.015em;text-wrap:balance}
.who{display:flex;gap:14px;align-items:center;margin-top:18px}.who img{width:56px;height:56px;border-radius:50%;object-fit:cover}.who b{display:block}.who span{color:var(--soft);font-size:13px}
.cs-quote cite{display:block;margin-top:6px;font:500 12.5px var(--font-body);color:var(--soft)}
.cover,.opener,.back{background:var(--cover-bg);color:var(--cover-fg);padding:72px 64px;display:flex;flex-direction:column}
.cover-logo{height:40px;width:auto;max-width:200px;object-fit:contain;align-self:flex-start}
.cover .wordmark,.back .wordmark,.one-pager .wordmark{font:800 22px/1 var(--font-display)}
.cover-body{margin-top:auto;display:grid;gap:18px}
.cover .title,.back .title{font:800 54px/1.02 var(--font-display);letter-spacing:-.035em;text-wrap:balance}
.cover em,.opener em,.back em,.op-head em{color:inherit;text-decoration:underline;text-decoration-thickness:.08em;text-underline-offset:.1em}
.cover-shot{margin-top:34px;border-radius:16px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(0,0,0,.6);max-height:380px}
.cover-shot img{width:100%;object-fit:cover;object-position:top}
.cover-meta{margin-top:26px;font:600 13px/1.4 var(--font-body);opacity:.8}
.opener{justify-content:flex-end}.opener .num{font:800 140px/1 var(--font-display);opacity:.25;letter-spacing:-.05em}.opener .title{font:800 48px/1.05 var(--font-display);letter-spacing:-.03em}.opener .lede{margin-top:16px;max-width:560px}
.back{justify-content:center}.back .cover-body{margin:auto 0}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--brand-primary);color:var(--brand-on-primary);font:700 15px/1 var(--font-body);padding:14px 20px;border-radius:999px;width:max-content}
.back .btn,.cover .btn{background:var(--cover-fg);color:var(--cover-bg)}
.big-btn{font-size:18px;padding:18px 26px}
.url{font:700 18px/1 var(--font-body);opacity:.9}
.toc ol{list-style:none;display:grid;gap:4px;margin-top:10px}
.toc li{display:flex;align-items:baseline;gap:10px;padding:10px 0;border-bottom:1px solid var(--rule);font:600 15px/1.3 var(--font-display)}
.toc li.sec{font-size:18px;padding-top:18px}
.toc .lead{flex:1;border-bottom:1px dotted var(--rule);transform:translateY(-4px)}
.toc .pn{color:var(--soft);font-variant-numeric:tabular-nums}
.one-pager{padding:0;display:flex;flex-direction:column}
.op-head{background:var(--cover-bg);color:var(--cover-fg);padding:44px 56px 40px;display:grid;gap:12px}
.op-head .title{font:800 40px/1.05 var(--font-display);letter-spacing:-.03em;text-wrap:balance}
.op-head .lede{font-size:16px}
.op-body{flex:1;padding:28px 56px 0;display:flex;flex-direction:column;gap:18px;overflow:hidden}
.op-body .shot img{max-height:250px}
.op-foot{display:flex;justify-content:space-between;align-items:center;padding:20px 56px 28px;border-top:1px solid var(--rule);font:600 13px var(--font-body);color:var(--soft)}
`;

/** Render a whole document into one HTML file: each page is a fixed-size <section>. */
export function renderDocument(spec: { title?: string; theme?: string; footer?: string; pages: DocPage[] }, ctx: RenderCtx): string {
  const theme = DOC_THEMES[spec.theme ?? 'clean'] ?? DOC_THEMES.clean;
  const pages = spec.pages.length;
  // Contents need final page numbers: number every page first, then fill the contents from headings.
  const entries: { title: string; page: number; sec: boolean }[] = [];
  spec.pages.forEach((p, i) => {
    const t = p.layout === 'section' ? p.fields.title : p.layout === 'article' || p.layout === 'stats' || p.layout === 'chart' || p.layout === 'features' || p.layout === 'steps' || p.layout === 'table' || p.layout === 'case-study' || p.layout === 'comparison' ? p.fields.heading : null;
    if (t) entries.push({ title: String(t).replace(/[*=]/g, ''), page: i + 1, sec: p.layout === 'section' });
  });
  const body = spec.pages
    .map((p, i) => {
      const dctx: DocCtx = { ...ctx, page: i + 1, pages, docTitle: spec.title, footer: spec.footer };
      if (p.layout === 'toc') return `<section class="pg toc">${chrome(dctx)}<div class="pg-body"><h2>Contents</h2>${p.fields?.intro ? `<p class="lede ink">${rich(p.fields.intro)}</p>` : ''}<ol>${entries.filter((e) => e.page > i + 1).map((e) => `<li class="${e.sec ? 'sec' : ''}">${esc(e.title)}<span class="lead"></span><span class="pn">${e.page}</span></li>`).join('')}</ol></div></section>`;
      const l = DOC_LAYOUTS.find((x) => x.id === p.layout);
      if (!l) throw new Error(`unknown document layout "${p.layout}" (have: ${DOC_LAYOUTS.map((x) => x.id).join(', ')})`);
      return l.html(p.fields ?? {}, dctx);
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">${fontLinks(ctx.brand)}<style>${brandCss(ctx.brand)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal}
img{display:block;max-width:100%}
${theme.css}
${DOC_CSS(ctx.width, ctx.height)}
</style></head><body>${body}</body></html>`;
}

/** Per-page overflow check, run in the page: content that doesn't fit its page. */
export const DOC_AUDIT_SCRIPT = `(() => {
  const out = [];
  document.querySelectorAll('section.pg').forEach((pg, i) => {
    const box = pg.querySelector('.pg-body, .op-body, .cover-body') || pg;
    const over = Math.max(0, box.scrollHeight - box.clientHeight);
    const wide = [...pg.querySelectorAll('h1,h2,table,.feat-grid,.stat-grid')].some((el) => el.scrollWidth > el.clientWidth + 2);
    const broken = [...pg.querySelectorAll('img')].filter((im) => !im.complete || !im.naturalWidth).length;
    // How much of the page the content actually uses: half-empty inner pages look unfinished.
    let fill = 1;
    if (box.classList.contains('pg-body') && !pg.classList.contains('toc') && !pg.classList.contains('quote-pg')) {
      const top = box.getBoundingClientRect().top;
      const bottom = Math.max(top, ...[...box.children].map((c) => c.getBoundingClientRect().bottom));
      fill = (bottom - top) / Math.max(1, box.clientHeight);
    }
    out.push({ page: i + 1, overflow: over, wide, brokenImages: broken, fill: Math.round(fill * 100) / 100 });
  });
  return out;
})()`;
