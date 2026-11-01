import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

/**
 * A quick look for known malicious patterns before Shipcast runs someone's
 * project (installs, builds and dev servers execute its code). Not an
 * antivirus: it catches the loaders that hide in config files and install
 * hooks, which is how recent worms spread through repositories.
 */

export interface Finding {
  file: string;
  line: number;
  why: string;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.venv', 'venv', '__pycache__', 'storage', 'tenant-apps']);
// Composer's vendor/ at the root is third-party PHP; published assets (public/vendor/…) are scanned — worms hide there too.
const SKIP_AT_ROOT = new Set(['vendor']);
const CONFIG = /(^|\.)(config|rc)\.(c|m)?(j|t)s$|^(postcss|tailwind|vite|next|nuxt|webpack|babel|rollup|eslint|svelte|astro|jest|vitest)\.config\./i;

const CODE_PATTERNS: [RegExp, string][] = [
  [/global\s*\[\s*['"]!['"]\s*\]/, "global['!'] loader (a known worm marker)"],
  [/global\.i\s*=\s*['"][^'"]{6,}/, 'global.i = "…" loader (a known worm marker)'],
  [/\beval\s*\(\s*(atob|Buffer\.from|unescape|decodeURIComponent)\s*\(/, 'eval of decoded data'],
  [/new\s+Function\s*\(\s*(atob|Buffer\.from)/, 'Function built from decoded data'],
  [/String\.fromCharCode\((?:\s*\d+\s*,){60,}/, 'long character-code payload'],
];

const INSTALL_HOOK = /(curl|wget|Invoke-WebRequest|powershell|node\s+-e|bash\s+-c|sh\s+-c|eval\s*\()/i;

async function* files(root: string, dir = root, depth = 0): AsyncGenerator<string> {
  if (depth > 6) return;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !(depth === 0 && SKIP_AT_ROOT.has(e.name))) yield* files(root, p, depth + 1);
    } else yield p;
  }
}

export async function scanSource(root: string, limit = 4000): Promise<Finding[]> {
  const out: Finding[] = [];
  let seen = 0;
  for await (const f of files(root)) {
    if (++seen > limit || out.length >= 20) break;
    const name = basename(f);
    const rel = relative(root, f);
    const isConfig = CONFIG.test(name);
    const isPkg = name === 'package.json';
    const isTasks = rel.endsWith(join('.vscode', 'tasks.json'));
    if (!isConfig && !isPkg && !isTasks && !/\.(c|m)?js$/.test(name)) continue;
    const st = await stat(f).catch(() => null);
    if (!st || st.size > 2_000_000) continue;
    const text = await readFile(f, 'utf8').catch(() => '');
    if (isPkg) {
      try {
        const scripts = JSON.parse(text).scripts ?? {};
        for (const k of ['preinstall', 'install', 'postinstall', 'prepare']) {
          if (typeof scripts[k] === 'string' && INSTALL_HOOK.test(scripts[k])) out.push({ file: rel, line: 1, why: `"${k}" script downloads or evaluates code: ${scripts[k].slice(0, 120)}` });
        }
      } catch {}
      continue;
    }
    if (isTasks) {
      if (/"runOn"\s*:\s*"folderOpen"/.test(text)) out.push({ file: rel, line: 1, why: 'VS Code task runs automatically when the folder opens' });
      continue;
    }
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      for (const [re, why] of CODE_PATTERNS) if (re.test(l)) out.push({ file: rel, line: i + 1, why });
      // Loaders hide past the right edge of the editor: code after a long run of spaces, or a huge line in a config file.
      if (isConfig && (/[ \t]{150,}\S/.test(l) || l.length > 4000)) out.push({ file: rel, line: i + 1, why: 'code hidden after a long run of whitespace or on a very long line' });
    });
  }
  return out;
}
