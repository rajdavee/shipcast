import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brandCss, contrastRatio, ensureContrast, loadBrand, localizeFonts, normalizeBrand, resolveIcons, type BrandKit } from '@shipcast/engine';
import { esc } from './scenes.ts';

/**
 * Animated framework infographic — the save-worthy LinkedIn format.
 *
 * Every layout shows the whole framework on the first frame (that frame is
 * the feed thumbnail); motion is a guided tour on top: a dot runs the
 * connector, each step lights up, and a named cursor clicks through the
 * platforms people actually use at that step. The loop is seamless.
 *
 * Layouts: table (journey matrix), timeline (alternating roadmap), funnel,
 * compare (A vs B). Looks: board, night, sketch (hand-drawn, Rough.js),
 * paper (editorial serif), glass (frosted on a gradient field).
 */

export type ColumnKind = 'stage' | 'note' | 'chips' | 'text';
export type Layout = 'table' | 'timeline' | 'funnel' | 'compare';
export type Look = 'board' | 'night' | 'sketch' | 'paper' | 'glass';
/** A platform name, or a group shown as stacked logos with one label ("AI assistants"). */
export type Chip = string | { label: string; icons: string[] };

export interface InfographicStep {
  title: string;
  text?: string;
  /** A first-person thought, shown as a sticky note. */
  note?: string;
  chips?: Chip[];
  /** Funnel only: a number that sits on the level ("68%", "2.4k"). */
  metric?: string;
}

export interface InfographicSpec {
  layout?: Layout;
  look?: Look;
  /** Deprecated alias for look ('board' | 'night'). */
  theme?: 'board' | 'night';
  kicker?: string;
  /** `*phrase*` gets the accent treatment. */
  title: string;
  badge?: string;
  cursor?: string;
  /** table */
  columns?: { label: string; kind: ColumnKind; tone?: 'yellow' | 'green' | 'blue' | 'pink' }[];
  rows?: (string | Chip[])[][];
  /** timeline + funnel */
  steps?: InfographicStep[];
  /** compare */
  compare?: {
    left: { name: string; icon?: string };
    right: { name: string; icon?: string };
    rows: { label: string; left: string; right: string; winner?: 'left' | 'right' | 'both' | 'none' }[];
  };
  /** avatar: 'github:<user>', an https URL, or a file in the brief. */
  footer?: { name?: string; handle?: string; brand?: string; avatar?: string };
  size?: '1080x1350' | '1080x1080';
  beat?: number;
}

const LAYOUTS: Layout[] = ['table', 'timeline', 'funnel', 'compare'];
const LOOKS: Look[] = ['board', 'night', 'sketch', 'paper', 'glass'];
const chipText = (c: Chip) => (typeof c === 'string' ? c : c.label);
const chipIcons = (c: Chip) => (typeof c === 'string' ? [c] : c.icons);

export function validateInfographic(s: InfographicSpec): string[] {
  const e: string[] = [];
  const layout = s?.layout ?? 'table';
  if (!s?.title?.trim()) e.push('title is required');
  if (!LAYOUTS.includes(layout)) e.push(`layout must be one of ${LAYOUTS.join(', ')}`);
  if (s?.look && !LOOKS.includes(s.look)) e.push(`look must be one of ${LOOKS.join(', ')}`);
  const len = (v: unknown, max: number, where: string) => typeof v === 'string' && v.length > max && e.push(`${where} is ${v.length} chars (max ${max})`);
  const chips = (list: unknown, where: string, max = 8) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return e.push(`${where} must be a list of platform names`);
    if (list.length > max) e.push(`${where}: at most ${max} chips`);
    list.forEach((c, k) => {
      if (typeof c === 'string') return len(c, 26, `${where} chip ${k + 1}`);
      if (!c || typeof c.label !== 'string' || !Array.isArray(c.icons) || !c.icons.length || c.icons.length > 4) e.push(`${where} chip ${k + 1} must be a name or {label, icons:[1–4 names]}`);
      else len(c.label, 22, `${where} chip ${k + 1} label`);
    });
  };
  if (layout === 'table') {
    if (!Array.isArray(s?.columns) || s.columns.length < 2 || s.columns.length > 4) e.push('columns must have 2–4 entries');
    if (!Array.isArray(s?.rows) || s.rows.length < 3 || s.rows.length > 9) e.push('rows must have 3–9 entries');
    (s?.rows ?? []).forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== (s.columns?.length ?? 0)) return e.push(`row ${i + 1} must have ${s.columns?.length} cells`);
      r.forEach((c, j) => {
        const kind = s.columns?.[j]?.kind;
        if (kind === 'chips') chips(c, `row ${i + 1}, column ${j + 1}`);
        else if (typeof c !== 'string') e.push(`row ${i + 1}, column ${j + 1} must be text`);
        else len(c, kind === 'stage' ? 28 : 110, `row ${i + 1}, column ${j + 1}`);
      });
    });
  }
  if (layout === 'timeline' || layout === 'funnel') {
    const max = layout === 'funnel' ? 6 : 8;
    if (!Array.isArray(s?.steps) || s.steps.length < 3 || s.steps.length > max) e.push(`steps must have 3–${max} entries`);
    (s?.steps ?? []).forEach((st, i) => {
      if (!st?.title?.trim()) e.push(`step ${i + 1} needs a title`);
      len(st?.title, 30, `step ${i + 1} title`);
      len(st?.text, 120, `step ${i + 1} text`);
      len(st?.note, 70, `step ${i + 1} note`);
      len(st?.metric, 8, `step ${i + 1} metric`);
      chips(st?.chips, `step ${i + 1}`, layout === 'funnel' ? 5 : 6);
    });
  }
  if (layout === 'compare') {
    const c = s?.compare;
    if (!c?.left?.name || !c?.right?.name) e.push('compare needs left.name and right.name');
    if (!Array.isArray(c?.rows) || c.rows.length < 3 || c.rows.length > 9) e.push('compare.rows must have 3–9 entries');
    (c?.rows ?? []).forEach((r, i) => {
      len(r?.label, 28, `compare row ${i + 1} label`);
      len(r?.left, 90, `compare row ${i + 1} left`);
      len(r?.right, 90, `compare row ${i + 1} right`);
    });
  }
  return e;
}

