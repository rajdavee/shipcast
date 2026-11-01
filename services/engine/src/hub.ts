import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { run } from './exec.ts';
import { getPack } from './packs.ts';
import { campaignDir } from './paths.ts';
import type { Campaign } from './types.ts';

type Kind = 'video' | 'carousel' | 'image' | 'copy' | 'product';
interface HubItem {
  kind: Kind;
  title: string;
  pack: string;
  angle?: string;
  files: { path: string; type: 'video' | 'image' | 'pdf' | 'text' | 'file' }[];
  posters: Record<string, string>;
  text?: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'asset';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function walk(d: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
    // Render internals (projects, per-chapter cuts, copied assets) are not deliverables.
    if (e.name.startsWith('.') || (e.isDirectory() && ['work', 'node_modules', 'project', 'chapters', 'assets', 'preview'].includes(e.name))) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function kindFor(pack: string, category: string | undefined, files: string[]): Kind {
  if (pack === 'app-capture') return 'product';
  if (pack === 'carousel' || files.some((f) => f.endsWith('carousel.pdf'))) return 'carousel';
  if (files.some((f) => /\.(mp4|mov|webm)$/i.test(f))) return 'video';
  if (category === 'copy' || files.every((f) => /\.(md|json|txt)$/i.test(f))) return 'copy';
  return 'image';
}

/** Tiny markdown → HTML for captions and the calendar (headings, tables, paragraphs, lists). */
function md(s: string): string {
  const lines = s.replace(/\r/g, '').split('\n');
  const html: string[] = [];
  let i = 0;
  const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const row = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(row(lines[i++]));
      html.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) html.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    else if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      html.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    } else if (l.trim()) {
      const para: string[] = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !/^(#|\s*\||\s*[-*]\s)/.test(lines[i])) para.push(lines[i++]);
      html.push(`<p>${para.map(inline).join('<br>')}</p>`);
      continue;
    }
    i++;
  }
  return html.join('\n');
}

/**
 * Gather every finished deliverable into one folder a team can open, review
 * and post from: videos, carousels, posts, captions, the calendar and an
 * index.html that plays everything offline. Also writes a zip next to it.
 */
