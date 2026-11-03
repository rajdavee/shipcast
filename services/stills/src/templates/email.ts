import { basename } from 'node:path';
import type { BrandKit } from '@shipcast/engine';
import { esc } from './common.ts';

/**
 * Marketing email that survives real inboxes: table layout, inline styles,
 * 600 px, a bulletproof button, alt text everywhere, web-safe font stacks
 * behind the brand font, and dark-mode hints for the clients that honour them.
 * Images are referenced relatively (images/…) so the HTML + folder zip
 * imports straight into Mailchimp, HubSpot, Klaviyo, Brevo or Customer.io.
 */

export type EmailBlock =
  | { type: 'hero'; image?: string; kicker?: string; headline: string; body?: string; cta?: string; url?: string }
  | { type: 'text'; heading?: string; body: string }
  | { type: 'feature'; image?: string; heading: string; body: string; side?: 'left' | 'right'; cta?: string; url?: string }
  | { type: 'bullets'; heading?: string; items: string[] }
  | { type: 'quote'; quote: string; name: string; role?: string }
  | { type: 'stats'; stats: string[] }
  | { type: 'cta'; headline: string; body?: string; cta: string; url: string }
  | { type: 'image'; image: string; alt: string; url?: string }
  | { type: 'divider' }
  // Newsletter issues: masthead, short items and the forward line.
  | { type: 'masthead'; title?: string; issue: string; date: string; tagline?: string }
  | { type: 'items'; heading?: string; items: string[] }
  | { type: 'forward'; text?: string; url?: string };

export interface EmailSpec {
  name: string;
  subjects: string[];
  preheader: string;
  blocks: EmailBlock[];
  /** Sign-off line, e.g. "— Maya, founder". */
  signoff?: string;
}

export interface EmailSetSpec {
  theme?: 'light' | 'brand' | 'dark';
  /** Footer: postal address (required by CAN-SPAM) and why they get this email. */
  footer?: { address?: string; reason?: string };
  emails: EmailSpec[];
}

const SAFE_SANS = "Helvetica, Arial, sans-serif";

function inline(s: unknown, accent: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, `<span style="color:${accent}">$1</span>`)
    .replace(/==(.+?)==/g, `<span style="background:${accent}22">$1</span>`);
}

/** Paragraphs and bullets for email bodies (blank-line paragraphs, "- " bullets). */
function bodyHtml(src: unknown, c: Colors): string {
  return String(src ?? '')
    .split(/\n{2,}/)
    .map((b) => {
      const lines = b.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return `<ul style="margin:0 0 16px 0;padding:0 0 0 20px">${lines.map((l) => `<li style="margin:0 0 8px 0">${inline(l.replace(/^\s*[-•*]\s+/, ''), c.accent)}</li>`).join('')}</ul>`;
      return `<p style="margin:0 0 16px 0">${inline(lines.join(' '), c.accent)}</p>`;
    })
    .join('');
}

const textOf = (s: unknown) => String(s ?? '').replace(/\*\*|==|\*/g, '');

interface Colors { bg: string; card: string; fg: string; muted: string; accent: string; btnBg: string; btnFg: string; rule: string; heroBg: string; heroFg: string }

function colors(brand: BrandKit, theme: string): Colors {
  const p = brand.colors.primary;
  const onP = readableOn(p);
  if (theme === 'dark') return { bg: '#0d0f14', card: '#161a22', fg: '#f1f3f7', muted: '#a1a9b8', accent: lighten(p), btnBg: p, btnFg: onP, rule: '#2a303b', heroBg: '#161a22', heroFg: '#f1f3f7' };
  if (theme === 'brand') return { bg: '#f2f3f5', card: '#ffffff', fg: '#14171c', muted: '#5b6270', accent: p, btnBg: p, btnFg: onP, rule: '#e4e7ec', heroBg: p, heroFg: onP };
  return { bg: '#f2f3f5', card: '#ffffff', fg: '#14171c', muted: '#5b6270', accent: p, btnBg: p, btnFg: onP, rule: '#e4e7ec', heroBg: '#ffffff', heroFg: '#14171c' };
}