interface LookTokens {
  ground: string;
  ink: string;
  pill: string;
  onPill: string;
  card: string;
  line: string;
  notes: [string, string];
  bg: string;
  noteFont?: string;
  titleFont?: string;
  extraFonts: string[];
  css: string;
}

function lookTokens(look: Look, accent: string, secondary: string): LookTokens {
  const dots = (c: string) => `background-image:radial-gradient(${c} 1.3px,transparent 1.4px);background-size:22px 22px;background-position:11px 11px;`;
  switch (look) {
    case 'night':
      return { ground: '#0e110f', ink: '#eef1ea', pill: '#eef1ea', onPill: '#121611', card: '#171b16', line: 'rgba(255,255,255,.16)', notes: ['#f6dc8c', '#d7efb4'], bg: dots('rgba(255,255,255,.07)'), extraFonts: [], css: '' };
    case 'sketch':
      return {
        ground: '#fbfaf5', ink: '#1b1c19', pill: '#1b1c19', onPill: '#ffffff', card: 'transparent', line: 'rgba(27,28,25,.55)', notes: ['#fde58a', '#cdeeb0'],
        bg: 'background-image:linear-gradient(rgba(40,80,160,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(40,80,160,.07) 1px,transparent 1px);background-size:28px 28px;',
        noteFont: 'Kalam', extraFonts: ['Kalam'],
        // Shapes are drawn by Rough.js behind the content; CSS boxes go transparent.
        css: '.rk{background:transparent!important;border-color:transparent!important;box-shadow:none!important}.stage.rk{color:#fff}',
      };
    case 'paper':
      return {
        ground: '#f6f1e7', ink: '#1f1b16', pill: 'transparent', onPill: '#1f1b16', card: '#fffdf8', line: 'rgba(31,27,22,.28)', notes: ['#fffdf8', '#fffdf8'], bg: '',
        titleFont: 'Instrument Serif', noteFont: 'Instrument Serif', extraFonts: ['Instrument Serif'],
        css: `h1{font-weight:400!important;letter-spacing:-.02em!important}h1 em{font-style:italic!important}h1 em .hl{display:none}
.stage{box-shadow:none!important;border:1.5px solid rgba(31,27,22,.85)!important}.note{box-shadow:none!important;transform:none!important;border-left:3px solid ${accent};border-radius:0!important;font-style:italic;font-weight:400!important;font-size:calc((var(--fs) + 2) * 1px)!important}
.chips,.card{border-radius:4px!important}.chip{border-radius:4px!important}.lab{background:transparent!important;color:#1f1b16!important;border-bottom:2px solid #1f1b16;border-radius:0!important;padding:6px 0!important}`,
      };
    case 'glass':
      return {
        ground: '#0a0d1a', ink: '#f2f4ff', pill: 'rgba(255,255,255,.1)', onPill: '#ffffff', card: 'rgba(255,255,255,.06)', line: 'rgba(255,255,255,.22)', notes: ['rgba(255,255,255,.08)', 'rgba(255,255,255,.08)'],
        bg: `background-image:radial-gradient(520px 420px at 12% 18%, color-mix(in srgb, ${accent} 55%, transparent), transparent 70%),radial-gradient(560px 480px at 92% 62%, color-mix(in srgb, ${secondary} 45%, transparent), transparent 70%),radial-gradient(420px 380px at 40% 100%, rgba(80,120,255,.35), transparent 70%);`,
        extraFonts: [],
        css: `.stage,.chips,.card,.note,.lvl{backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px)}
.stage{border:1px solid rgba(255,255,255,.22)!important}.chips,.card{border:1px solid rgba(255,255,255,.16)!important}.note{color:#f2f4ff!important;border:1px solid rgba(255,255,255,.16);border-left:4px solid #f7cf5c;transform:none!important;border-radius:12px!important}
.chip{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.16)!important;color:#f2f4ff}.lab{background:rgba(255,255,255,.12)!important;color:#fff!important}`,
      };
    default:
      return { ground: '#f3f2ec', ink: '#121411', pill: '#141a12', onPill: '#ffffff', card: '#ffffff', line: 'rgba(20,26,18,.3)', notes: ['#fbe39b', '#e2f4c5'], bg: dots('rgba(20,26,18,.13)'), extraFonts: [], css: '' };
  }
}