export async function buildHub(c: Campaign, outDir: string): Promise<{ items: number; files: number; zip?: string; folder: string }> {
  const dir = campaignDir(c.id);
  const name = c.name || 'Campaign';
  const folder = join(outDir, `${slug(name)}-campaign`);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  let brand: any = {};
  try {
    brand = JSON.parse(await readFile(join(dir, 'brief', 'brand.json'), 'utf8'));
  } catch {}
  const plan = c.steps.find((s) => s.pack === 'campaign-plan' && s.status === 'done');
  let line = '';
  let calendar = '';
  if (plan) {
    const pd = join(dir, 'deliverables', plan.id, 'out');
    try {
      line = String(JSON.parse(await readFile(join(pd, 'plan.json'), 'utf8')).line ?? '');
    } catch {}
    calendar = await readFile(join(pd, 'calendar.md'), 'utf8').catch(() => '');
    for (const f of ['CAMPAIGN-BRIEF.md', 'calendar.md']) if (existsSync(join(pd, f))) await cp(join(pd, f), join(folder, f));
  }

  const items: HubItem[] = [];
  let n = 0;
  let fileCount = 0;
  for (const s of c.steps) {
    if (s.kind !== 'pack' || s.status !== 'done' || !s.pack || ['app-run', 'campaign-plan', 'campaign-hub'].includes(s.pack)) continue;
    const pack = await getPack(s.pack);
    const src = join(dir, 'deliverables', s.id, 'out');
    const all = (await walk(src)).map((f) => relative(src, f));
    const kind = kindFor(s.pack, pack?.category, all);
    const keep = all.filter((f) => {
      const b = basename(f);
      if (b === 'NOTES.md' || b === 'catalog.md' || b === 'qa.json' || /\.sheet\.jpg$/.test(b) || /\.html$/.test(b)) return false;
      if (kind === 'product') return /\.(png|jpe?g|mp4|webm)$/i.test(f);
      if (kind === 'carousel') return /\.(pdf|mp4|md)$/i.test(f) || /^slides\/.*\.png$/.test(f);
      if (kind === 'video') {
        // Videos: the films, their posters, subtitles and copy — not the screenshots used inside.
        if (/\.(png|jpe?g)$/i.test(f)) return all.some((v) => /\.(mp4|webm|mov)$/i.test(v) && v.replace(/\.[^.]+$/, '') === f.replace(/\.[^.]+$/, ''));
        return /\.(mp4|webm|mov|md|txt|srt|vtt)$/i.test(f);
      }
      return /\.(png|jpe?g|pdf|md|txt)$/i.test(f);
    });
    if (!keep.length) continue;
    const title = s.options._title || pack?.name || s.pack;
    const id = `${String(++n).padStart(2, '0')}-${slug(title)}`;
    const sub = { video: 'videos', carousel: 'carousels', image: 'posts', copy: 'copy', product: 'product-ui' }[kind];
    const item: HubItem = { kind, title, pack: pack?.name ?? s.pack, angle: s.options._angle, files: [], posters: {} };
    const texts: string[] = [];
    for (const f of keep) {
      const dest = join(sub, id, f);
      await mkdir(join(folder, dest, '..'), { recursive: true });
      await cp(join(src, f), join(folder, dest));
      fileCount++;
      const ext = extname(f).toLowerCase();
      if (ext === '.md' || ext === '.txt') {
        texts.push(await readFile(join(src, f), 'utf8'));
        item.files.push({ path: dest, type: 'text' });
      } else if (ext === '.pdf') item.files.push({ path: dest, type: 'pdf' });
      else if (ext === '.srt' || ext === '.vtt') item.files.push({ path: dest, type: 'file' });
      else if (['.mp4', '.webm', '.mov'].includes(ext)) item.files.push({ path: dest, type: 'video' });
      else if (!/\/slides\//.test(dest) || kind === 'carousel') item.files.push({ path: dest, type: 'image' });
    }
    // A video's poster is the image with the same base name.
    for (const v of item.files.filter((x) => x.type === 'video')) {
      const base = v.path.replace(/\.[^.]+$/, '');
      const p = item.files.find((x) => x.type === 'image' && x.path.replace(/\.[^.]+$/, '') === base);
      if (p) {
        item.posters[v.path] = p.path;
        item.files = item.files.filter((x) => x !== p);
      }
    }
    item.text = texts.join('\n\n');
    items.push(item);
  }

  const primary = brand.colors?.primary ?? '#6965db';
  const card = (it: HubItem) => {
    const media = it.files
      .filter((f) => f.type !== 'text')
      .map((f) =>
        f.type === 'video'
          ? `<video controls preload="metadata" src="${esc(f.path)}"${it.posters[f.path] ? ` poster="${esc(it.posters[f.path])}"` : ''}></video>`
          : f.type === 'pdf' || f.type === 'file'
            ? `<a class="pdf" href="${esc(f.path)}" target="_blank" download>${f.type === 'pdf' ? 'Open PDF' : 'Subtitles'} · ${esc(basename(f.path))}</a>`
            : `<a href="${esc(f.path)}" target="_blank"><img loading="lazy" src="${esc(f.path)}" alt="${esc(basename(f.path))}"></a>`,
      )
      .join('');
    return `<article class="card"><header><b>${esc(it.title)}</b><span>${esc(it.pack)}</span></header>${it.angle ? `<p class="angle">${esc(it.angle)}</p>` : ''}<div class="media ${it.kind}">${media}</div>${it.text ? `<details><summary>Captions &amp; copy</summary><div class="copy">${md(it.text)}</div></details>` : ''}</article>`;
  };
  const section = (k: Kind, label: string) => {
    const list = items.filter((x) => x.kind === k);
    if (!list.length) return '';
    return `<section id="${k}"><h2>${label} <small>${list.length}</small></h2>${list.map(card).join('')}</section>`;
  };
  const counts = (['video', 'carousel', 'image', 'copy'] as Kind[]).map((k) => [k, items.filter((x) => x.kind === k).length] as const);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)} campaign</title>
