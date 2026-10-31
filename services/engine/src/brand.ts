import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Brand kit (written by the brief step as brief/brand.json) → design tokens
 * that every template consumes as CSS custom properties. Missing values get
 * sensible, contrast-safe fallbacks so templates never render unstyled.
 */

export interface BrandKit {
  name: string;
  url?: string;
  oneLiner?: string;
  colors: { background: string; surface: string; text: string; muted: string; primary: string; secondary: string };
  fonts: { display: string; body: string; mono: string; fallback: string };
  logo?: string;
  screenshots?: string[];
  voice?: string[];
  proof?: { claim: string; source: string }[];
  hooks?: string[];
  cta?: { label: string; url: string };
  socials?: Record<string, string>;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const DEFAULT_BRAND: BrandKit = {
  name: 'Your product',
  colors: { background: '#0f1115', surface: '#1a1d24', text: '#f5f6f8', muted: '#9aa1ad', primary: '#4f6bff', secondary: '#ff5a5f' },
  fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono', fallback: 'system-ui' },
};

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Move `fg` toward white (dark grounds) or black (light grounds) until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const target = luminance(bg) < 0.4 ? 255 : 0;
  const [r, g, b] = hexToRgb(fg);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = [r, g, b].map((v) => Math.round(v + (target - v) * t));
    const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    if (contrastRatio(hex, bg) >= min) return hex;
  }
  return target ? '#ffffff' : '#000000';
}

/** Black or white, whichever reads better on `bg`. */
export function onColor(bg: string): string {
  return contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';
}

export function normalizeBrand(raw: Partial<BrandKit> | null | undefined): BrandKit {
  const b = raw ?? {};
  const pick = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : d);
  const c = (b.colors ?? {}) as Partial<BrandKit['colors']>;
  const colors = {
    background: pick(c.background, DEFAULT_BRAND.colors.background),
    surface: pick(c.surface, ''),
    text: pick(c.text, ''),
    muted: pick(c.muted, ''),
    primary: pick(c.primary, DEFAULT_BRAND.colors.primary),
    secondary: pick(c.secondary, ''),
  };
  // Derive anything missing from the background so text always meets contrast.
  if (!colors.text || contrastRatio(colors.text, colors.background) < 4.5) colors.text = onColor(colors.background) === '#000000' ? '#111318' : '#f7f7f8';
  if (!colors.surface) colors.surface = luminance(colors.background) > 0.5 ? '#ffffff' : '#1b1e26';
  if (!colors.muted) colors.muted = luminance(colors.background) > 0.5 ? '#5b6170' : '#a3a9b6';
  if (!colors.secondary) colors.secondary = colors.primary;
  const f = (b.fonts ?? {}) as Partial<BrandKit['fonts']>;
  const fonts = {
    display: (f.display || DEFAULT_BRAND.fonts.display).trim(),
    body: (f.body || f.display || DEFAULT_BRAND.fonts.body).trim(),
    mono: (f.mono || DEFAULT_BRAND.fonts.mono).trim(),
    fallback: (f.fallback || 'system-ui').trim(),
  };
  return { ...DEFAULT_BRAND, ...b, name: b.name || DEFAULT_BRAND.name, colors, fonts } as BrandKit;
}

export async function loadBrand(briefDir: string): Promise<BrandKit> {
  try {
    return normalizeBrand(JSON.parse(await readFile(join(briefDir, 'brand.json'), 'utf8')));
  } catch {
    return normalizeBrand(null);
  }
}

/** CSS custom properties for templates. */
export function brandCss(b: BrandKit): string {
  const q = (s: string) => `'${s.replace(/'/g, '')}'`;
  return `:root{
  --brand-bg:${b.colors.background};--brand-surface:${b.colors.surface};--brand-text:${b.colors.text};
  --brand-muted:${b.colors.muted};--brand-primary:${b.colors.primary};--brand-secondary:${b.colors.secondary};
  --brand-on-primary:${onColor(b.colors.primary)};
  --accent-on-bg:${ensureContrast(b.colors.primary, b.colors.background)};
  --accent-on-dark:${ensureContrast(b.colors.primary, '#0b0d12')};
  --accent2-on-dark:${ensureContrast(b.colors.secondary, '#0b0d12')};
  --accent-on-light:${ensureContrast(b.colors.primary, '#f6f7f9')};
  --font-display:${q(b.fonts.display)},${b.fonts.fallback},sans-serif;
  --font-body:${q(b.fonts.body)},${b.fonts.fallback},sans-serif;
  --font-mono:${q(b.fonts.mono)},ui-monospace,monospace;
}`;
}

/**
 * Google Fonts <link> tags for the brand's families. One link per family (a
 * bad family can't break the others) asking for a variable weight range, with
 * a plain-family fallback link for static fonts that reject ranges.
 */
export function fontLinks(b: BrandKit): string {
  const system = /^(system-ui|sans-serif|serif|monospace|-apple-system|helvetica|arial|sf pro.*|segoe ui|inter var)$/i;
  const fams = [...new Set([b.fonts.display, b.fonts.body, b.fonts.mono])].filter((f) => f && !system.test(f));
  const fam = (f: string) => encodeURIComponent(f).replace(/%20/g, '+');
  return fams
    .flatMap((f) => [
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fam(f)}:wght@100..900&display=block">`,
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fam(f)}:wght@400;700&display=block">`,
    ])
    .join('\n');
}