const TONES = { yellow: '#fbe39b', green: '#e2f4c5', blue: '#d8e8ff', pink: '#ffdcea' };
const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Footer avatar: 'github:<user>', an https URL, or a file in the brief → data URI. */
async function avatarUri(ref: string | undefined, brandDir?: string): Promise<string | null> {
  if (!ref) return null;
  try {
    const url = ref.startsWith('github:') ? `https://github.com/${ref.slice(7)}.png?size=160` : /^https?:/.test(ref) ? ref : null;
    if (url) {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      return `data:${r.headers.get('content-type') ?? 'image/png'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
    }
    const file = brandDir ? join(brandDir, ref) : ref;
    if (!existsSync(file)) return null;
    return `data:${MIME[extname(file).toLowerCase()] ?? 'image/png'};base64,${(await readFile(file)).toString('base64')}`;
  } catch {
    return null;
  }
}

export async function compileInfographic(spec: InfographicSpec, o: { dir: string; brandDir?: string; brand?: Partial<BrandKit> }) {
  const errs = validateInfographic(spec);
  if (errs.length) throw new Error(`infographic is invalid:\n- ${errs.join('\n- ')}`);
  const layout: Layout = spec.layout ?? 'table';
  const look: Look = spec.look ?? spec.theme ?? 'board';
  const [W, H] = (spec.size ?? '1080x1350').split('x').map(Number);
  const brand = o.brandDir ? await loadBrand(o.brandDir) : normalizeBrand(o.brand);
  const base = lookTokens(look, brand.colors.primary, brand.colors.secondary);
  const accent = ensureContrast(brand.colors.primary, base.ground, 3.2);
  const T = lookTokens(look, accent, brand.colors.secondary);
  const dark = contrastRatio(T.ground, '#000') < contrastRatio(T.ground, '#fff');
  const solidPill = T.pill.startsWith('#') ? T.pill : dark ? '#1c2030' : '#ffffff';
  const pillAccent = contrastRatio(brand.colors.primary, solidPill) >= 3 ? brand.colors.primary : ensureContrast(brand.colors.primary, solidPill, 3.2);
  const onAccent = contrastRatio(pillAccent, '#000') > contrastRatio(pillAccent, '#fff') ? '#111' : '#fff';
  const onAccentBg = contrastRatio(accent, '#000') > contrastRatio(accent, '#fff') ? '#111' : '#fff';

  await mkdir(join(o.dir, 'assets'), { recursive: true });
  const fonts = await localizeFonts([brand.fonts.display, brand.fonts.body, 'JetBrains Mono', ...T.extraFonts], join(o.dir, 'assets', 'fonts'), 'assets/fonts');
  const fam = (f: string | undefined, fb: string) => (f && fonts.families.includes(f) ? `'${f}',${fb}` : fb);
  const display = fam(T.titleFont ?? brand.fonts.display, 'system-ui,sans-serif');
  const stageFont = fam(brand.fonts.display, 'system-ui,sans-serif');
  const body = fam(brand.fonts.body, 'system-ui,sans-serif');
  const noteFont = T.noteFont ? fam(T.noteFont, body) : body;
  const mono = fam('JetBrains Mono', 'ui-monospace,monospace');

  // ---- content model shared by layouts
  const cols = spec.columns ?? [];
  const allChips: Chip[] =
    layout === 'table'
      ? (spec.rows ?? []).flatMap((r) => r.flatMap((c, j) => (cols[j]?.kind === 'chips' && Array.isArray(c) ? (c as Chip[]) : [])))
      : layout === 'compare'
        ? [spec.compare!.left.icon ?? spec.compare!.left.name, spec.compare!.right.icon ?? spec.compare!.right.name]
        : (spec.steps ?? []).flatMap((s) => s.chips ?? []);
  const icons = await resolveIcons(allChips.flatMap(chipIcons));
  const iconIds = new Map(Object.keys(icons).filter((k) => icons[k]).map((k, i) => [k, `ic${i}`]));
  const iconCss = [...iconIds].map(([k, id]) => `.${id}{background-image:url("${icons[k]}")}`).join('\n');
  const ico = (name: string) => (iconIds.has(name.trim()) ? `<i class="ico ${iconIds.get(name.trim())}"></i>` : `<b class="mono-ic">${esc(name.trim()[0]?.toUpperCase() ?? '•')}</b>`);
  const chipHtml = (c: Chip, row: number) =>
    typeof c === 'string'
      ? `<span class="chip" data-row="${row}">${ico(c)}${esc(c)}</span>`
      : `<span class="chip grp" data-row="${row}"><span class="stack">${c.icons.map(ico).join('')}</span>${esc(c.label)}</span>`;
  const n = layout === 'table' ? spec.rows!.length : layout === 'compare' ? spec.compare!.rows.length : spec.steps!.length;

  // ---- header / footer
  const titleLen = spec.title.replace(/\*/g, '').length;
  const titleSize = look === 'paper' ? (W >= H ? 66 : 76) : W >= H ? 54 : 62;
  const perLine = Math.floor((W - 260) / (titleSize * 0.5));
  const twoLines = titleLen > perLine;
  const head = 64 + titleSize * 1.05 * (twoLines ? 2 : 1) + (spec.kicker ? 30 : 0) + 34;
  const foot = 96;
  const pad = 40;
  const title = esc(spec.title).replace(/\*([^*]+)\*/g, '<em><i class="hl"></i><span>$1</span></em>');
  const footer = spec.footer ?? {};
  const who = footer.name ?? brand.name;
  const initials = who.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const handle = footer.handle ?? (brand.url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  const avatar = await avatarUri(footer.avatar, o.brandDir);
  const logo = brand.logo && o.brandDir ? await avatarUri(brand.logo, o.brandDir) : null;
  // ---- body per layout
  const avail = H - head - foot - 40;
  const gap = Math.round(Math.max(10, 20 - n));
  const rowH = (avail - 40 - gap * (n - 1)) / n;
  const fs = Math.max(15, Math.min(22, Math.round(rowH / 5.6)));
  const tilt = (i: number, j: number) => ((i * 7 + j * 3) % 5) - 2;
  let bodyHtml = '';
  let bodyCss = '';

  if (layout === 'table') {
    const firstNote = cols.findIndex((c) => c.kind === 'note');
    const template = cols.map((c, j) => ({ stage: '196px', note: j === firstNote ? '178px' : '186px', chips: '1fr', text: '1fr' })[c.kind]).join(' ');
    const cell = (c: string | Chip[], j: number, i: number) => {
      const col = cols[j];
      if (col.kind === 'stage') return `<div class="cellwrap"><div class="stage anchor rk" data-row="${i}" data-fill="${T.pill}"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="st-label">${esc(c as string)}</span></div></div>`;
      if (col.kind === 'note') {
        const bg = col.tone ? TONES[col.tone] : T.notes[j === firstNote ? 0 : 1];
        return `<div class="note rk" data-fill="${bg}" style="background:${bg};--tilt:${tilt(i, j)}deg"><span>${esc(c as string)}</span></div>`;
      }
      if (col.kind === 'chips') return `<div class="chips zone rk" data-row="${i}">${(c as Chip[]).map((x) => chipHtml(x, i)).join('')}</div>`;
      return `<div class="txt"><span>${esc(c as string)}</span></div>`;
    };
    bodyHtml = `<div class="grid" id="grid">
${cols.map((c, j) => `<span class="lab${c.label.length > 15 ? ' long' : ''} lab-${c.kind === 'note' ? (j === firstNote ? 'note' : 'note2') : c.kind}">${esc(c.label)}</span>`).join('')}
${spec.rows!.map((r, i) => r.map((c, j) => cell(c, j, i)).join('')).join('\n')}
</div>`;
    bodyCss = `.grid{grid-template-columns:${template};column-gap:30px;row-gap:${gap}px;grid-template-rows:auto repeat(${n},1fr)}
.cellwrap{display:flex;align-items:center}
.stage{width:100%;min-height:58%;}`;
  } else if (layout === 'timeline') {
    const steps = spec.steps!;
    bodyHtml = `<div class="grid tl" id="grid">
${steps
  .map((s, i) => {
    const left = i % 2 === 0;
    const card = `<div class="card zone rk" data-row="${i}" style="grid-column:${left ? 1 : 3};grid-row:${i + 1}"><div class="ct"><span class="cn">${String(i + 1).padStart(2, '0')}</span><b>${esc(s.title)}</b></div>${s.text ? `<p>${esc(s.text)}</p>` : ''}${s.chips?.length ? `<div class="crow">${s.chips.map((c) => chipHtml(c, i)).join('')}</div>` : ''}</div>`;
    const node = `<div class="node-wrap" style="grid-column:2;grid-row:${i + 1}"><span class="node anchor" data-row="${i}">${i + 1}</span></div>`;
    const note = s.note ? `<div class="side" style="grid-column:${left ? 3 : 1};grid-row:${i + 1}"><div class="note rk" data-fill="${T.notes[i % 2]}" style="background:${T.notes[i % 2]};--tilt:${tilt(i, 1)}deg"><span>${esc(s.note)}</span></div></div>` : '';
    return card + node + note;
  })
  .join('\n')}
</div>`;
    bodyCss = `.grid.tl{grid-template-columns:1fr 76px 1fr;column-gap:22px;row-gap:${gap}px;grid-template-rows:repeat(${n},1fr);}
.node-wrap{display:flex;align-items:center;justify-content:center;position:relative;z-index:2}
.node{width:50px;height:50px;border-radius:50%;display:grid;place-items:center;background:${solidPill};color:${dark ? '#fff' : T.onPill === '#1f1b16' ? '#1f1b16' : '#fff'};font:700 18px/1 ${mono};border:3px solid ${T.ground};box-shadow:0 0 0 2px ${T.line}}
.side{display:flex;align-items:center;justify-content:center}.side .note{max-width:86%;font-size:calc((var(--fs) + 1) * 1px)}
.tl .card{align-self:center}`;
  } else if (layout === 'funnel') {
    const steps = spec.steps!;
    const shades = steps.map((_, i) => `color-mix(in srgb, ${pillAccent} ${Math.round(100 - (i * 55) / Math.max(1, steps.length - 1))}%, ${dark ? '#0b0d14' : '#ffffff'})`);
    bodyHtml = `<div class="grid fn" id="grid">
${steps
  .map((s, i) => {
    const inset = Math.round((i * 120) / Math.max(1, steps.length - 1));
    const lvl = `<div class="lvlwrap"><div class="lvl anchor" data-row="${i}" style="--in:${inset}px;background:${shades[i]};color:${i / steps.length < 0.5 ? onAccent : T.ink}">${s.metric ? `<span class="metric">${esc(s.metric)}</span>` : `<span class="metric">${String(i + 1).padStart(2, '0')}</span>`}<b>${esc(s.title)}</b></div></div>`;
    const det = `<div class="card zone rk" data-row="${i}">${s.note ? `<div class="q">“${esc(s.note.replace(/^[“"]|[”"]$/g, ''))}”</div>` : ''}${s.text ? `<p>${esc(s.text)}</p>` : ''}${s.chips?.length ? `<div class="crow">${s.chips.map((c) => chipHtml(c, i)).join('')}</div>` : ''}</div>`;
    return lvl + det;
  })
  .join('\n')}
</div>`;
    bodyCss = `.grid.fn{grid-template-columns:430px 1fr;column-gap:26px;row-gap:${gap}px;grid-template-rows:repeat(${n},1fr)}
.lvlwrap{display:flex;align-items:stretch}
.lvl{flex:1;margin:0 var(--in);clip-path:polygon(0 0,100% 0,calc(100% - 16px) 100%,16px 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;border-radius:6px;padding:6px 24px}
.lvl .metric{font:800 calc((var(--fs) + 12) * 1px)/1 ${stageFont};letter-spacing:-.03em}
.lvl b{font:700 calc((var(--fs) - 1) * 1px)/1.15 ${stageFont}}
.q{font:600 calc((var(--fs) - 1) * 1px)/1.25 ${noteFont};margin-bottom:4px}`;
  } else {
    const c = spec.compare!;
    const headIcon = (side: { name: string; icon?: string }) => (side.icon === 'brand' && logo ? `<i class="ico" style="background-image:url('${logo}')"></i>` : ico(side.icon ?? side.name));
    const mark = (win: boolean, both: boolean) => (win || both ? `<span class="mk yes">✓</span>` : `<span class="mk no">✕</span>`);
    bodyHtml = `<div class="grid cp" id="grid">
<span></span>
<div class="side-head rk" data-fill="${T.card}">${headIcon(c.left)}<b>${esc(c.left.name)}</b></div>
<div class="side-head win rk" data-fill="${T.card}">${headIcon(c.right)}<b>${esc(c.right.name)}</b></div>
${c.rows
  .map((r, i) => {
    const w = r.winner ?? 'right';
    return `<div class="cellwrap"><div class="stage anchor rk" data-row="${i}" data-fill="${T.pill}"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="st-label">${esc(r.label)}</span></div></div>
<div class="card cv ${w === 'left' || w === 'both' ? 'won' : 'lost'} rk" data-row="${i}">${mark(w === 'left', w === 'both')}<span>${esc(r.left)}</span></div>
<div class="card cv zone ${w === 'right' || w === 'both' ? 'won' : 'lost'} rk" data-row="${i}">${mark(w === 'right', w === 'both')}<span>${esc(r.right)}</span></div>`;
  })
  .join('\n')}
</div>`;
    bodyCss = `.grid.cp{grid-template-columns:212px 1fr 1fr;column-gap:18px;row-gap:${gap}px;grid-template-rows:auto repeat(${n},1fr)}
.side-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:14px;background:${T.card};border:1.5px solid ${T.line};font:800 26px/1 ${stageFont};letter-spacing:-.02em}
.side-head .ico,.side-head .mono-ic{width:34px;height:34px}
.side-head.win{border:2.5px solid ${accent}}
.cv{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:14px;font:500 calc((var(--fs) - 1) * 1px)/1.3 ${body}}
.cv.won{background:color-mix(in srgb, ${accent} ${dark ? 18 : 10}%, ${T.card.startsWith('#') ? T.card : 'transparent'})}
.cv.lost{opacity:.82}
.mk{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font:800 15px/1 ${body}}
.mk.yes{background:${accent};color:${onAccentBg}}.mk.no{background:${dark ? 'rgba(255,255,255,.12)' : 'rgba(20,26,18,.1)'};color:${T.ink}}`;
  }

  const beat = spec.beat ?? Math.max(1, Math.min(1.35, 10 / n));
  const intro = 0.9;
  const total = Math.round((intro + n * beat + 0.9) * 100) / 100;
  const cursorHome = { x: W - 200, y: Math.round(head * 0.42) };

  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
${look === 'sketch' ? '<script src="https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js"></script>' : ''}
<style>
${fonts.css}
${brandCss(brand)}
html,body{margin:0;background:${T.ground}}
#main{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${T.ground};color:${T.ink};font-family:${body};${T.bg}}
.top{position:absolute;left:${pad}px;right:${pad}px;top:36px;z-index:2}
.kicker{font:600 15px/1 ${mono};letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:10px;margin-bottom:14px}
.kicker i{width:8px;height:8px;border-radius:50%;background:${accent}}
h1{margin:0;font:800 ${titleSize}px/1.04 ${display};letter-spacing:-.045em;max-width:${W - 250}px}
h1 em{font-style:normal;position:relative;color:${accent};white-space:nowrap}
h1 em .hl{position:absolute;left:-4px;right:-4px;bottom:.06em;height:.34em;background:${accent};opacity:.2;border-radius:3px;transform-origin:0 50%}
h1 em span{position:relative}
.badge{position:absolute;right:0;top:-6px;font:600 14px/1 ${mono};letter-spacing:.16em;text-transform:uppercase;padding:11px 16px;border:1.5px solid ${T.line};border-radius:999px;background:${dark ? 'rgba(255,255,255,.06)' : T.ground}}
.grid{position:absolute;left:${pad}px;right:${pad}px;top:${Math.round(head)}px;bottom:${foot + 18}px;display:grid;--fs:${fs};z-index:1}
.lab{align-self:end;justify-self:start;white-space:nowrap;font:700 12.5px/1 ${mono};letter-spacing:.12em;text-transform:uppercase;padding:8px 11px;border-radius:5px;margin-bottom:8px}
.lab.long{font-size:11px;letter-spacing:.06em}
.lab-stage,.lab-text{background:${solidPill};color:${dark && look !== 'glass' ? '#121611' : '#fff'}}.lab-note{background:#f7cf5c;color:#2a2205}.lab-note2{background:#c8ec8c;color:#1d2a0c}.lab-chips{background:#1f4d35;color:#e9fff1}
.stage{position:relative;display:flex;align-items:center;gap:12px;background:${T.pill};color:${T.onPill};border-radius:13px;padding:10px 14px;box-shadow:0 3px 0 rgba(0,0,0,.2)}
.stage .num{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:${pillAccent};color:${onAccent};font:700 13px/1 ${mono}}
.stage .st-label{font:700 calc((var(--fs) + 1) * 1px)/1.12 ${stageFont};letter-spacing:-.01em}
.note,.txt{display:flex;align-items:center;padding:12px 16px;border-radius:4px;font:600 calc((var(--fs) - 1) * 1px)/1.28 ${noteFont};letter-spacing:-.005em;box-shadow:0 10px 18px -12px rgba(0,0,0,.35);transform:rotate(var(--tilt));color:#1d1f16}
.txt{background:transparent;box-shadow:none;transform:none;color:${T.ink};font-weight:500}
.chips{position:relative;display:flex;flex-wrap:wrap;align-content:center;gap:7px;padding:11px 12px;border-radius:14px;background:${T.card};border:1.5px solid ${T.line}}
.card{position:relative;padding:14px 16px;border-radius:14px;background:${T.card};border:1.5px solid ${T.line};display:flex;flex-direction:column;justify-content:center;gap:7px}
.card .ct{display:flex;align-items:center;gap:10px}.card .ct b{font:700 calc((var(--fs) + 2) * 1px)/1.1 ${stageFont};letter-spacing:-.015em}
.card .cn{font:700 13px/1 ${mono};color:${accent}}
.card p{margin:0;font:500 calc((var(--fs) - 2) * 1px)/1.32 ${body};opacity:.86}
.crow{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:7px;padding:5px 10px 5px 6px;border-radius:999px;border:1px solid ${T.line};font:600 max(12.5px, calc((var(--fs) - 5) * 1px))/1 ${body};white-space:nowrap;background:${dark ? 'rgba(255,255,255,.05)' : '#fff'};color:${T.ink};will-change:transform}
.ico,.mono-ic{display:inline-block;flex:none;width:max(17px, calc((var(--fs) - 1) * 1px));height:max(17px, calc((var(--fs) - 1) * 1px));background:center/contain no-repeat}
.mono-ic{display:grid;place-items:center;border-radius:50%;background:${accent};color:${onAccentBg};font:700 11px/1 ${body}}
.stack{display:inline-flex}.stack > *{margin-left:-5px;border-radius:50%;background-color:#fff;box-shadow:0 0 0 2px ${dark ? '#1b1f2a' : '#fff'}}.stack > :first-child{margin-left:0}
${iconCss}
${bodyCss}
.arr{position:absolute;color:${T.line};z-index:1}
.conn{position:absolute;z-index:0;overflow:visible}
.dot{position:absolute;left:0;top:0;width:14px;height:14px;border-radius:50%;background:${accent};box-shadow:0 0 0 5px color-mix(in srgb, ${accent} 25%, transparent);z-index:4;opacity:0}
.glow{position:absolute;left:0;top:0;border-radius:16px;border:2.5px solid ${accent};box-shadow:0 0 0 6px color-mix(in srgb, ${accent} 16%, transparent);pointer-events:none;z-index:3;opacity:0}
.sglow{position:absolute;left:0;top:0;border-radius:15px;box-shadow:0 0 0 3px ${accent},0 0 24px color-mix(in srgb, ${accent} 45%, transparent);pointer-events:none;z-index:3;opacity:0}
.cring{position:absolute;left:0;top:0;border-radius:999px;border:2.5px solid ${accent};background:color-mix(in srgb, ${accent} 10%, transparent);pointer-events:none;z-index:4;opacity:0}
.ripple{position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid ${accent};z-index:5;opacity:0;pointer-events:none}
.cursor{position:absolute;left:0;top:0;z-index:6;display:flex;align-items:flex-start;gap:2px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.28))}
.cursor .tag{margin-top:18px;background:${accent};color:${onAccentBg};font:700 13px/1 ${body};padding:6px 9px;border-radius:7px}
.foot{position:absolute;left:${pad}px;right:${pad}px;bottom:26px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${T.line};padding-top:18px;z-index:2}
.who{display:flex;align-items:center;gap:14px}
.av{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:${solidPill};color:${dark ? '#fff' : look === 'paper' ? '#1f1b16' : '#fff'};font:800 18px/1 ${stageFont};overflow:hidden;box-shadow:0 0 0 2px ${T.ground},0 0 0 4px ${accent}}
.av img{width:100%;height:100%;object-fit:cover}
.who b{display:block;font:700 22px/1.1 ${stageFont};letter-spacing:-.01em}
.who small{display:block;font:500 15px/1.3 ${mono};opacity:.75}
.brandmark{font:800 24px/1 ${stageFont};letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.brandmark img{height:34px;max-width:46px;object-fit:contain}
#rough{position:absolute;inset:0;z-index:0;pointer-events:none}
${dark ? '.chip .ico,.side-head .ico{background-color:#fff;border-radius:50%;box-shadow:0 0 0 2px #fff;background-size:78%}' : ''}
${T.css}
</style></head><body>
<div id="main" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
${look === 'sketch' ? `<svg id="rough" width="${W}" height="${H}"></svg>` : ''}
<div class="top">
  ${spec.kicker ? `<div class="kicker"><i></i>${esc(spec.kicker)}</div>` : ''}
  <h1>${title}</h1>
  ${spec.badge ? `<span class="badge">${esc(spec.badge)}</span>` : ''}
</div>
${bodyHtml}
<div class="dot" id="dot"></div>
<div class="glow" id="glow"></div>
<div class="sglow" id="sglow"></div>
<div class="cring" id="cring"></div>
<div class="ripple" id="ripple"></div>
${spec.cursor ? `<div class="cursor" id="cur"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.5 19z" fill="${accent}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="tag">${esc(spec.cursor)}</span></div>` : ''}
<div class="foot">
  <div class="who"><span class="av">${avatar ? `<img src="${avatar}" alt="">` : initials}</span><div><b>${esc(who)}</b><small>${esc(handle)}</small></div></div>
  <span class="brandmark">${logo ? `<img src="${logo}" alt="">` : ''}${esc(footer.brand ?? brand.name)}</span>
</div>
</div>
<script>(()=>{
const tl=gsap.timeline({paused:true});
const main=document.getElementById("main"), M=main.getBoundingClientRect();
const rel=(el)=>{const r=el.getBoundingClientRect();return {x:r.left-M.left,y:r.top-M.top,w:r.width,h:r.height};};
const grid=document.getElementById("grid");
// Start the body right under the real title block (one or two lines).
const topEl=main.querySelector('.top'); const tb=rel(topEl); grid.style.top=Math.round(tb.y+tb.h+${layout === 'table' || layout === 'compare' ? 22 : 34})+'px';
// Fit: shrink type until every row fits (layout boxes, so tilted notes don't count).
const bottom=()=>Math.max(...[...grid.children].map(c=>c.offsetTop+c.offsetHeight));
for(let f=${fs};f>13&&bottom()>grid.clientHeight+1;f-=.5) grid.style.setProperty('--fs',f);
main.querySelectorAll('.arr,.conn').forEach(x=>x.remove()); // the script can run more than once
const NS='http://www.w3.org/2000/svg';
const arrow=(x,y,rot)=>{const a=document.createElementNS(NS,'svg');a.setAttribute('class','arr');a.setAttribute('viewBox','0 0 24 24');a.setAttribute('width','18');a.setAttribute('height','18');a.innerHTML='<path d="M4 12h15M14 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';a.style.left=(x-9)+'px';a.style.top=(y-9)+'px';a.style.transform='rotate('+rot+'deg)';main.appendChild(a);};
const layout=${JSON.stringify(layout)}, n=${n};
const rowsOf=(sel)=>Array.from({length:n},(_,i)=>[...grid.querySelectorAll(sel+'[data-row="'+i+'"]')]);
const anchors=rowsOf('.anchor').map(a=>a[0]);
const zones=rowsOf('.zone').map(a=>a[0]||null);
const chips=rowsOf('.chip');
const A=anchors.map(rel);
// Connectors: arrows across table columns, down-arrows between stages, the timeline spine.
if(layout==='table'){
  const nc=${cols.length}; const cells=[...grid.children].filter(c=>!c.classList.contains('lab'));
  for(let i=0;i<cells.length;i++){ if(i%nc===nc-1) continue; const a=rel(cells[i].firstElementChild&&cells[i].classList.contains('cellwrap')?cells[i].firstElementChild:cells[i]), b=rel(cells[i+1]); arrow(a.x+a.w+(b.x-a.x-a.w)/2, a.y+a.h/2, 0); }
}
if(layout==='table'||layout==='compare'){
  for(let i=0;i<n-1;i++){ const a=A[i], b=A[i+1], x=a.x+a.w/2; if(b.y-(a.y+a.h)<14) continue;
    const s=document.createElementNS(NS,'svg'); s.setAttribute('class','conn'); s.style.left=(x-9)+'px'; s.style.top=(a.y+a.h)+'px'; s.setAttribute('width','18'); s.setAttribute('height',String(b.y-a.y-a.h));
    const h=b.y-a.y-a.h; s.innerHTML='<path d="M9 2V'+(h-3)+'M4 '+(h-8)+'l5 5 5-5" fill="none" stroke="${T.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'; main.appendChild(s); }
}
if(layout==='timeline'){
  const x=A[0].x+A[0].w/2, y0=A[0].y+A[0].h/2, y1=A[n-1].y+A[n-1].h/2;
  const s=document.createElementNS(NS,'svg'); s.setAttribute('class','conn'); s.style.left=(x-3)+'px'; s.style.top=y0+'px'; s.setAttribute('width','6'); s.setAttribute('height',String(y1-y0));
  s.innerHTML='<line x1="3" y1="0" x2="3" y2="'+(y1-y0)+'" stroke="${T.line}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>'; main.appendChild(s);
}
${
  look === 'sketch'
    ? `// Hand-drawn shapes (seeded, so every render is identical).
const svg=document.getElementById('rough'); svg.innerHTML=''; const rc=rough.svg(svg); let seed=7;
main.querySelectorAll('.rk').forEach(el=>{ const r=rel(el); const fill=el.dataset.fill; const isStage=el.classList.contains('stage');
  svg.appendChild(rc.rectangle(r.x+2,r.y+2,r.w-4,r.h-4,{seed:seed++,roughness:1.6,bowing:1.4,stroke:'${T.ink}',strokeWidth:isStage?1.6:1.8,fill:fill&&fill!=='transparent'?fill:undefined,fillStyle:(isStage||el.classList.contains('note'))?'solid':'hachure',hachureGap:isStage?4:7,fillWeight:1.2}));
});`
    : ''
}
const dot=document.getElementById("dot"), glow=document.getElementById("glow"), sglow=document.getElementById("sglow"), cring=document.getElementById("cring"), ripple=document.getElementById("ripple"), cur=document.getElementById("cur");
tl.fromTo("h1 em .hl",{scaleX:0},{scaleX:1,duration:.7,ease:"power3.inOut"},.15);
// The dot rides the left gutter beside each step (never over a number); the timeline uses its node ring instead.
const dotAt=(i)=>({x:A[i].x-(layout==='funnel'?6:22)-7,y:A[i].y+A[i].h/2-7});
if(layout==='timeline') dot.style.display='none';
tl.set(dot,{...dotAt(0),opacity:0},0);
tl.set([glow,sglow,cring,ripple],{opacity:0},0);
if(cur) tl.set(cur,{x:${cursorHome.x},y:${cursorHome.y}},0);
const beat=${beat}, t0=${intro};
for(let i=0;i<n;i++){
  const t=t0+i*beat, a=A[i], zEl=zones[i], z=zEl?rel(zEl):a, d=i?beat*.42:.3;
  tl.to(dot,{...dotAt(i),opacity:1,duration:d,ease:"power2.inOut"},t);
  tl.to(sglow,{x:a.x-3,y:a.y-3,width:a.w+6,height:a.h+6,opacity:1,duration:i?d:.01,ease:"power2.inOut"},t);
  if(zEl) tl.to(glow,{x:z.x-6,y:z.y-6,width:z.w+12,height:z.h+12,opacity:1,duration:i?d:.01,ease:"power2.inOut"},t);
  // Click the platform people reach for at this step (two of them on wide rows).
  const cs=chips[i]; const picks=cs.length?[cs[(i*3)%cs.length]].concat(cs.length>4?[cs[(i*3+2)%cs.length]]:[]):[];
  picks.forEach((c,k)=>{ const r=rel(c), tc=t+beat*(.34+k*.3);
    tl.to(cring,{x:r.x-4,y:r.y-4,width:r.w+8,height:r.h+8,opacity:1,duration:.22,ease:"power2.out"},tc);
    if(cur) tl.to(cur,{x:r.x+r.w*.55,y:r.y+r.h*.45,duration:.28,ease:"power2.inOut"},tc-.12);
    tl.fromTo(c,{scale:1},{scale:1.09,duration:.14,yoyo:true,repeat:1,ease:"power1.inOut"},tc+.16);
    tl.fromTo(ripple,{x:r.x+r.w*.55,y:r.y+r.h*.45,scale:.3,opacity:.9},{scale:1.6,opacity:0,duration:.4,ease:"power2.out"},tc+.16);
  });
  if(!picks.length && cur) tl.to(cur,{x:z.x+z.w*.6,y:z.y+z.h*.55,duration:beat*.5,ease:"power2.inOut"},t);
  tl.to(cring,{opacity:0,duration:.15},t+beat*.92);
}
const tEnd=t0+n*beat;
tl.to([glow,sglow,dot,cring],{opacity:0,duration:.4,ease:"power1.out"},tEnd);
if(cur) tl.to(cur,{x:${cursorHome.x},y:${cursorHome.y},duration:.7,ease:"power2.inOut"},tEnd);
tl.set(dot,dotAt(0),${total} - .05);
(window.__timelines=window.__timelines||{})["main"]=tl;
})();</script>
</body></html>`;
  await writeFile(join(o.dir, 'index.html'), html);
  await writeFile(join(o.dir, 'hyperframes.json'), JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true }, registryItems: [] }, null, 2));
  await writeFile(join(o.dir, 'meta.json'), JSON.stringify({ id: 'infographic', name: 'infographic', createdAt: new Date().toISOString() }));
  return { width: W, height: H, duration: total };
}
