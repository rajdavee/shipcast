import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './exec.ts';
import { campaignDir } from './paths.ts';
import { getPack } from './packs.ts';
import { catalogMarkdown, renderSpec, SPEC_FILE, type SpecKind } from './specs.ts';
import type { Campaign, Step } from './types.ts';

/**
 * Hook variants: the same piece with different openings, for A/B tests. Claude
 * writes only the hooks (hooks.json); everything after the opening stays
 * identical, so a result difference is the hook's doing. Each variant is the
 * original spec with a patch applied, rendered by the normal renderer.
 */

/** Which array in each spec holds the units a hook lives in, and what "the opening" means. */
export const HOOK_TARGET: Partial<Record<SpecKind, { field: string; opening: string }>> = {
  storyboard: { field: 'scenes', opening: 'the first scene (and, if the hook needs it, the second)' },
  deck: { field: 'slides', opening: 'the cover slide (index 0)' },
  slides: { field: 'slides', opening: 'the title slide (index 0)' },
  graphics: { field: 'items', opening: 'each post\'s headline field' },
  document: { field: 'pages', opening: 'the cover page (index 0)' },
  email: { field: 'emails', opening: 'subjects, preheader and the hero block of each email' },
};

export interface HookVariant {
  name: string;
  angle: string;
  hook: string;
  /** { "<arrayField>": { "<index>": <replacement object> } } plus optional top-level overrides. */
  patch: Record<string, unknown>;
}

const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'v';

/** The source step, its spec kind and spec file — or an error a person can act on. */
export async function variantSource(c: Campaign, sourceId: string): Promise<{ step: Step; kind: SpecKind; file: string }> {
  const step = c.steps.find((s) => s.id === sourceId);
  if (!step || step.status !== 'done' || !step.pack) throw new Error('Pick a finished piece to make hook variants of.');
  const pack = await getPack(step.pack);
  const kind = pack?.spec as SpecKind | undefined;
  if (!kind || !HOOK_TARGET[kind]) throw new Error(`Hook variants work on videos, carousels, decks, posts, documents and emails — not ${pack?.name ?? step.pack}.`);
  const file = join(campaignDir(c.id), 'deliverables', step.id, 'out', SPEC_FILE[kind]);
  if (!existsSync(file)) throw new Error('That piece has no spec to vary yet.');
  return { step, kind, file };
}

/** Put the base spec and its catalog next to the variants step so Claude can read them. */
export async function prepareVariants(c: Campaign, step: Step, cwd: string): Promise<{ kind: SpecKind }> {
  const src = await variantSource(c, step.options.of);
  await mkdir(join(cwd, 'out'), { recursive: true });
  await cp(src.file, join(cwd, 'base.json'));
  await writeFile(join(cwd, 'catalog.md'), await catalogMarkdown(src.kind).catch(() => ''));
  await writeFile(join(cwd, 'variant-kind.txt'), `${src.kind}\n${HOOK_TARGET[src.kind]!.field}\n${HOOK_TARGET[src.kind]!.opening}\n`);
  return { kind: src.kind };
}

/** Apply one variant's patch to a copy of the base spec. */
export function applyHook(base: any, v: HookVariant, field: string): any {
  const spec = structuredClone(base);
  for (const [k, val] of Object.entries(v.patch ?? {})) {
    if (k === field && val && typeof val === 'object' && !Array.isArray(val) && Array.isArray(spec[field])) {
      for (const [idx, rep] of Object.entries(val as Record<string, any>)) {
        const i = Number(idx);
        if (!Number.isInteger(i) || i < 0 || i >= spec[field].length || !rep || typeof rep !== 'object') continue;
        // Shallow-merge so a patch can change just the headline field of a post.
        const cur = spec[field][i];
        spec[field][i] = rep.fields && cur?.fields ? { ...cur, ...rep, fields: { ...cur.fields, ...rep.fields } } : { ...cur, ...rep };
      }
    } else if (k !== field) {
      spec[k] = val;
    }
  }
  return spec;
}

/** Render every variant in hooks.json; returns problems to send back (empty when all rendered). */
export async function renderVariants(cwd: string, briefDir: string, kind: SpecKind): Promise<{ ok: boolean; feedback: string[]; rendered: string[] }> {
  let hooks: { variants?: HookVariant[] };
  try {
    hooks = JSON.parse(await readFile(join(cwd, 'out', 'hooks.json'), 'utf8'));
  } catch {
    return { ok: false, feedback: ['out/hooks.json is missing or not valid JSON.'], rendered: [] };
  }
  const variants = (hooks.variants ?? []).slice(0, 8);
  if (variants.length < 2) return { ok: false, feedback: ['hooks.json needs at least 2 variants.'], rendered: [] };
  const base = JSON.parse(await readFile(join(cwd, 'base.json'), 'utf8'));
  const field = HOOK_TARGET[kind]!.field;
  const feedback: string[] = [];
  const rendered: string[] = [];
  const firsts: string[] = [];
  for (const v of variants) {
    const name = slug(v.name);
    // Inside out/ so the campaign page lists every variant like any other output.
    const vdir = join(cwd, 'out', 'variants', name);
    await mkdir(join(vdir, 'out'), { recursive: true });
    await writeFile(join(vdir, 'out', SPEC_FILE[kind]), JSON.stringify(applyHook(base, v, field), null, 2));
    const r = await renderSpec(kind, vdir, briefDir);
    if (!r.ok) feedback.push(...r.feedback.slice(0, 3).map((f) => `Variant "${v.name}": ${f}`));
    rendered.push(name);
    const first = [join(vdir, 'out', 'video.jpg'), join(vdir, 'out', 'slides', 'slide-01.png'), join(vdir, 'out', 'pages', 'page-01.png')].find(existsSync);
    if (first) firsts.push(first);
  }
  // A side-by-side of every opening, the way a reviewer compares hooks.
  if (firsts.length >= 2) {
    const inputs = firsts.flatMap((f) => ['-i', f]);
    const chain = firsts.map((_, i) => `[${i}]scale=-2:480,pad=iw+16:ih+16:8:8:color=0xe6e8ec[v${i}]`).join(';');
    await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${chain};${firsts.map((_, i) => `[v${i}]`).join('')}hstack=${firsts.length}`, '-frames:v', '1', join(cwd, 'out', 'variants.sheet.jpg')]);
  }
  await writeFile(join(cwd, 'out', 'variants.md'), ['# Hook variants', '', ...variants.map((v) => `- **${v.name}** (${v.angle}): ${v.hook} → variants/${slug(v.name)}/out/`)].join('\n') + '\n');
  return { ok: !feedback.length, feedback, rendered };
}
