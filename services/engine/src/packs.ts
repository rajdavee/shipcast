import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACKS_DIR } from './paths.ts';
import type { Pack } from './types.ts';

const CATEGORIES = new Set(['video', 'motion', 'design', 'copy', 'app']);

export function validatePack(p: Partial<Pack>, where: string): string[] {
  const errs: string[] = [];
  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) errs.push(`${where}: id must be kebab-case`);
  if (!p.name) errs.push(`${where}: name is required`);
  if (!p.tagline) errs.push(`${where}: tagline is required`);
  if (!p.category || !CATEGORIES.has(p.category)) errs.push(`${where}: category must be one of ${[...CATEGORIES].join(', ')}`);
  if (!Array.isArray(p.outputs) || p.outputs.length === 0) errs.push(`${where}: outputs must list at least one glob`);
  for (const o of p.options ?? []) {
    if (!o.key || !/^[a-zA-Z][\w]*$/.test(o.key)) errs.push(`${where}: option key "${o.key}" is invalid`);
    if (o.type === 'select' && !o.choices.includes(o.default)) errs.push(`${where}: option ${o.key} default not in choices`);
  }
  return errs;
}

let cache: Pack[] | null = null;
let partials: Record<string, string> = {};

async function loadPartials(): Promise<Record<string, string>> {
  const dir = join(PACKS_DIR, '_partials');
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of await readdir(dir)) if (f.endsWith('.md')) out[f.slice(0, -3)] = await readFile(join(dir, f), 'utf8');
  return out;
}

export async function loadPacks(fresh = false): Promise<Pack[]> {
  if (cache && !fresh) return cache;
  partials = await loadPartials();
  const packs: Pack[] = [];
  for (const name of (await readdir(PACKS_DIR)).sort()) {
    if (name.startsWith('_')) continue;
    const dir = join(PACKS_DIR, name);
    const manifest = join(dir, 'pack.json');
    if (!existsSync(manifest)) continue;
    const raw = JSON.parse(await readFile(manifest, 'utf8'));
    const prompt = await readFile(join(dir, 'prompt.md'), 'utf8');
    const pack: Pack = { options: [], skills: [], tools: [], ...raw, prompt, dir };
    const errs = validatePack(pack, `packs/${name}`);
    for (const m of prompt.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)) if (!partials[m[1]]) errs.push(`packs/${name}: unknown partial ${m[1]}`);
    if (errs.length) throw new Error(errs.join('\n'));
    packs.push(pack);
  }
  packs.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  cache = packs;
  return packs;
}

export async function getPack(id: string): Promise<Pack | undefined> {
  return (await loadPacks()).find((p) => p.id === id);
}

/**
 * Minimal mustache: `{{> partial}}` includes packs/_partials/<partial>.md,
 * `{{key}}` substitutes, `{{#key}}...{{/key}}` keeps the block only when key
 * is non-empty. Unknown keys render empty.
 */
export function renderTemplate(tpl: string, vars: Record<string, string | undefined>, parts: Record<string, string> = partials): string {
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, k) => (parts[k] ?? '').trim())
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) => (vars[k]?.trim() ? body : ''))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
    .replace(/\n{3,}/g, '\n\n');
}

export function defaultOptions(pack: Pack): Record<string, string> {
  return Object.fromEntries(pack.options.map((o) => [o.key, o.default]));
}
