import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brandCss, contrastRatio, ensureContrast, loadBrand, localizeFonts, normalizeBrand, resolveIcons, type BrandKit } from '@shipcast/engine';
import { esc } from './scenes.ts';

/**
 * Animated framework infographic — the save-worthy LinkedIn format: a dense,
 * well-designed table of stages (dark numbered pills), thoughts (sticky
 * notes), places (logo chips) and actions (notes) on a dotted board, with a
 * subtle seamless loop: a dot travels the stage line, each row lights up in
 * turn, and a named collaborator cursor follows along.
 */

export type ColumnKind = 'stage' | 'note' | 'chips' | 'text';

export interface InfographicSpec {
  kicker?: string;
  /** `*phrase*` gets the highlighter. */
  title: string;
  badge?: string;
  cursor?: string;
  theme?: 'board' | 'night';
  columns: { label: string; kind: ColumnKind; tone?: 'yellow' | 'green' | 'blue' | 'pink' }[];
  /** One entry per row; each cell matches its column (chips cells are arrays of names). */
  rows: (string | string[])[][];
  footer?: { name?: string; handle?: string; brand?: string };
  /** Canvas: 1080x1350 (default) or 1080x1080. */
  size?: '1080x1350' | '1080x1080';
  /** Seconds each row stays lit in the loop. */
  beat?: number;
}

export function validateInfographic(s: InfographicSpec): string[] {
  const e: string[] = [];
  if (!s?.title?.trim()) e.push('title is required');
  if (!Array.isArray(s?.columns) || s.columns.length < 2 || s.columns.length > 4) e.push('columns must have 2–4 entries');
  if (!Array.isArray(s?.rows) || s.rows.length < 3 || s.rows.length > 9) e.push('rows must have 3–9 entries');
  (s?.rows ?? []).forEach((r, i) => {
    if (!Array.isArray(r) || r.length !== (s.columns?.length ?? 0)) e.push(`row ${i + 1} must have ${s.columns?.length} cells`);
    r?.forEach((c, j) => {
      const kind = s.columns?.[j]?.kind;
      if (kind === 'chips' && !Array.isArray(c)) e.push(`row ${i + 1}, column ${j + 1} must be a list of platform names`);
      if (kind === 'chips' && Array.isArray(c) && c.length > 6) e.push(`row ${i + 1}, column ${j + 1}: at most 6 chips`);
      if (kind !== 'chips' && typeof c === 'string' && c.length > 110) e.push(`row ${i + 1}, column ${j + 1} is ${c.length} chars (max 110)`);
    });
  });
  return e;
}

const TONES = { yellow: '#fbe39b', green: '#e2f4c5', blue: '#d8e8ff', pink: '#ffdcea' };

