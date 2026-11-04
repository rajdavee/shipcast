import { channel, type ChannelId } from './calendar.ts';
import type { Kpi } from './report-facts.ts';
import { num, pct, times, type Report } from './report.ts';

/**
 * One renderer for every place a report goes outside the app: the share
 * page, the PDF, the email body and the "week in one card" image. Plain
 * HTML with inline CSS and SVG — no scripts, nothing fetched from outside.
 */

export const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const chName = (ch: ChannelId) => channel(ch)?.name ?? ch;
const clean = (t: string) => t.replace(/^Sample · /, '');

const C = { ink: '#111827', muted: '#5b6474', faint: '#e7eaf0', panel: '#f6f7fa', accent: '#2f6bff', up: '#0f8a4c', down: '#c62828', bg: '#ffffff' };
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif`;

export function kpiValue(k: Pick<Kpi, 'value' | 'unit'>): string {
  return k.unit === 'percent' ? `${k.value}%` : num(k.value);
}
export function kpiChange(k: Pick<Kpi, 'change'>): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (k.change === undefined) return null;
  if (Math.abs(k.change) < 0.005) return { text: '0%', dir: 'flat' };
  return { text: `${k.change > 0 ? '+' : '−'}${pct(k.change)}`, dir: k.change > 0 ? 'up' : 'down' };
}

/** A sparkline as an SVG path string (oldest left). */
export function sparkPath(values: number[], w = 120, h = 32, pad = 2): string {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${i ? 'L' : 'M'}${(pad + (i * (w - 2 * pad)) / (values.length - 1)).toFixed(1)} ${(h - pad - ((v - min) / span) * (h - 2 * pad)).toFixed(1)}`).join(' ');
}

