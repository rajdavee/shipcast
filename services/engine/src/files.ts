import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Glob → RegExp supporting `**`, `*`, `?` and `{a,b}`. Paths use forward slashes. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escape).join('|') + ')';
      i = end;
    } else re += escape(c);
  }
  return new RegExp('^' + re + '$', 'i');
}

const escape = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

export async function walk(dir: string, max = 5000): Promise<string[]> {
  const out: string[] = [];
  async function go(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'work') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await go(p);
      else if (e.isFile()) out.push(relative(dir, p).split(sep).join('/'));
    }
  }
  await go(dir);
  return out.sort();
}

/** Files under `dir` (relative, sorted) that match any of the globs. */
export async function matchOutputs(dir: string, globs: string[]): Promise<string[]> {
  const res = globs.map(globToRegExp);
  return (await walk(dir)).filter((f) => res.some((r) => r.test(f)));
}
