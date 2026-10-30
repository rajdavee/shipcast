#!/usr/bin/env node
// Turn a sequence of slide images into an MP4 with a gentle push-in on each
// slide and a transition between them. Optional music bed, faded in and out.
//
//   node slides-to-video.mjs --out out/carousel.mp4 [--size 1080x1350] [--hold 2.6]
//        [--transition slideleft] [--xfade 0.35] [--music bed.mp3] out/slides/*.png
//
// Transitions are FFmpeg xfade names: fade, slideleft, slideup, wipeleft,
// smoothleft, circleopen, dissolve, …
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = resolve(opt('out', 'out/slides.mp4'));
const [W, H] = opt('size', '1080x1350').split('x').map(Number);
const hold = Number(opt('hold', '2.6'));
const xf = Number(opt('xfade', '0.35'));
const transition = opt('transition', 'slideleft');
const music = opt('music');
const fps = 30;
const slides = args.filter((a) => /\.(png|jpe?g|webp)$/i.test(a));
if (slides.length === 0) {
  console.error('usage: slides-to-video.mjs --out file.mp4 [--size WxH] [--hold s] [--transition name] [--music file] slide1.png …');
  process.exit(2);
}

// Each clip is hold + xfade long so the visible hold stays `hold` after overlaps.
const clip = hold + xf;
const frames = Math.round(clip * fps);
const inputs = slides.flatMap((s) => ['-loop', '1', '-framerate', String(fps), '-t', clip.toFixed(3), '-i', s]);
const filters = slides.map(
  (_, i) =>
    `[${i}:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.045*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p[v${i}]`,
);
let last = 'v0';
for (let i = 1; i < slides.length; i++) {
  const offset = (i * hold).toFixed(3);
  const label = `x${i}`;
  filters.push(`[${last}][v${i}]xfade=transition=${transition}:duration=${xf}:offset=${offset}[${label}]`);
  last = label;
}
const total = slides.length * hold + xf;
const cmd = ['-y', ...inputs];
if (music) cmd.push('-i', music);
cmd.push('-filter_complex', filters.join(';') + (music ? `;[${slides.length}:a]afade=t=in:d=0.8,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,volume=0.8[a]` : ''));
cmd.push('-map', `[${last}]`);
if (music) cmd.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-shortest');
cmd.push('-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);

mkdirSync(dirname(out), { recursive: true });
const r = spawnSync('ffmpeg', cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) {
  console.error(r.stderr.toString().split('\n').slice(-15).join('\n'));
  process.exit(1);
}
console.log(`${out} (${total.toFixed(1)}s, ${slides.length} slides)`);
