import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { home, rootHome } from './paths.ts';

/**
 * Download Google Fonts as local woff2 files and return @font-face CSS that
 * points at them. Deterministic renderers (HyperFrames) require fonts to be
 * shipped with the composition; a cache under ~/.shipcast/fonts makes the
 * second render offline.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SYSTEM = /^(system-ui|sans-serif|serif|monospace|-apple-system|helvetica|arial|sf pro.*|segoe ui|ui-monospace)$/i;

async function fetchCss(family: string): Promise<string | null> {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  for (const q of [`${fam}:wght@100..900`, `${fam}:wght@400;500;600;700;800;900`, `${fam}:wght@400;700`, fam]) {
    try {
      const r = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=block`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return await r.text();
    } catch {
      /* try next shape */
    }
  }
  return null;
}

/**
 * @returns CSS with @font-face rules whose `src` is `<urlPrefix>/<file>.woff2`,
 *          and the families that resolved (others should fall back).
 */
export async function localizeFonts(families: string[], destDir: string, urlPrefix = 'fonts'): Promise<{ css: string; families: string[] }> {
  const cache = join(rootHome(), 'fonts');
  await mkdir(cache, { recursive: true });
  await mkdir(destDir, { recursive: true });
  let css = '';
  const ok: string[] = [];
  for (const family of [...new Set(families.map((f) => f.trim()).filter((f) => f && !SYSTEM.test(f)))]) {
    const key = createHash('sha1').update(family).digest('hex').slice(0, 12);
    const cssCache = join(cache, `${key}.css`);
    let src = existsSync(cssCache) ? await readFile(cssCache, 'utf8') : await fetchCss(family);
    if (!src) continue;
    if (!existsSync(cssCache)) await writeFile(cssCache, src);
    // Keep latin + latin-ext subsets (each block is preceded by a /* subset */ comment).
    const blocks = [...src.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*(\{[^}]*\})/g)].filter((m) => !m[1] || /^latin/.test(m[1])).map((m) => m[2]);
    let out = '';
    for (const b of blocks) {
      const url = b.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      if (!url) continue;
      const file = `${key}-${createHash('sha1').update(url).digest('hex').slice(0, 10)}.woff2`;
      const cached = join(cache, file);
      if (!existsSync(cached)) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!r.ok) continue;
          await writeFile(cached, Buffer.from(await r.arrayBuffer()));
        } catch {
          continue;
        }
      }
      await writeFile(join(destDir, file), await readFile(cached));
      out += '@font-face' + b.replace(/url\(https:[^)]+\)/, `url(${urlPrefix}/${file})`);
    }
    if (out) {
      css += out;
      ok.push(family);
    }
  }
  return { css, families: ok };
}
