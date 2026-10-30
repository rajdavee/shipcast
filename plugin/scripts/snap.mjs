#!/usr/bin/env node
// Render HTML files to PNG (and optionally one combined PDF) with headless
// Chrome's own CLI — no npm dependencies.
//
//   node snap.mjs --size 1080x1350 slide-01.html slide-02.html ... [--outdir out/]
//   node snap.mjs --pdf out/carousel.pdf --size 1080x1350 carousel.html
//   node snap.mjs --url https://example.com --size 1440x900 --out shot.png
//   node snap.mjs --which            # print the Chrome binary it uses
//
// Each HTML file becomes <outdir>/<name>.png. Fonts and images get a few
// seconds of virtual time to load before the capture.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache/hyperframes/chrome/chrome-headless-shell');
  if (existsSync(cache)) {
    for (const v of readdirSync(cache).sort().reverse())
      for (const sub of readdirSync(join(cache, v))) {
        const bin = join(cache, v, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
  }
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync);
}

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const size = opt('size') ?? '1080x1350';
const pdf = opt('pdf');
const outdir = opt('outdir');
const budget = opt('wait') ?? '4000';
const pageUrl = opt('url');
const single = opt('out');
const which = args.includes('--which');
const files = args.filter((a) => a.endsWith('.html'));
const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome found. Run `npx hyperframes browser ensure` or install Google Chrome, or set CHROME_PATH.');
  process.exit(1);
}
if (which) {
  console.log(chrome);
  process.exit(0);
}
if (!files.length && !pageUrl) {
  console.error('usage: snap.mjs [--size WxH] [--outdir dir] [--pdf out.pdf] file.html ...  |  --url URL --out file.png');
  process.exit(2);
}
const [w, h] = size.split('x');
const base = ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox', '--force-device-scale-factor=1', '--default-background-color=00000000', `--virtual-time-budget=${budget}`, '--run-all-compositor-stages-before-draw'];

if (pageUrl) {
  if (!/^https?:\/\//.test(pageUrl)) {
    console.error('--url must be http(s)');
    process.exit(2);
  }
  const out = resolve(single ?? 'screenshot.png');
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(chrome, [...base, `--window-size=${w},${h}`, `--screenshot=${out}`, pageUrl], { stdio: 'pipe', timeout: 60_000 });
  if (r.status !== 0 || !existsSync(out)) {
    console.error(`failed: ${pageUrl}\n${r.stderr ?? ''}`);
    process.exit(1);
  }
  console.log(out);
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const abs = resolve(f);
  const url = pathToFileURL(abs).href;
  if (pdf) {
    const out = resolve(pdf);
    mkdirSync(dirname(out), { recursive: true });
    const r = spawnSync(chrome, [...base, '--no-pdf-header-footer', `--print-to-pdf=${out}`, url], { stdio: 'pipe' });
    if (r.status !== 0 || !existsSync(out)) failed++;
    else console.log(out);
    continue;
  }
  const out = single && files.length === 1 ? resolve(single) : join(resolve(outdir ?? dirname(abs)), basename(f, '.html') + '.png');
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(chrome, [...base, `--window-size=${w},${h}`, `--screenshot=${out}`, url], { stdio: 'pipe' });
  if (r.status !== 0 || !existsSync(out)) {
    failed++;
    console.error(`failed: ${f}\n${r.stderr}`);
  } else console.log(out);
}
process.exit(failed ? 1 : 0);