const spark = (values: number[], color: string, w = 120, h = 32) => {
  const d = sparkPath(values, w, h);
  return d ? `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : '';
};

function kpiTiles(r: Report, max = 6): string {
  return r.facts.kpis
    .filter((k) => k.key !== 'rate' || r.facts.totals.audience > 0)
    .slice(0, max)
    .map((k) => {
      const ch = kpiChange(k);
      const col = ch?.dir === 'up' ? C.up : ch?.dir === 'down' ? C.down : C.muted;
      return `<div class="kpi"><div class="kl">${escHtml(k.label)}</div><div class="kv">${escHtml(kpiValue(k))}</div><div class="kc" style="color:${col}">${ch ? escHtml(ch.text) : '&nbsp;'}${k.prev !== undefined ? ` <span class="was">was ${escHtml(kpiValue({ value: k.prev, unit: k.unit }))}</span>` : ''}</div>${spark(k.series, C.accent)}</div>`;
    })
    .join('');
}

function waterfall(r: Report): string {
  const w = r.facts.waterfall;
  if (!w.length || r.facts.prev.posts === 0) return '';
  const max = Math.max(...w.map((x) => Math.abs(x.delta)), 1);
  const rows = w
    .map((x) => {
      const pctW = Math.max(2, Math.round((Math.abs(x.delta) / max) * 50));
      const bar = x.delta >= 0 ? `<span class="bar" style="left:50%;width:${pctW}%;background:${C.up}"></span>` : `<span class="bar" style="left:${50 - pctW}%;width:${pctW}%;background:${C.down}"></span>`;
      return `<div class="wrow"><div class="wn">${escHtml(x.name)}</div><div class="wt">${bar}<span class="axis"></span></div><div class="wv" style="color:${x.delta >= 0 ? C.up : C.down}">${x.delta >= 0 ? '+' : '−'}${escHtml(num(Math.abs(x.delta)))}</div></div>`;
    })
    .join('');
  return `<div class="card"><h3>Change in reach by channel</h3>${rows}</div>`;
}

function topPosts(r: Report, media?: (path: string, i: number) => string | undefined): string {
  if (!r.facts.top.length) return '';
  const items = r.facts.top
    .map((p, i) => {
      const img = p.media && /\.(png|jpe?g|webp|gif)$/i.test(p.media) ? media?.(p.media, i) : undefined;
      const stats = [p.lift !== undefined ? `<b>${escHtml(times(p.lift))}</b> your usual` : '', p.audience !== undefined ? `${escHtml(num(p.audience))} reached` : '', p.visits ? `${escHtml(num(p.visits))} site visits` : '', p.keyEvents ? `${escHtml(num(p.keyEvents))} key events` : ''].filter(Boolean).join(' · ');
      const why = p.why.length ? `<div class="chips">${p.why.map((w) => `<span class="chip">${escHtml(w.replace(/^[^·]+· /, '').replace(/:.*$/, ''))}</span>`).join('')}</div>` : '';
      return `<div class="post">${img ? `<img src="${escHtml(img)}" alt="">` : `<div class="ph">${escHtml(chName(p.channel).slice(0, 2))}</div>`}<div><div class="pt">${escHtml(clean(p.title))}</div><div class="pm">${escHtml(chName(p.channel))}${stats ? ` · ${stats}` : ''}</div>${why}</div></div>`;
    })
    .join('');
  return `<div class="card"><h3>Best posts</h3>${items}</div>`;
}

function goals(r: Report): string {
  if (!r.facts.goals.length) return '';
  const rows = r.facts.goals
    .map((g) => {
      const done = Math.min(100, Math.round((g.actual / g.target) * 100));
      const pace = g.projected !== undefined ? Math.min(100, Math.round((g.projected / g.target) * 100)) : undefined;
      const col = g.done || g.onTrack ? C.up : g.onTrack === false ? C.down : C.accent;
      return `<div class="goal"><div class="gl"><span>${escHtml(g.label)} <span class="was">· ${escHtml(g.window.label)}</span></span><span>${escHtml(num(g.actual))} / ${escHtml(num(g.target))}</span></div><div class="gt"><span style="width:${done}%;background:${col}"></span>${pace !== undefined ? `<i style="left:${pace}%" title="forecast"></i>` : ''}</div>${g.projected !== undefined && !g.done ? `<div class="was">Forecast: about ${escHtml(num(g.projected))} by the end${g.needPerWeek ? ` · needs ${escHtml(num(g.needPerWeek))} a week` : ''}</div>` : ''}</div>`;
    })
    .join('');
  return `<div class="card"><h3>Goals</h3>${rows}</div>`;
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;background:${C.bg};color:${C.ink};font:15px/1.55 ${FONT};-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:40px 28px 56px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:600}
h1{font-size:30px;line-height:1.2;margin:8px 0 6px;letter-spacing:-.01em}
h2{font-size:17px;margin:28px 0 8px;break-after:avoid}h3{font-size:13px;margin:0 0 12px;color:${C.muted};text-transform:uppercase;letter-spacing:.06em}
.meta{color:${C.muted};font-size:13px}.intro{margin:18px 0 0;white-space:pre-wrap}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0}
.kpi{background:${C.panel};border-radius:14px;padding:14px 16px}.kl{font-size:12px;color:${C.muted}}.kv{font-size:26px;font-weight:700;letter-spacing:-.02em}.kc{font-size:13px;font-weight:600;min-height:20px}.was{color:${C.muted};font-weight:400;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px solid ${C.faint};border-radius:14px;padding:16px 18px;break-inside:avoid;margin-bottom:12px}
.wrow{display:grid;grid-template-columns:76px 1fr 64px;align-items:center;gap:8px;margin:6px 0;font-size:13px}.wt{position:relative;height:12px}.bar{position:absolute;top:0;height:12px;border-radius:6px}.axis{position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:${C.faint}}.wv{text-align:right;font-weight:600}
.post{display:grid;grid-template-columns:56px 1fr;gap:12px;align-items:start;margin:10px 0}.post img,.ph{width:56px;height:56px;border-radius:10px;object-fit:cover;background:${C.panel}}.ph{display:grid;place-items:center;color:${C.muted};font-weight:700}.pt{font-weight:600}.pm{font-size:13px;color:${C.muted}}
.chips{margin-top:6px}.chip{display:inline-block;font-size:11px;background:#eef3ff;color:${C.accent};border-radius:99px;padding:2px 8px;margin:0 4px 4px 0}
.sec{break-inside:avoid}.sec ul{margin:0;padding-left:18px}.sec li{margin:4px 0}
.next{display:grid;gap:8px}.step{break-inside:avoid}.step{background:${C.panel};border-radius:12px;padding:12px 14px}.step b{display:block}.step span{color:${C.muted};font-size:13px}
.goal{margin:10px 0}.gl{display:flex;justify-content:space-between;font-size:14px}.gt{position:relative;height:8px;background:${C.faint};border-radius:4px;margin:6px 0 4px}.gt span{position:absolute;left:0;top:0;bottom:0;border-radius:4px}.gt i{position:absolute;top:-3px;width:2px;height:14px;background:${C.ink}}
.cover{font-size:13px;color:${C.muted};border-top:1px solid ${C.faint};margin-top:28px;padding-top:14px}
.foot{font-size:12px;color:${C.muted};margin-top:28px}
@media (max-width:640px){.grid{grid-template-columns:1fr}.wrap{padding:24px 16px}h1{font-size:24px}}
@page{size:A4;margin:14mm}@media print{.wrap{padding:0;max-width:none}.kpi,.card,.step{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

export interface HtmlOptions {
  /** URL (or file://) for a top post's image, when it may be shown. */
  media?: (path: string, i: number) => string | undefined;
  /** Who the page is from ("Acme marketing"). */
  from?: string;
  /** Shown under the footer (e.g. "Shared link · expires 12 Nov"). */
  note?: string;
}

/** The whole report as a standalone page (share page and PDF). */
export function reportHtml(r: Report, o: HtmlOptions = {}): string {
  const shown = r.sections.filter((s) => !s.hidden && s.id !== 'next' && s.id !== 'coverage' && s.lines.length);
  const next = r.recommendations.length ? `<h2>Next steps</h2><div class="next">${r.recommendations.map((x) => `<div class="step"><b>${escHtml(x.text)}</b><span>${escHtml(x.why)}</span></div>`).join('')}</div>` : '';
  const cover = r.sections.find((s) => s.id === 'coverage' && !s.hidden);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(r.title)}</title><style>${STYLE}</style></head><body><main class="wrap">
<div class="eyebrow">${escHtml(o.from ? `${o.from} · ` : '')}${escHtml(r.title.replace(/ · .*$/, ''))}</div>
<h1>${escHtml(r.headline)}</h1>
<div class="meta">${escHtml(r.facts.period.label)} · compared with ${escHtml(r.facts.prevPeriod.label)}</div>
${r.intro ? `<p class="intro">${escHtml(r.intro)}</p>` : ''}
<div class="kpis">${kpiTiles(r)}</div>
<div class="grid">${topPosts(r, o.media) || ''}${waterfall(r) || ''}</div>
${goals(r)}
${shown.map((s) => `<section class="sec"><h2>${escHtml(s.title)}</h2><ul>${s.lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul></section>`).join('')}
${next}
${cover?.lines.length ? `<div class="cover"><b>What this report can’t see:</b> ${cover.lines.map(escHtml).join(' ')}</div>` : ''}
<div class="foot">Made with Shipcast · every number checked against your data · ${escHtml(new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}${o.note ? ` · ${escHtml(o.note)}` : ''}</div>
</main></body></html>`;
}

/** The email body: table layout and inline styles, which every mail app renders. */
export function reportEmailHtml(r: Report, link?: string): string {
  const td = `style="padding:10px 12px;background:${C.panel};border-radius:10px;font:13px ${FONT};color:${C.muted}"`;
  const kpis = r.facts.kpis.slice(0, 4).map((k) => {
    const ch = kpiChange(k);
    return `<td ${td}>${escHtml(k.label)}<div style="font:700 22px ${FONT};color:${C.ink}">${escHtml(kpiValue(k))}</div><div style="color:${ch?.dir === 'up' ? C.up : ch?.dir === 'down' ? C.down : C.muted};font-weight:600">${ch ? escHtml(ch.text) : '&nbsp;'}</div></td>`;
  });
  const shown = r.sections.filter((s) => !s.hidden && ['summary', 'results', 'why', 'website', 'goals'].includes(s.id) && s.lines.length);
  return `<!doctype html><html><body style="margin:0;background:#f3f4f7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;padding:28px;font:15px/1.55 ${FONT};color:${C.ink}"><tr><td>
<div style="font:600 12px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">${escHtml(r.title)}</div>
<h1 style="font:700 24px/1.25 ${FONT};margin:8px 0 16px">${escHtml(r.headline)}</h1>
${r.intro ? `<p style="white-space:pre-wrap">${escHtml(r.intro)}</p>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>${kpis.join('')}</tr></table>
${shown.map((s) => `<h2 style="font:700 16px ${FONT};margin:22px 0 6px">${escHtml(s.title)}</h2><ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li style="margin:4px 0">${escHtml(l)}</li>`).join('')}</ul>`).join('')}
${r.recommendations.length ? `<h2 style="font:700 16px ${FONT};margin:22px 0 6px">Next steps</h2><ol style="margin:0;padding-left:18px">${r.recommendations.map((x) => `<li style="margin:6px 0"><b>${escHtml(x.text)}</b><br><span style="color:${C.muted};font-size:13px">${escHtml(x.why)}</span></li>`).join('')}</ol>` : ''}
${link ? `<p style="margin:26px 0 0"><a href="${escHtml(link)}" style="display:inline-block;background:${C.accent};color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">Open the full report</a></p>` : ''}
<p style="font-size:12px;color:${C.muted};margin-top:24px">Made with Shipcast · every number checked against your data</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Plain text (email fallback, Markdown export and chat webhooks). */
export function reportMarkdown(r: Report, link?: string): string {
  const out = [`# ${r.headline}`, `${r.title} · compared with ${r.facts.prevPeriod.label}`, ''];
  if (r.intro) out.push(r.intro, '');
  out.push(r.facts.kpis.slice(0, 6).map((k) => `- **${k.label}:** ${kpiValue(k)}${kpiChange(k) ? ` (${kpiChange(k)!.text})` : ''}`).join('\n'), '');
  for (const s of r.sections.filter((x) => !x.hidden && x.id !== 'next' && x.lines.length)) out.push(`## ${s.title}`, ...s.lines.map((l) => `- ${l}`), '');
  if (r.recommendations.length) out.push('## Next steps', ...r.recommendations.map((x, i) => `${i + 1}. ${x.text} — ${x.why}`), '');
  if (link) out.push(`Full report: ${link}`, '');
  return out.join('\n');
}

/** The week in one card: 1080×1350, for Slack or a build-in-public post. */
export function reportCardHtml(r: Report, media?: string): string {
  const k = r.facts.kpis.filter((x) => ['audience', 'engagement', 'sessions', 'keyEvents', 'posts', 'clicks'].includes(x.key)).slice(0, 3);
  const best = r.facts.top[0];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}
body{font-family:${FONT};background:linear-gradient(160deg,#0f1b3d 0%,#16244f 55%,#1d3a8a 100%);color:#fff;padding:96px 88px;display:flex;flex-direction:column}
.e{font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:#9fb6ff;font-weight:700}
h1{font-size:76px;line-height:1.08;margin:28px 0 0;letter-spacing:-.02em}
.p{font-size:30px;color:#c3cff5;margin-top:22px}
.k{display:grid;grid-template-columns:repeat(${Math.max(1, k.length)},1fr);gap:22px;margin-top:64px}
.t{background:rgba(255,255,255,.08);border-radius:28px;padding:30px 28px}.l{font-size:24px;color:#c3cff5}.v{font-size:64px;font-weight:800;letter-spacing:-.02em;margin-top:6px}.c{font-size:28px;font-weight:700;margin-top:4px}
.b{margin-top:auto;display:flex;gap:28px;align-items:center;background:rgba(255,255,255,.08);border-radius:28px;padding:28px}
.b img,.b .x{width:150px;height:150px;border-radius:20px;object-fit:cover;background:rgba(255,255,255,.12);flex:none}
.bl{font-size:24px;color:#9fb6ff;text-transform:uppercase;letter-spacing:.1em;font-weight:700}.bt{font-size:36px;font-weight:700;line-height:1.2;margin-top:8px}.bm{font-size:26px;color:#c3cff5;margin-top:8px}
</style></head><body>
<div class="e">${escHtml(r.title.replace(/ · .*$/, ''))}</div>
<h1>${escHtml(r.headline)}</h1>
<div class="p">${escHtml(r.facts.period.label)}</div>
<div class="k">${k.map((x) => {
    const ch = kpiChange(x);
    return `<div class="t"><div class="l">${escHtml(x.label)}</div><div class="v">${escHtml(kpiValue(x))}</div><div class="c" style="color:${ch?.dir === 'up' ? '#5ee09a' : ch?.dir === 'down' ? '#ff8a80' : '#c3cff5'}">${ch ? escHtml(ch.text) : '&nbsp;'}</div></div>`;
  }).join('')}</div>
${best ? `<div class="b">${media ? `<img src="${escHtml(media)}" alt="">` : '<div class="x"></div>'}<div><div class="bl">Best post</div><div class="bt">${escHtml(clean(best.title).slice(0, 90))}</div><div class="bm">${escHtml(chName(best.channel))}${best.lift !== undefined ? ` · ${escHtml(times(best.lift))} your usual` : best.audience !== undefined ? ` · ${escHtml(num(best.audience))} reached` : ''}</div></div></div>` : ''}
</body></html>`;
}