<style>
:root{--bg:#fafaf9;--fg:#18181b;--mut:#71717a;--card:#fff;--line:#e4e4e7;--acc:${esc(primary)}}
@media (prefers-color-scheme:dark){:root{--bg:#0c0c0e;--fg:#f4f4f5;--mut:#a1a1aa;--card:#16161a;--line:#27272a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 20px 80px}h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}
.line{font-size:20px;color:var(--acc);margin:0 0 18px}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 28px}.stats a{border:1px solid var(--line);border-radius:999px;padding:5px 14px;color:var(--fg);text-decoration:none;font-size:13px}
nav{position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:2;border-bottom:1px solid var(--line);margin-bottom:24px}
h2{font-size:22px;margin:36px 0 14px}h2 small{color:var(--mut);font-weight:400;font-size:15px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 16px}.card header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.card header span{color:var(--mut);font-size:13px}
.angle{color:var(--mut);margin:6px 0 0}.media{display:grid;gap:10px;margin-top:14px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.media.video{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.media img,.media video{width:100%;border-radius:8px;border:1px solid var(--line);display:block;background:#000}.pdf{display:flex;align-items:center;justify-content:center;min-height:80px;border:1px dashed var(--line);border-radius:8px;color:var(--acc)}
details{margin-top:12px}summary{cursor:pointer;color:var(--acc)}.copy{white-space:normal;max-height:520px;overflow:auto;padding:4px 2px}.copy h3,.copy h4,.copy h5{margin:14px 0 4px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
.note{color:var(--mut);font-size:13px;margin-top:40px}
</style></head><body><div class="wrap">
<h1>${esc(name)}</h1>${line ? `<p class="line">${esc(line)}</p>` : ''}
<div class="stats">${counts.filter(([, v]) => v).map(([k, v]) => `<a href="#${k}">${v} ${{ video: ['video', 'videos'], carousel: ['carousel', 'carousels'], image: ['graphics set', 'graphics sets'], copy: ['copy kit', 'copy kits'], product: ['', ''] }[k][v === 1 ? 0 : 1]}</a>`).join('')}${calendar ? '<a href="#calendar">Calendar</a>' : ''}</div>
${section('video', 'Videos')}${section('carousel', 'Carousels')}${section('image', 'Posts & graphics')}${section('copy', 'Copy')}
${calendar ? `<section id="calendar"><h2>Calendar</h2>${md(calendar.replace(/^#\s.*\n/, ''))}</section>` : ''}
${section('product', 'Real product UI (sample data)')}
<p class="note">Made with Shipcast on this machine. Product screens show sample data.</p>
</div></body></html>`;
  await writeFile(join(folder, 'index.html'), html);
  await writeFile(
    join(folder, 'README.md'),
    `# ${name} — campaign\n\n${line ? `> ${line}\n\n` : ''}Open \`index.html\` in a browser to review everything offline.\n\n${items.map((i) => `- **${i.title}** (${i.pack}) — ${i.files.length} file(s)`).join('\n')}\n`,
  );
  const zip = join(outDir, `${slug(name)}-campaign.zip`);
  await rm(zip, { force: true });
  const z = await run('zip', ['-qr', zip, basename(folder)], { cwd: outDir, timeoutMs: 600_000 });
  return { items: items.length, files: fileCount, zip: z.code === 0 && existsSync(zip) ? zip : undefined, folder };
}

/** A desktop notification on this Mac (no-op elsewhere). */
export async function notifyDesktop(title: string, message: string): Promise<void> {
  if (process.platform !== 'darwin' || process.env.SHIPCAST_NOTIFY === 'off') return;
  const q = (s: string) => s.replace(/["\\]/g, ' ').slice(0, 200);
  await run('osascript', ['-e', `display notification "${q(message)}" with title "${q(title)}" sound name "Glass"`], { timeoutMs: 10_000 }).catch(() => {});
}