function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.55 ? '#111111' : '#ffffff';
}
function lighten(hex: string): string {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return '#' + [0, 2, 4].map((i) => Math.round(parseInt(f.slice(i, i + 2), 16) * 0.55 + 255 * 0.45).toString(16).padStart(2, '0')).join('');
}

/** A button Outlook renders too: VML roundrect for mso, padded link for everyone else. */
function button(label: string, url: string, c: Colors): string {
  const u = esc(url || '#');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px 0"><tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${u}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="50%" stroke="f" fillcolor="${c.btnBg}"><center style="color:${c.btnFg};font-family:${SAFE_SANS};font-size:16px;font-weight:bold;">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${u}" style="display:inline-block;background:${c.btnBg};color:${c.btnFg};font-family:${SAFE_SANS};font-size:16px;font-weight:bold;line-height:48px;padding:0 28px;border-radius:999px;text-decoration:none">${esc(label)} &rarr;</a><!--<![endif]-->
</td></tr></table>`;
}

export interface RenderedEmail {
  html: string;
  text: string;
  /** Local image paths used, mapped to the relative name in the HTML. */
  images: { src: string; name: string }[];
  links: number;
}

export function renderEmail(e: EmailSpec, set: EmailSetSpec, brand: BrandKit, resolveImage: (p: string) => string): RenderedEmail {
  // Model-written specs can miss fields; render what's there and let the checks explain the rest.
  e = { ...e, name: String(e.name ?? 'email'), subjects: Array.isArray(e.subjects) ? e.subjects.map(String) : [], preheader: String(e.preheader ?? ''), blocks: Array.isArray(e.blocks) ? e.blocks.filter((x) => x && typeof x === 'object') : [] };
  const c = colors(brand, set.theme ?? 'light');
  const font = `'${brand.fonts.body}', ${SAFE_SANS}`;
  const display = `'${brand.fonts.display}', ${SAFE_SANS}`;
  const images: { src: string; name: string }[] = [];
  const imgRef = (p: string) => {
    const src = resolveImage(p);
    const existing = images.find((x) => x.src === src);
    if (existing) return existing.name;
    const name = `images/${images.length + 1}-${basename(src).replace(/[^\w.-]/g, '_')}`;
    images.push({ src, name });
    return name;
  };
  let links = 0;
  const link = () => links++;
  const text: string[] = [textOf(e.preheader), ''];
  const rows: string[] = [];
  const pad = 'padding:0 40px';
  for (const b of e.blocks) {
    if (b.type === 'hero') {
      text.push(textOf(b.headline).toUpperCase(), '', textOf(b.body), b.cta ? `${b.cta}: ${b.url ?? ''}` : '', '');
      if (b.cta) link();
      rows.push(`<tr><td style="background:${c.heroBg};color:${c.heroFg};padding:40px 40px 36px 40px;border-radius:16px 16px 0 0">
${b.kicker ? `<p style="margin:0 0 12px 0;font-family:${font};font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;opacity:.85">${esc(b.kicker)}</p>` : ''}
<h1 style="margin:0 0 14px 0;font-family:${display};font-size:34px;line-height:1.12;font-weight:800;color:${c.heroFg}">${inline(b.headline, set.theme === 'brand' ? c.heroFg : c.accent)}</h1>
${b.body ? `<div style="font-family:${font};font-size:17px;line-height:1.55;color:${c.heroFg};opacity:.92">${bodyHtml(b.body, c)}</div>` : ''}
${b.cta ? (set.theme === 'brand' ? button(b.cta, b.url ?? '', { ...c, btnBg: c.heroFg, btnFg: c.heroBg }) : button(b.cta, b.url ?? '', c)) : ''}
</td></tr>${b.image ? `<tr><td style="background:${c.heroBg};padding:0 40px 40px 40px"><img src="${imgRef(b.image)}" width="520" alt="${esc(textOf(b.headline))}" style="display:block;width:100%;max-width:520px;height:auto;border-radius:12px;border:1px solid ${c.rule}"></td></tr>` : ''}`);
    } else if (b.type === 'text') {
      text.push(b.heading ? textOf(b.heading) : '', textOf(b.body), '');
      rows.push(`<tr><td style="${pad};padding-top:28px;font-family:${font};font-size:16px;line-height:1.6;color:${c.fg}">${b.heading ? `<h2 style="margin:0 0 10px 0;font-family:${display};font-size:22px;line-height:1.25;color:${c.fg}">${inline(b.heading, c.accent)}</h2>` : ''}${bodyHtml(b.body, c)}</td></tr>`);
    } else if (b.type === 'feature') {
      text.push(textOf(b.heading), textOf(b.body), b.cta ? `${b.cta}: ${b.url ?? ''}` : '', '');
      if (b.cta) link();
      const img = b.image ? `<td class="stack" width="240" valign="top" style="padding:0 ${b.side === 'right' ? '0 0 20px' : '20px 0 0'}"><img src="${imgRef(b.image)}" width="240" alt="${esc(textOf(b.heading))}" style="display:block;width:100%;max-width:240px;height:auto;border-radius:10px;border:1px solid ${c.rule}"></td>` : '';
      const copy = `<td class="stack" valign="top" style="font-family:${font};font-size:15px;line-height:1.55;color:${c.fg}"><h3 style="margin:0 0 8px 0;font-family:${display};font-size:19px;line-height:1.3;color:${c.fg}">${inline(b.heading, c.accent)}</h3>${bodyHtml(b.body, c)}${b.cta ? `<a href="${esc(b.url ?? '#')}" style="color:${c.accent};font-weight:bold;text-decoration:none">${esc(b.cta)} &rarr;</a>` : ''}</td>`;
      rows.push(`<tr><td style="${pad};padding-top:28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${b.side === 'right' ? copy + img : img + copy}</tr></table></td></tr>`);
    } else if (b.type === 'bullets') {
      text.push(b.heading ? textOf(b.heading) : '', ...b.items.map((i) => `- ${textOf(i)}`), '');
      rows.push(`<tr><td style="${pad};padding-top:24px;font-family:${font};font-size:16px;line-height:1.55;color:${c.fg}">${b.heading ? `<h2 style="margin:0 0 12px 0;font-family:${display};font-size:20px;color:${c.fg}">${inline(b.heading, c.accent)}</h2>` : ''}<table role="presentation" cellpadding="0" cellspacing="0" border="0">${b.items.map((i) => `<tr><td valign="top" style="padding:2px 12px 10px 0;color:${c.accent};font-weight:bold">&#10003;</td><td style="padding:0 0 10px 0;font-family:${font};font-size:16px;line-height:1.5;color:${c.fg}">${inline(i, c.accent)}</td></tr>`).join('')}</table></td></tr>`);
    } else if (b.type === 'quote') {
      text.push(`"${textOf(b.quote)}" — ${b.name}${b.role ? `, ${b.role}` : ''}`, '');
      rows.push(`<tr><td style="${pad};padding-top:28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid ${c.accent};padding:4px 0 4px 18px;font-family:${display};font-size:19px;line-height:1.45;font-weight:600;color:${c.fg}">&ldquo;${inline(b.quote, c.accent)}&rdquo;<p style="margin:10px 0 0 0;font-family:${font};font-size:14px;font-weight:normal;color:${c.muted}">${esc(b.name)}${b.role ? `, ${esc(b.role)}` : ''}</p></td></tr></table></td></tr>`);
    } else if (b.type === 'stats') {
      const st = b.stats.slice(0, 3).map((s) => s.split('|').map((x) => x.trim()));
      text.push(...st.map(([v, l]) => `${v} — ${l ?? ''}`), '');
      rows.push(`<tr><td style="${pad};padding-top:28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${st.map(([v, l]) => `<td class="stack" align="center" valign="top" style="padding:18px 8px;background:${c.bg};border-radius:12px"><div style="font-family:${display};font-size:32px;font-weight:800;color:${c.accent};line-height:1">${esc(v)}</div><div style="font-family:${font};font-size:13px;line-height:1.4;color:${c.muted};padding-top:6px">${esc(l ?? '')}</div></td>`).join(`<td width="12" style="font-size:0">&nbsp;</td>`)}</tr></table></td></tr>`);
    } else if (b.type === 'cta') {
      text.push(textOf(b.headline), textOf(b.body), `${b.cta}: ${b.url}`, '');
      link();
      rows.push(`<tr><td align="center" style="${pad};padding-top:36px;padding-bottom:8px;font-family:${font};color:${c.fg}"><h2 style="margin:0 0 10px 0;font-family:${display};font-size:24px;line-height:1.25;color:${c.fg}">${inline(b.headline, c.accent)}</h2>${b.body ? `<p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${c.muted}">${inline(b.body, c.accent)}</p>` : ''}${button(b.cta, b.url, c)}</td></tr>`);
    } else if (b.type === 'image') {
      if (b.url) link();
      const im = `<img src="${imgRef(b.image)}" width="520" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:520px;height:auto;border-radius:12px;border:1px solid ${c.rule}">`;
      rows.push(`<tr><td style="${pad};padding-top:24px">${b.url ? `<a href="${esc(b.url)}">${im}</a>` : im}</td></tr>`);
    } else if (b.type === 'masthead') {
      const name = b.title || brand.name;
      text.push(`${textOf(name)} — ${textOf(b.issue)} · ${textOf(b.date)}`, b.tagline ? textOf(b.tagline) : '', '');
      rows.push(`<tr><td style="${pad};padding-top:28px;padding-bottom:4px;border-bottom:1px solid ${c.rule}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="bottom" style="font-family:${display};font-size:22px;line-height:1.2;font-weight:800;color:${c.fg};padding-bottom:14px">${inline(name, c.accent)}${b.tagline ? `<div style="font-family:${font};font-size:13px;font-weight:normal;color:${c.muted};padding-top:4px">${inline(b.tagline, c.accent)}</div>` : ''}</td><td align="right" valign="bottom" style="font-family:${font};font-size:13px;line-height:1.4;color:${c.muted};padding-bottom:14px;white-space:nowrap"><strong style="color:${c.accent}">${esc(b.issue)}</strong><br>${esc(b.date)}</td></tr></table></td></tr>`);
    } else if (b.type === 'items') {
      const its = (Array.isArray(b.items) ? b.items : []).map((x) => String(x).split('|').map((y) => y.trim()));
      text.push(b.heading ? textOf(b.heading) : '', ...its.map(([t, d, u]) => `- ${textOf(t)}${d ? `: ${textOf(d)}` : ''}${u ? ` (${u})` : ''}`), '');
      links += its.filter(([, , u]) => u).length;
      rows.push(`<tr><td style="${pad};padding-top:28px;font-family:${font};color:${c.fg}">${b.heading ? `<h2 style="margin:0 0 6px 0;font-family:${display};font-size:20px;line-height:1.25;color:${c.fg}">${inline(b.heading, c.accent)}</h2>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${its.map(([t, d, u], n) => `<tr><td valign="top" width="34" style="padding:14px 0 0 0;font-family:${display};font-size:15px;font-weight:800;color:${c.accent}">${String(n + 1).padStart(2, '0')}</td><td style="padding:14px 0 12px 0;border-bottom:${n < its.length - 1 ? `1px solid ${c.rule}` : '0'};font-family:${font};font-size:15px;line-height:1.55;color:${c.fg}"><strong style="font-family:${display};font-size:16px">${u ? `<a href="${esc(u)}" style="color:${c.fg};text-decoration:none">${inline(t, c.accent)} &rarr;</a>` : inline(t, c.accent)}</strong>${d ? `<br><span style="color:${c.muted}">${inline(d, c.accent)}</span>` : ''}</td></tr>`).join('')}</table></td></tr>`);
    } else if (b.type === 'forward') {
      const line = b.text || `Know someone who'd like this? Forward it to them.`;
      text.push(textOf(line), b.url ? `Forwarded this? Subscribe: ${b.url}` : '', '');
      // The subscribe link is housekeeping like unsubscribe, not a competing call to action: not counted.
      rows.push(`<tr><td style="${pad};padding-top:28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${c.bg};border-radius:12px;padding:16px 20px;font-family:${font};font-size:14px;line-height:1.55;color:${c.muted}">&#9993;&nbsp; ${inline(line, c.accent)}${b.url ? `<br>Forwarded this? <a href="${esc(b.url)}" style="color:${c.accent};font-weight:bold;text-decoration:none">Subscribe here</a>.` : ''}</td></tr></table></td></tr>`);
    } else if (b.type === 'divider') {
      rows.push(`<tr><td style="${pad};padding-top:28px"><div style="height:1px;background:${c.rule};line-height:1px;font-size:0">&nbsp;</div></td></tr>`);
    }
  }
  if (e.signoff) {
    text.push(textOf(e.signoff), '');
    rows.push(`<tr><td style="${pad};padding-top:20px;font-family:${font};font-size:16px;line-height:1.55;color:${c.fg}">${inline(e.signoff, c.accent)}</td></tr>`);
  }
  const logo = brand.logo ? `<img src="${imgRef(brand.logo)}" height="32" alt="${esc(brand.name)}" style="display:block;height:32px;width:auto;border:0">` : `<span style="font-family:${display};font-size:20px;font-weight:800;color:${c.fg}">${esc(brand.name)}</span>`;
  const reason = set.footer?.reason ?? `You're receiving this because you signed up for updates from ${brand.name}.`;
  text.push('—', reason, set.footer?.address ?? '', 'Unsubscribe: {{unsubscribe_url}}');
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(textOf(e.subjects[0] ?? e.name))}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
table{border-collapse:collapse}img{border:0;outline:none;text-decoration:none}
@media (max-width:620px){.container{width:100%!important}.stack{display:block!important;width:100%!important;padding:0 0 16px 0!important}}
@media (prefers-color-scheme:dark){.bg{background:#0d0f14!important}.card{background:#161a22!important}}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${c.bg}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(textOf(e.preheader))}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:${c.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td style="padding:8px 4px 20px 4px">${logo}</td></tr>
<tr><td class="card" style="background:${c.card};border-radius:16px;padding:0 0 36px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows.join('\n')}
</table>
</td></tr>
<tr><td style="padding:24px 8px;font-family:${font};font-size:12px;line-height:1.6;color:${c.muted}" align="center">
${esc(reason)}<br>${set.footer?.address ? `${esc(set.footer.address)}<br>` : ''}<a href="{{unsubscribe_url}}" style="color:${c.muted};text-decoration:underline">Unsubscribe</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { html, text: text.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim() + '\n', images, links: links + 1 };
}

/** Deliverability checks marketers would otherwise learn the hard way. */
export function checkEmail(e: EmailSpec, r: RenderedEmail, set: EmailSetSpec): string[] {
  const out: string[] = [];
  const kb = Buffer.byteLength(r.html) / 1024;
  if (kb > 100) out.push(`${e.name}: HTML is ${Math.round(kb)} KB — Gmail clips messages over 102 KB; trim blocks.`);
  if (!e.subjects?.length) out.push(`${e.name}: add 3–5 subject line variants.`);
  for (const s of e.subjects ?? []) if (s.length > 60) out.push(`${e.name}: subject "${s.slice(0, 40)}…" is ${s.length} chars; keep under 50 so phones show it whole.`);
  if (!e.preheader || e.preheader.length < 30) out.push(`${e.name}: preheader should be 40–110 characters and add to the subject, not repeat it.`);
  if (e.preheader && e.preheader.length > 140) out.push(`${e.name}: preheader is ${e.preheader.length} chars; inboxes show ~110.`);
  if (r.links > 6) out.push(`${e.name}: ${r.links} links — one primary CTA (repeated at most twice) converts better and looks less spammy.`);
  const all = JSON.stringify(e);
  if (/\bFREE\b|!!!|\$\$\$/.test(all) || /100% free|act now|click here/i.test(all)) out.push(`${e.name}: spam-trigger phrasing ("click here", "act now", ALL-CAPS FREE, !!!) — rephrase.`);
  if (!set.footer?.address) out.push('Add footer.address (a real postal address is required by CAN-SPAM); use the one from the brief or ask in NOTES.md.');
  return out;
}