export async function compileInfographic(spec: InfographicSpec, o: { dir: string; brandDir?: string; brand?: Partial<BrandKit> }) {
  const errs = validateInfographic(spec);
  if (errs.length) throw new Error(`infographic is invalid:\n- ${errs.join('\n- ')}`);
  const [W, H] = (spec.size ?? '1080x1350').split('x').map(Number);
  const brand = o.brandDir ? await loadBrand(o.brandDir) : normalizeBrand(o.brand);
  const night = spec.theme === 'night';
  const ground = night ? '#101310' : '#f3f2ec';
  const ink = night ? '#eef1ea' : '#121411';
  const pill = night ? '#eef1ea' : '#141a12';
  const onPill = night ? '#141a12' : '#ffffff';
  // Accent = the brand's primary, pushed until it reads on the board; badge fill must contrast with pill text.
  const accent = ensureContrast(brand.colors.primary, ground, 3.2);
  const pillAccent = contrastRatio(brand.colors.primary, pill) >= 3 ? brand.colors.primary : ensureContrast(brand.colors.primary, pill, 3.2);

  await mkdir(join(o.dir, 'assets'), { recursive: true });
  const fonts = await localizeFonts([brand.fonts.display, brand.fonts.body, 'JetBrains Mono'], join(o.dir, 'assets', 'fonts'), 'assets/fonts');
  const fam = (f: string, fb: string) => (fonts.families.includes(f) ? `'${f}',${fb}` : fb);
  const display = fam(brand.fonts.display, 'system-ui,sans-serif');
  const body = fam(brand.fonts.body, 'system-ui,sans-serif');
  const mono = fam('JetBrains Mono', 'ui-monospace,monospace');

  const chipNames = spec.rows.flatMap((r) => r.flatMap((c, j) => (spec.columns[j].kind === 'chips' && Array.isArray(c) ? c : [])));
  const icons = await resolveIcons(chipNames);

  const n = spec.rows.length;
  const cols = spec.columns;
  // Two-line titles get a taller header so the table never crowds them.
  const titleLen = spec.title.replace(/\*/g, '').length;
  const twoLines = titleLen > (W >= H ? 30 : 27);
  const head = (W >= H ? 168 : 190) + (twoLines ? 64 : 0) + (spec.kicker ? 0 : -24);
  const foot = 96;
  const pad = 40;
  const gap = Math.round(Math.max(10, 18 - n));
  const rowH = (H - head - foot - 60 - gap * (n - 1)) / n;
  const fs = Math.max(15, Math.min(23, Math.round(rowH / 5.3)));
  const colTemplate = cols.map((c) => ({ stage: '190px', note: c === cols.find((x) => x.kind === 'note') ? '186px' : '196px', chips: '1fr', text: '1fr' })[c.kind]).join(' ');

  // One CSS class per logo, so each data URI appears once in the page.
  const iconIds = new Map(Object.keys(icons).filter((k) => icons[k]).map((k, i) => [k, `ic${i}`]));
  const iconCss = [...iconIds].map(([k, id]) => `.${id}{background-image:url("${icons[k]}")}`).join('\n');
  const monogram = (name: string) => `<b class="mono-ic">${esc(name.trim()[0]?.toUpperCase() ?? '•')}</b>`;
  const cell = (c: string | string[], j: number, i: number) => {
    const col = cols[j];
    if (col.kind === 'stage')
      return `<div class="stage" data-row="${i}"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="st-label">${esc(c)}</span></div>`;
    if (col.kind === 'note') return `<div class="note" style="background:${TONES[col.tone ?? (j === cols.length - 1 ? 'green' : 'yellow')]};--tilt:${((i * 7 + j * 3) % 5) - 2}deg"><span>${esc(c)}</span></div>`;
    if (col.kind === 'chips')
      return `<div class="chips" data-row="${i}">${(Array.isArray(c) ? c : [c])
        .map((name) => `<span class="chip">${iconIds.has(name) ? `<i class="ico ${iconIds.get(name)}"></i>` : monogram(name)}${esc(name)}</span>`)
        .join('')}</div>`;
    return `<div class="txt"><span>${esc(c)}</span></div>`;
  };
  const title = esc(spec.title).replace(/\*([^*]+)\*/g, '<em><i class="hl"></i><span>$1</span></em>');
  const footer = spec.footer ?? {};
  const initials = (footer.name ?? brand.name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const beat = spec.beat ?? Math.max(0.9, Math.min(1.25, 9 / n));
  const intro = 0.9;
  const total = Math.round((intro + n * beat + 0.8) * 100) / 100;

  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
${fonts.css}
${brandCss(brand)}
html,body{margin:0;background:${ground}}
#main{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${ground};color:${ink};font-family:${body};
  background-image:radial-gradient(${night ? 'rgba(255,255,255,.07)' : 'rgba(20,26,18,.13)'} 1.3px,transparent 1.4px);background-size:22px 22px;background-position:11px 11px}
.top{position:absolute;left:${pad}px;right:${pad}px;top:34px}
.kicker{font:600 15px/1 ${mono};letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:10px}
.kicker i{width:8px;height:8px;border-radius:50%;background:${accent}}
h1{margin:16px 0 0;font:800 ${W >= H ? 56 : 64}px/1.02 ${display};letter-spacing:-.045em;max-width:${W - 250}px}
h1 em{font-style:normal;position:relative;color:${accent};white-space:nowrap}
h1 em .hl{position:absolute;left:-4px;right:-4px;bottom:.06em;height:.34em;background:${accent};opacity:.18;border-radius:3px;transform-origin:0 50%}
h1 em span{position:relative}
.badge{position:absolute;right:0;top:-4px;font:600 14px/1 ${mono};letter-spacing:.16em;text-transform:uppercase;padding:11px 16px;border:1.5px solid ${night ? 'rgba(255,255,255,.25)' : 'rgba(20,26,18,.22)'};border-radius:999px;background:${ground}}
.grid{position:absolute;left:${pad}px;right:${pad}px;top:${head}px;bottom:${foot + 14}px;display:grid;grid-template-columns:${colTemplate};column-gap:34px;row-gap:${gap}px;grid-template-rows:auto repeat(${n},1fr);--fs:${fs}}
.lab{align-self:end;justify-self:start;font:700 12.5px/1 ${mono};letter-spacing:.12em;text-transform:uppercase;padding:8px 11px;border-radius:5px;margin-bottom:6px}
.lab-stage{background:${pill};color:${onPill}}.lab-note{background:#f7cf5c;color:#2a2205}.lab-note2{background:#c8ec8c;color:#1d2a0c}.lab-chips{background:#1f4d35;color:#e9fff1}.lab-text{background:${pill};color:${onPill}}
.stage{position:relative;display:flex;align-items:center;gap:12px;background:${pill};color:${onPill};border-radius:12px;padding:0 16px;box-shadow:0 3px 0 rgba(0,0,0,.18);transition:none}
.stage .num{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:${pillAccent};color:${contrastRatio(pillAccent, '#000') > contrastRatio(pillAccent, '#fff') ? '#111' : '#fff'};font:700 13px/1 ${mono}}
.stage .st-label{font:700 calc((var(--fs) + 1) * 1px)/1.12 ${display};letter-spacing:-.01em}
.note,.txt{display:flex;align-items:center;padding:12px 16px;border-radius:4px;font:600 calc((var(--fs) - 1) * 1px)/1.28 ${body};letter-spacing:-.005em;box-shadow:0 10px 18px -12px rgba(0,0,0,.35);transform:rotate(var(--tilt));color:#1d1f16}
.txt{background:transparent;box-shadow:none;transform:none;color:${ink};font-weight:500}
.chips{position:relative;display:flex;flex-wrap:wrap;align-content:center;gap:8px;padding:12px;border-radius:14px;background:${night ? '#171b16' : '#fff'};border:1.5px solid ${night ? 'rgba(255,255,255,.12)' : 'rgba(20,26,18,.14)'}}
.chip{display:inline-flex;align-items:center;gap:8px;padding:6px 11px 6px 8px;border-radius:999px;border:1px solid ${night ? 'rgba(255,255,255,.14)' : 'rgba(20,26,18,.12)'};font:600 max(13px, calc((var(--fs) - 4) * 1px))/1 ${body};white-space:nowrap;background:${night ? '#1d221c' : '#fff'}}
.ico{display:inline-block;flex:none;width:max(16px, calc((var(--fs) - 2) * 1px));height:max(16px, calc((var(--fs) - 2) * 1px));background:center/contain no-repeat}
${iconCss}
.mono-ic{display:grid;place-items:center;width:max(16px, calc((var(--fs) - 2) * 1px));height:max(16px, calc((var(--fs) - 2) * 1px));border-radius:50%;background:${accent};color:#fff;font:700 11px/1 ${body}}
.arr{position:absolute;color:${night ? 'rgba(255,255,255,.4)' : 'rgba(20,26,18,.45)'}}
.line{position:absolute;left:${pad + 95}px;width:2px;background:${night ? 'rgba(255,255,255,.18)' : 'rgba(20,26,18,.22)'}}
.dot{position:absolute;left:${pad + 89}px;width:14px;height:14px;border-radius:50%;background:${accent};box-shadow:0 0 0 5px color-mix(in srgb, ${accent} 25%, transparent);z-index:3}
.glow{position:absolute;left:0;top:0;border-radius:16px;border:2.5px solid ${accent};box-shadow:0 0 0 6px color-mix(in srgb, ${accent} 16%, transparent);pointer-events:none;z-index:2;opacity:0}
.sglow{position:absolute;left:0;top:0;border-radius:14px;box-shadow:0 0 0 3px ${accent};pointer-events:none;z-index:2;opacity:0}
.cursor{position:absolute;left:0;top:0;z-index:5;display:flex;align-items:flex-start;gap:2px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.25))}
.cursor .tag{margin-top:18px;background:${accent};color:#fff;font:700 13px/1 ${body};padding:6px 9px;border-radius:7px}
.foot{position:absolute;left:${pad}px;right:${pad}px;bottom:28px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${night ? 'rgba(255,255,255,.12)' : 'rgba(20,26,18,.12)'};padding-top:18px}
.who{display:flex;align-items:center;gap:14px}
.av{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:${pill};color:${onPill};font:800 18px/1 ${display};overflow:hidden;border:2px solid ${pill}}
.av img{width:100%;height:100%;object-fit:contain;background:#fff}
.who b{display:block;font:700 22px/1.1 ${display};letter-spacing:-.01em}
.who small{display:block;font:500 15px/1.3 ${mono};opacity:.75}
.brandmark{font:800 24px/1 ${display};letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.brandmark img{height:30px;max-width:150px;object-fit:contain}
</style></head><body>
<div id="main" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
<div class="top">
  ${spec.kicker ? `<div class="kicker"><i></i>${esc(spec.kicker)}</div>` : ''}
  <h1>${title}</h1>
  ${spec.badge ? `<span class="badge">${esc(spec.badge)}</span>` : ''}
</div>
<div class="grid" id="grid">
  ${cols.map((c, j) => `<span class="lab lab-${c.kind === 'note' && j === cols.length - 1 ? 'note2' : c.kind}">${esc(c.label)}</span>`).join('')}
  ${spec.rows.map((r, i) => r.map((c, j) => cell(c, j, i)).join('')).join('\n')}
</div>
<div class="line" id="line"></div>
<div class="dot" id="dot"></div>
<div class="glow" id="glow"></div>
<div class="sglow" id="sglow"></div>
${spec.cursor ? `<div class="cursor" id="cur"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.5 19z" fill="${accent}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="tag">${esc(spec.cursor)}</span></div>` : ''}
<div class="foot">
  <div class="who"><span class="av">${initials}</span><div><b>${esc(footer.name ?? brand.name)}</b><small>${esc(footer.handle ?? (brand.url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</small></div></div>
  <span class="brandmark">${esc(footer.brand ?? brand.name)}</span>
</div>
</div>
<script>(()=>{
const tl=gsap.timeline({paused:true});
const main=document.getElementById("main"), M=main.getBoundingClientRect();
const rel=(el)=>{const r=el.getBoundingClientRect();return {x:r.left-M.left,y:r.top-M.top,w:r.width,h:r.height};};
const grid=document.getElementById("grid");
// Fit: long copy can make rows taller than their share; shrink the type until the grid fits.
// Layout boxes only (offsetTop/Height ignore the notes' tilt, which scrollHeight would count).
const bottom=()=>Math.max(...[...grid.children].map(c=>c.offsetTop+c.offsetHeight));
for(let f=${fs};f>14&&bottom()>grid.clientHeight+1;f-=.5) grid.style.setProperty('--fs',f);
main.querySelectorAll('.arr').forEach(x=>x.remove()); // the script can run more than once
// Arrows between columns, a connector line down the stage column.
const rows=[...grid.querySelectorAll('.stage')].map(s=>rel(s));
const cells=[...grid.children].filter(c=>!c.classList.contains('lab'));
const nc=${cols.length};
for(let i=0;i<cells.length;i++){ if(i%nc===nc-1) continue; const a=rel(cells[i]), b=rel(cells[i+1]); const ar=document.createElementNS('http://www.w3.org/2000/svg','svg'); ar.setAttribute('class','arr'); ar.setAttribute('viewBox','0 0 24 24'); ar.setAttribute('width','18'); ar.setAttribute('height','18'); ar.innerHTML='<path d="M4 12h15M14 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  ar.style.left=(a.x+a.w+(b.x-a.x-a.w)/2-9)+'px'; ar.style.top=(a.y+a.h/2-9)+'px'; main.appendChild(ar); }
const line=document.getElementById("line"), dot=document.getElementById("dot");
const stageX=rows[0].x+24; line.style.left=stageX+'px'; dot.style.left=(stageX-6)+'px';
line.style.top=(rows[0].y+rows[0].h)+'px'; line.style.height=(rows[rows.length-1].y-rows[0].y-rows[0].h)+'px';
const chips=[...grid.querySelectorAll('.chips')].map(c=>rel(c));
const glow=document.getElementById("glow"), sglow=document.getElementById("sglow"), cur=document.getElementById("cur");
// Intro: highlighter sweep on the title.
tl.fromTo("h1 em .hl",{scaleX:0},{scaleX:1,duration:.7,ease:"power3.inOut"},.15);
tl.set(dot,{y:rows[0].y+rows[0].h/2-7,opacity:0},0);
tl.set([glow,sglow],{opacity:0},0);
${spec.cursor ? `tl.set(cur,{x:${W - 210},y:${Math.round(head * 0.45)}},0);` : ''}
const beat=${beat}, t0=${intro};
rows.forEach((r,i)=>{
  const t=t0+i*beat, c=chips[i]||r;
  tl.to(dot,{y:r.y+r.h/2-7,opacity:1,duration:i?beat*.45:.3,ease:"power2.inOut"},t);
  tl.to(sglow,{x:r.x,y:r.y,width:r.w,height:r.h,opacity:1,duration:i?beat*.45:.01,ease:"power2.inOut"},t);
  tl.to(glow,{x:c.x-6,y:c.y-6,width:c.w+12,height:c.h+12,opacity:1,duration:i?beat*.45:.01,ease:"power2.inOut"},t);
  ${spec.cursor ? 'tl.to(cur,{x:c.x+c.w*0.62,y:c.y+c.h*0.55,duration:beat*.55,ease:"power2.inOut"},t);' : ''}
});
// Outro returns everything to the start state so the loop is seamless.
const tEnd=t0+rows.length*beat;
tl.to([glow,sglow,dot],{opacity:0,duration:.4,ease:"power1.out"},tEnd);
${spec.cursor ? `tl.to(cur,{x:${W - 210},y:${Math.round(head * 0.45)},duration:.7,ease:"power2.inOut"},tEnd);` : ''}
tl.set(dot,{y:rows[0].y+rows[0].h/2-7},${total - 0.05});
window.__timelines["main"]=tl;
})();</script>
</body></html>`;
  await writeFile(join(o.dir, 'index.html'), html);
  await writeFile(join(o.dir, 'hyperframes.json'), JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true }, registryItems: [] }, null, 2));
  await writeFile(join(o.dir, 'meta.json'), JSON.stringify({ id: 'infographic', name: 'infographic', createdAt: new Date().toISOString() }));
  return { width: W, height: H, duration: total };
}
