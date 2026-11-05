#!/usr/bin/env node
// Build and render a product film from real takes.
//
//   node film.mjs work/film-main.json out/films/main-9x16.mp4 [--draft]
//
// The spec (paths relative to the current folder):
// {
//   "format": "vertical",                        // or "landscape"; write one spec per format
//   "target": 72,                                // seconds; the build warns when a cut misses by 8 %
//   "brand": { "name": "Acme", "url": "acme.com", "logo": "brief/assets/logo.png",
//              "fonts": { "display": "Big Shoulders Display", "serif": "Fraunces", "body": "Manrope" },
//              "colors": { "bg": "#0b1220", "ink": "#f5f2ea", "accent": "#3fd0c9", "highlight": "#f2cf86" } },
//   "voice": { "voice": "chatterbox", "pace": 150, "pause": 0.35, "pronounce": { "Acme": "Ack-mee" } },
//   "music": { "mood": "uplifting", "bpm": 94 },
//   "scenes": [
//     { "id": "hook", "kind": "title", "head": "Final whistle.", "vo": "Final whistle.", "min": 3 },
//     { "id": "pick", "kind": "ui", "kick": "Coach", "head": "Pick the player",
//       "take": { "file": "out/takes/nominate.mp4", "log": "out/takes/nominate.json", "fromMark": "pick" },
//       "zoom": [[0, 1, 0.5, 0.4], [0.5, 1.25, 0.5, 0.35]], "callouts": "taps", "vo": "…" },
//     { "id": "ops", "kind": "ui", "pipeline": ["Produced", "Checked", "Delivered"], "take": { … }, "vo": "…", "dive": true },
//     { "id": "card", "kind": "card", "image": "out/takes/card.png", "dive": true, "vo": "…" },
//     { "id": "cta", "kind": "cta", "head": "Recognition that lasts.", "sub": "acme.com" }
//   ]
// }
// Kinds: title, ui, card, cta, bumper. Prints the result with any warnings; fix every warning before scoring.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const [specFile, outFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!specFile || !outFile) {
  console.error('usage: film.mjs <spec.json> <out.mp4> [--draft]');
  process.exit(64);
}
const abs = (p) => (p && !isAbsolute(p) ? resolve(p) : p);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
if (spec.brand?.logo) spec.brand.logo = abs(spec.brand.logo);
for (const s of spec.scenes ?? []) {
  if (s.take) s.take = { ...s.take, file: abs(s.take.file), log: abs(s.take.log) };
  if (s.image) s.image = abs(s.image);
}
const out = resolve(outFile);
mkdirSync(dirname(out), { recursive: true });

const base = process.env.SHIPCAST_RENDER_URL || 'http://127.0.0.1:4320';
const r = await fetch(`${base}/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(process.env.SHIPCAST_RUN_TOKEN ? { 'x-shipcast-run': process.env.SHIPCAST_RUN_TOKEN } : {}) },
  body: JSON.stringify({ kind: 'demoFilm', input: { spec, out, quality: process.argv.includes('--draft') ? 'draft' : 'delivery' } }),
}).catch(() => null);
if (!r) {
  console.error("The render service isn't running (shipcast start).");
  process.exit(1);
}
const j = await r.json();
if (j.status !== 'done') {
  console.error(j.error || 'the film failed to render');
  process.exit(1);
}
const { file, srt, total, scenes, warnings } = j.output;
console.log(JSON.stringify({ file, srt, total, scenes: scenes.map((s) => `${s.id} ${s.start.toFixed(1)}+${s.duration.toFixed(1)}`), warnings }, null, 1));
