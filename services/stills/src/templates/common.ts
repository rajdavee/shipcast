import { pathToFileURL } from 'node:url';
import { brandCss, fontLinks, type BrandKit, type SafeZone } from '@shipcast/engine';

export type FieldType = 'text' | 'longtext' | 'image' | 'list' | 'enum' | 'color';

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  /** Max characters (text) or items (list); enforced by QA, hinted to Claude. */
  max?: number;
  choices?: string[];
  optional?: boolean;
  help?: string;
}

export interface Layout {
  id: string;
  label: string;
  /** What the layout is for, written for the model choosing it. */
  use: string;
  fields: Field[];
  html: (f: Record<string, any>, ctx: RenderCtx) => string;
}

export interface RenderCtx {
  brand: BrandKit;
  width: number;
  height: number;
  /** 1-based page number and total, for decks. */
  page?: number;
  pages?: number;
  /** Directory images are resolved against. */
  assetsDir?: string;
  handle?: string;
  /** Platform/tool logos resolved before rendering (name → data URI, null = monogram). */
  icons?: Record<string, string | null>;
  /** Platform safe zone of the canvas, for templates that pad around app overlays. */
  safe?: SafeZone;
}

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Inline rich text: `*word*` → accent emphasis, `**word**` → strong,
 * `==word==` → highlighter mark, `\n` → line break. Everything else escaped.
 */
export function rich(s: unknown): string {
  return esc(s)
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

/** Resolve an image field (absolute path, path relative to assetsDir, or http URL) to a URL. */
export function img(src: unknown, ctx: RenderCtx): string {
  const s = String(src ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//.test(s) || s.startsWith('data:')) return esc(s);
  const abs = s.startsWith('/') ? s : `${ctx.assetsDir ?? ''}/${s}`;
  return esc(pathToFileURL(abs).href);
}

export const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split('\n')).map((x) => x.trim()).filter(Boolean);

/** Auto-fit: pick a font size by text length so long lines never overflow. */
export function fit(text: unknown, sizes: [number, number][], fallback: number): number {
  const n = String(text ?? '').replace(/[*=]/g, '').length;
  for (const [maxChars, px] of sizes) if (n <= maxChars) return px;
  return fallback;
}

/** Real screens captured from the running app carry a small honest label, so copy never has to. */
const UI_LABEL = 'Real product UI · sample data';
function labelAppShots(body: string): string {
  // The label is automatic on the screenshot, so drop it where it was written into the copy.
  if (/\/assets\/app\//.test(body)) body = body.replace(/\s*[·•–—-]?\s*Real product UI\s*[·•,–—-]?\s*sample data\.?/gi, '');
  return body.replace(/(<img\b[^>]*\bsrc="[^"]*\/assets\/app\/[^"]*"[^>]*>)/g, `$1<span class="ui-label">${UI_LABEL}</span>`);
}

export function page(body: string, ctx: RenderCtx, themeCss: string, extraCss = ''): string {
  body = labelAppShots(body);
  return `<!doctype html><html><head><meta charset="utf-8">
${fontLinks(ctx.brand)}
<style>
${brandCss(ctx.brand)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${ctx.width}px;height:${ctx.height}px;overflow:hidden}
body{font-family:var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal;font-feature-settings:"ss01","cv11"}
img{display:block;max-width:100%}
:has(> .ui-label){position:relative}
.ui-label{position:absolute;right:14px;bottom:14px;z-index:5;font:600 15px/1 var(--font-body);letter-spacing:.02em;padding:7px 11px;border-radius:999px;background:rgba(10,12,16,.72);color:#fff;backdrop-filter:blur(6px);white-space:nowrap}
${themeCss}
${extraCss}
</style></head><body>${body}</body></html>`;
}

export const logo = (ctx: RenderCtx, cls = 'logo') =>
  ctx.brand.logo ? `<img class="${cls}" src="${img(ctx.brand.logo, ctx)}" alt="">` : `<span class="${cls} wordmark">${esc(ctx.brand.name)}</span>`;

/**
 * Single-colour icons (Lucide, Simple Icons) arrive baked in near-black, which
 * vanishes on dark themes. Draw those as a CSS mask so they take the
 * template's colour; full-colour logos stay as images.
 */
export function iconTag(uri: string | null | undefined, cls: string, color = 'var(--icon, var(--brand-primary))', alt = ''): string {
  if (!uri) return '';
  let mono = false;
  if (uri.startsWith('data:image/svg+xml')) {
    const comma = uri.indexOf(',');
    const raw = uri.slice(comma + 1);
    const svg = uri.slice(0, comma).includes('base64') ? Buffer.from(raw, 'base64').toString('utf8') : decodeURIComponent(raw);
    const colours = new Set((svg.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((c) => c.toLowerCase()));
    // One flat colour (ours or the brand's own near-black) reads as a glyph: let the template colour it.
    mono = colours.size <= 1 && !/<(linearGradient|radialGradient|image)\b/i.test(svg);
  }
  if (!mono) return `<img class="${cls}" src="${uri}" alt="${esc(alt)}">`;
  return `<span class="${cls} icm" role="img" aria-label="${esc(alt)}" style="display:inline-block;-webkit-mask:url('${uri}') center/62% no-repeat;mask:url('${uri}') center/62% no-repeat;background-color:${color}"></span>`;
}
