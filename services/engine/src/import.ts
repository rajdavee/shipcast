import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { campaignDir } from './paths.ts';
import { createCampaign, deleteCampaign, newId } from './store.ts';
import type { Campaign, Source, Step } from './types.ts';

/** File types a finished deliverable can hold. */
const KINDS = new Set(['.mp4', '.mov', '.webm', '.gif', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.pdf', '.pptx', '.srt', '.vtt', '.md', '.txt', '.json', '.html', '.csv', '.mp3', '.wav', '.m4a']);
const MAX_FILE = 1024 ** 3;
const MAX_TOTAL = 8 * 1024 ** 3;

export interface ImportItem {
  /** Pack the work belongs to, so the Library shows it with the right card. */
  pack: string;
  title?: string;
  options?: Record<string, string>;
  /** Files relative to the import folder; each lands in the step's out/ under its own name. */
  files: string[];
}

export interface ImportSpec {
  folder: string;
  name: string;
  source?: Source;
  goal?: string;
  audience?: string;
  tone?: string;
  notes?: string;
  /** Markdown for the campaign brief. */
  brief?: string;
  items: ImportItem[];
}

/**
 * Bring finished work made outside Shipcast into the Library as a campaign.
 * Files are copied (never linked) from inside `folder` only; symlinks,
 * unknown file types and oversized files are refused before anything is written.
 */
export async function importCampaign(spec: ImportSpec, packIds: Set<string>): Promise<Campaign> {
  if (!spec?.folder || !isAbsolute(spec.folder)) throw new Error('folder must be an absolute path');
  if (!String(spec.name ?? '').trim()) throw new Error('name is required');
  if (!Array.isArray(spec.items) || !spec.items.length || spec.items.length > 40) throw new Error('items must list 1–40 deliverables');
  const root = await realpath(spec.folder).catch(() => {
    throw new Error('folder not found');
  });
  if (!(await lstat(root)).isDirectory()) throw new Error('folder must be a directory');

  // Check every file first so a bad entry never leaves a half-made campaign.
  let total = 0;
  const plan: { step: Step; files: { from: string; name: string }[] }[] = [];
  for (const [i, it] of spec.items.entries()) {
    if (!packIds.has(it?.pack)) throw new Error(`item ${i + 1}: unknown pack "${it?.pack}"`);
    if (!Array.isArray(it.files) || !it.files.length || it.files.length > 50) throw new Error(`item ${i + 1}: files must list 1–50 files`);
    const files: { from: string; name: string }[] = [];
    for (const f of it.files) {
      if (typeof f !== 'string' || isAbsolute(f)) throw new Error(`item ${i + 1}: files are relative to the folder`);
      const from = join(root, f);
      const rel = relative(root, from);
      if (rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error(`item ${i + 1}: ${f} is outside the folder`);
      const st = await lstat(from).catch(() => null);
      if (!st?.isFile()) throw new Error(`item ${i + 1}: ${f} is not a regular file`);
      if ((await realpath(from)) !== from) throw new Error(`item ${i + 1}: ${f} goes through a link`);
      if (!KINDS.has(extname(f).toLowerCase())) throw new Error(`item ${i + 1}: ${f} is not a deliverable file type`);
      if (st.size > MAX_FILE) throw new Error(`item ${i + 1}: ${f} is over 1 GB`);
      total += st.size;
      const name = basename(f);
      if (files.some((x) => x.name === name)) throw new Error(`item ${i + 1}: two files named ${name}`);
      files.push({ from, name });
    }
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(it.options ?? {})) if (typeof v === 'string') options[k.slice(0, 40)] = v.slice(0, 200);
    if (it.title) options._title = String(it.title).slice(0, 120);
    const now = new Date().toISOString();
    plan.push({ step: { id: newId('d'), kind: 'pack', pack: it.pack, options, status: 'done', outputs: files.map((x) => `out/${x.name}`), revisions: [], startedAt: now, endedAt: now }, files });
  }
  if (total > MAX_TOTAL) throw new Error('import is over 8 GB');

  const now = new Date().toISOString();
  const c = await createCampaign({
    name: spec.name.slice(0, 120),
    source: spec.source?.type && spec.source.value ? spec.source : { type: 'local', value: root },
    goal: String(spec.goal ?? '').slice(0, 500),
    audience: String(spec.audience ?? '').slice(0, 500),
    tone: String(spec.tone ?? '').slice(0, 200),
    notes: String(spec.notes ?? '').slice(0, 4000),
    steps: [{ id: 'brief', kind: 'brief', options: {}, status: 'done', outputs: ['brief.md'], revisions: [], startedAt: now, endedAt: now }, ...plan.map((p) => p.step)],
  });
  try {
    const dir = campaignDir(c.id);
    await mkdir(join(dir, 'brief'), { recursive: true });
    await writeFile(join(dir, 'brief', 'brief.md'), String(spec.brief ?? `# ${c.name}\n\n${c.goal}\n`).slice(0, 200_000));
    for (const p of plan)
      for (const f of p.files) {
        const to = join(dir, 'deliverables', p.step.id, 'out', f.name);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(f.from, to);
      }
  } catch (e) {
    await deleteCampaign(c.id).catch(() => {});
    throw e;
  }
  return c;
}
