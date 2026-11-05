import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { localizeFonts, probe, run } from '@shipcast/engine';
import { MOODS, phraseCues, toSrt, type Cue, type Mood, type Word } from '@shipcast/media';
import type { VoiceShape } from './compile.ts';

/**
 * Demo film: a product film cut from real screen recordings ("takes").
 * One persistent phone rig (3D rise, sway, restrained zooms) carries every
 * run of phone scenes; desktop takes play in a window (16:9). Callouts and
 * tap ticks come from the take logs, a "dive" pushes into the result image,
 * captions are phrase-led karaoke, and the score follows an energy arc with
 * sound on cuts, taps, the card and the call to action. 9:16 and 16:9 are
 * laid out separately; the length is checked against the target.
 */

export type FilmKind = 'title' | 'ui' | 'card' | 'cta' | 'bumper' | 'badges' | 'stat';

export interface FilmTake {
  /** The recording (mp4). */
  file: string;
  /** recordTake's JSON log: viewport, taps and marks. */
  log?: string;
  /** Seconds into the take where the scene starts … */
  from?: number;
  /** … or a mark label from the log. */
  fromMark?: string;
}

export interface FilmCallout {
  text: string;
  /** Seconds into the scene (default: the matching tap, else spread out). */
  at?: number;
  side?: 'left' | 'right';
}

export interface FilmScene {
  id: string;
  kind: FilmKind;
  /** badges: labelled chips that wipe in as the voice says each one (roles, sports, steps). Up to 8. */
  items?: string[];
  /** title: false leaves the logo out (a hook should open on the idea, not the brand). */
  mark?: boolean;
  /** stat: big numbers that roll up like a scoreboard, each with a label. Up to 4. */
  stats?: { value: number; label: string; suffix?: string }[];
  vo?: string;
  /** Minimum seconds on screen. */
  min?: number;
  kick?: string;
  head?: string;
  sub?: string;
  take?: FilmTake;
  /** Camera keyframes on the screen: [relative time 0–1, scale, originX 0–1, originY 0–1]. */
  zoom?: [number, number, number, number][];
  /** Labels beside the device, or 'taps' to label every logged tap in the window. */
  callouts?: FilmCallout[] | 'taps';
  /** Steps that light up as the voice says them. */
  pipeline?: string[];
  /** Result image for a card. */
  image?: string;
  /** ui: push into the screen at the end (into the next card). card: land as if pushed into. */
  dive?: boolean;
}

export interface FilmSpec {
  format: 'vertical' | 'landscape';
  brand: { name: string; fonts: { display: string; serif?: string; body: string }; colors: { bg: string; ink: string; accent: string; highlight?: string }; logo?: string; url?: string };
  voice?: { voice: string; speed?: number; pace?: number; pause?: number; pronounce?: Record<string, string> } | null;
  music?: { mood: string; bpm?: number; seed?: number } | null;
  scenes: FilmScene[];
  /** Target length in seconds. */
  target?: number;
}

/** A take log as written by recordTake. Tap positions are fractions of the viewport. */
export interface TakeLog {
  viewport: 'phone' | 'desktop';
  taps: { label: string; at: number; x: number; y: number }[];
  marks: { label: string; at: number }[];
}

export type FilmSfx = { kind: 'whoosh' | 'pop' | 'tick' | 'riser' | 'impact'; at: number; gain?: number };

export interface FilmDeps {
  /** media.voice — audio plus word timings. */
  voice: (text: string, voice: string, speed: number, out: string, shape?: VoiceShape) => Promise<{ file: string; duration: number; words: Word[] }>;
  /** media.music — procedural bed with an energy arc and SFX. */
  music: (mood: Mood, seconds: number, sfx: FilmSfx[], out: string, energy?: { at: number; level: number }[], opts?: { bpm?: number; seed?: number }) => Promise<{ file: string }>;
  /** media.mix — voice over music with ducking, mastered to -14 LUFS. */
  mix: (voice: string | null, music: string | null, out: string, seconds: number, gainDb?: number) => Promise<{ file: string }>;
}

export interface FilmResult {
  dir: string;
  width: number;
  height: number;
  total: number;
  scenes: { id: string; kind: FilmKind; start: number; duration: number }[];
  warnings: string[];
  srt: string | null;
  audio: string | null;
  words: Word[];
}

const KINDS: FilmKind[] = ['title', 'ui', 'card', 'cta', 'bumper', 'badges', 'stat'];
const MIN: Record<FilmKind, number> = { title: 3, ui: 4, card: 5, cta: 4.5, bumper: 2.5, badges: 3.5, stat: 3.5 };
/** Voice starts this long into its scene and the scene holds this long after it. */
const LEAD = 0.45;
const TAIL = 0.6;
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/-]+\)|[a-z]{3,20})$/i;
const FONT = /^[\w .-]{1,60}$/;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Validate a film spec; every problem names its scene and field (empty = ok). */
export function validateFilmSpec(spec: FilmSpec): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== 'object') return ['spec must be an object'];
  if (spec.format !== 'vertical' && spec.format !== 'landscape') errs.push('format must be "vertical" or "landscape"');
  const b = spec.brand;
  if (!b || typeof b !== 'object') errs.push('brand is required');
  else {
    if (!b.name?.trim()) errs.push('brand.name is required');
    for (const k of ['display', 'body'] as const) if (!b.fonts?.[k] || !FONT.test(b.fonts[k])) errs.push(`brand.fonts.${k} must be a font family name`);
    if (b.fonts?.serif !== undefined && !FONT.test(b.fonts.serif)) errs.push('brand.fonts.serif must be a font family name');
    for (const k of ['bg', 'ink', 'accent'] as const) if (!b.colors?.[k] || !COLOR.test(b.colors[k])) errs.push(`brand.colors.${k} must be a CSS colour like #0b0d12`);
    if (b.colors?.highlight !== undefined && !COLOR.test(b.colors.highlight)) errs.push('brand.colors.highlight must be a CSS colour');
    if (b.logo !== undefined && (!isAbsolute(b.logo) || !IMAGE.test(b.logo))) errs.push('brand.logo must be an absolute path to an image');
    else if (b.logo && !existsSync(b.logo)) errs.push(`brand.logo not found: ${b.logo}`);
    if (b.url !== undefined && (typeof b.url !== 'string' || b.url.length > 80)) errs.push('brand.url must be a short string');
  }
  const v = spec.voice;
  if (v) {
    if (typeof v.voice !== 'string' || !v.voice) errs.push('voice.voice is required');
    if (v.speed !== undefined && !(isNum(v.speed) && v.speed >= 0.5 && v.speed <= 2)) errs.push('voice.speed must be 0.5–2');
    if (v.pace !== undefined && !(isNum(v.pace) && v.pace >= 90 && v.pace <= 220)) errs.push('voice.pace must be 90–220 words per minute');
    if (v.pause !== undefined && !(isNum(v.pause) && v.pause >= 0 && v.pause <= 2)) errs.push('voice.pause must be 0–2 seconds');
    if (v.pronounce !== undefined && (typeof v.pronounce !== 'object' || Object.values(v.pronounce).some((x) => typeof x !== 'string'))) errs.push('voice.pronounce must map words to how they are said');
  }
  const m = spec.music;
  if (m) {
    if (!(m.mood in MOODS)) errs.push(`music.mood must be one of ${Object.keys(MOODS).join(', ')}`);
    if (m.bpm !== undefined && !(isNum(m.bpm) && m.bpm >= 60 && m.bpm <= 180)) errs.push('music.bpm must be 60–180');
    if (m.seed !== undefined && !Number.isInteger(m.seed)) errs.push('music.seed must be an integer');
  }
  if (spec.target !== undefined && !(isNum(spec.target) && spec.target >= 3 && spec.target <= 600)) errs.push('target must be 3–600 seconds');
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) {
    errs.push('scenes must be a non-empty array');
    return errs;
  }
  if (spec.scenes.length > 40) errs.push('scenes: at most 40');
  const seen = new Set<string>();
  spec.scenes.forEach((s, i) => {
    const at = `scene ${i + 1}${s?.id ? ` "${s.id}"` : ''}${s?.kind ? ` (${s.kind})` : ''}`;
    const e = (msg: string) => errs.push(`${at}: ${msg}`);
    if (!s || typeof s !== 'object') return e('must be an object');
    if (typeof s.id !== 'string' || !/^[a-z0-9][\w-]{0,40}$/i.test(s.id)) e('id must be letters, digits, - or _');
    else if (seen.has(s.id)) e('id is used twice');
    else seen.add(s.id);
    if (!KINDS.includes(s.kind)) e(`kind must be one of ${KINDS.join(', ')}`);
    if (s.vo !== undefined && (typeof s.vo !== 'string' || s.vo.length > 500)) e('vo must be text under 500 characters');
    if (s.min !== undefined && !(isNum(s.min) && s.min >= 0.5 && s.min <= 60)) e('min must be 0.5–60 seconds');
    for (const k of ['kick', 'head', 'sub'] as const) if (s[k] !== undefined && (typeof s[k] !== 'string' || s[k]!.length > (k === 'sub' ? 90 : 60))) e(`${k} must be text under ${k === 'sub' ? 90 : 60} characters`);
    if (s.kind === 'ui' && !s.take) e('take is required for a ui scene');
    if (s.mark !== undefined && typeof s.mark !== 'boolean') e('mark must be true or false');
    if (s.kind === 'badges' && !(Array.isArray(s.items) && s.items.length >= 2 && s.items.length <= 8 && s.items.every((x) => typeof x === 'string' && x.trim() && x.length <= 28))) e('items must list 2–8 labels of up to 28 characters');
    if (s.kind === 'stat' && !(Array.isArray(s.stats) && s.stats.length >= 1 && s.stats.length <= 4 && s.stats.every((x) => x && Number.isInteger(x.value) && x.value >= 0 && x.value < 1e7 && typeof x.label === 'string' && x.label.length <= 28 && (x.suffix === undefined || (typeof x.suffix === 'string' && x.suffix.length <= 3))))) e('stats must list 1–4 { value: whole number, label, suffix? }');
    if (s.take) {
      if (s.kind !== 'ui' && s.kind !== 'bumper') e('take is only for ui and bumper scenes');
      if (typeof s.take.file !== 'string' || !isAbsolute(s.take.file) || !VIDEO.test(s.take.file)) e('take.file must be an absolute path to an mp4');
      else if (!existsSync(s.take.file)) e(`take.file not found: ${s.take.file}`);
      if (s.take.log !== undefined && (typeof s.take.log !== 'string' || !isAbsolute(s.take.log) || !s.take.log.endsWith('.json'))) e('take.log must be an absolute path to a .json log');
      else if (s.take.log && !existsSync(s.take.log)) e(`take.log not found: ${s.take.log}`);
      if (s.take.from !== undefined && !(isNum(s.take.from) && s.take.from >= 0)) e('take.from must be seconds ≥ 0');
      if (s.take.fromMark !== undefined && (typeof s.take.fromMark !== 'string' || !s.take.log)) e('take.fromMark needs a take.log with marks');
    }
    if (s.zoom !== undefined) {
      if (!Array.isArray(s.zoom) || !s.zoom.length) e('zoom must be a list of [time, scale, x, y]');
      else
        s.zoom.forEach((z, k) => {
          if (!Array.isArray(z) || z.length !== 4 || !z.every(isNum)) return e(`zoom[${k}] must be [time 0–1, scale, x 0–1, y 0–1]`);
          if (z[0] < 0 || z[0] > 1 || (k > 0 && z[0] <= s.zoom![k - 1][0])) e(`zoom[${k}] time must rise from 0 to 1`);
          if (z[1] < 1 || z[1] > 3) e(`zoom[${k}] scale must be 1–3`);
          if (z[2] < 0 || z[2] > 1 || z[3] < 0 || z[3] > 1) e(`zoom[${k}] x and y must be 0–1`);
        });
      if (!s.take) e('zoom needs a take');
    }
    if (s.callouts !== undefined) {
      if (!s.take) e('callouts need a take');
      if (s.callouts === 'taps') {
        if (!s.take?.log) e('callouts "taps" needs take.log');
      } else if (!Array.isArray(s.callouts)) e('callouts must be "taps" or a list');
      else
        s.callouts.forEach((c, k) => {
          if (!c || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 40) e(`callouts[${k}].text must be 1–40 characters`);
          if (c?.at !== undefined && !(isNum(c.at) && c.at >= 0)) e(`callouts[${k}].at must be seconds ≥ 0`);
          if (c?.side !== undefined && c.side !== 'left' && c.side !== 'right') e(`callouts[${k}].side must be left or right`);
        });
    }
    if (s.pipeline !== undefined && (!Array.isArray(s.pipeline) || s.pipeline.length < 2 || s.pipeline.length > 5 || s.pipeline.some((p) => typeof p !== 'string' || !p.trim() || p.length > 18))) e('pipeline must be 2–5 short step names');
    if (s.image !== undefined) {
      if (typeof s.image !== 'string' || !isAbsolute(s.image) || !IMAGE.test(s.image)) e('image must be an absolute path to an image');
      else if (!existsSync(s.image)) e(`image not found: ${s.image}`);
    }
    if (s.dive && s.kind !== 'ui' && s.kind !== 'card') e('dive is only for ui and card scenes');
    if (s.kind === 'ui' && s.dive && spec.scenes[i + 1]?.kind !== 'card') e('dive pushes into the next scene, which must be a card');
  });
  return errs;
}

/** True when a PNG's four corners are opaque — it likely carries a background box. Null when it can't be read. */
export async function logoHasOpaqueCorners(file: string, tmpDir: string): Promise<boolean | null> {
  const raw = join(tmpDir, `.corners-${createHash('sha1').update(file).digest('hex').slice(0, 8)}.rgba`);
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'format=rgba,scale=16:16:flags=neighbor', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { timeoutMs: 30_000 });
  if (r.code !== 0) return null;
  const px = await readFile(raw).catch(() => null);
  await rm(raw, { force: true });
  if (!px || px.length < 16 * 16 * 4) return null;
  return [0, 15, 16 * 15, 16 * 16 - 1].every((i) => px[i * 4 + 3] >= 250);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Layout constants per format: device sizes, the text column, caption safe zones. */
function layout(vertical: boolean, phoneAspect: number, deskAspect: number) {
  const W = vertical ? 1080 : 1920;
  const H = vertical ? 1920 : 1080;
  // Phone rig: centred under the text in 9:16, right of the text column in 16:9.
  let SW = vertical ? 480 : 420;
  const maxH = vertical ? 1050 : 930;
  if (SW * phoneAspect > maxH) SW = Math.round(maxH / phoneAspect);
  const SH = Math.round(SW * phoneAspect);
  const BEZ = vertical ? 16 : 14;
  const RAD = vertical ? 58 : 50;
  const SX = vertical ? Math.round((W - SW) / 2) : 1180;
  const SY = vertical ? 470 : Math.round((H - SH) / 2);
  // Desktop: a window right of the text in 16:9; a framed panel in 9:16.
  const DW = vertical ? 1000 : 1060;
  // In 9:16 the panel is taller than the recording and shows a crop of it at about 1.2× its size, so text stays readable.
  const DH = vertical ? 1120 : Math.min(800, Math.round(DW * deskAspect));
  const CHROME = vertical ? 0 : 44;
  const DX = vertical ? 40 : W - 120 - DW;
  const DY = vertical ? Math.round(SY + (SH - DH) / 2) : Math.round((H - DH - CHROME) / 2);
  const text = vertical ? { left: 80, right: 80, top: 150, kick: 26, head: 84, sub: 44, align: 'center' } : { left: 120, right: W - 720, top: 230, kick: 24, head: 96, sub: 46, align: 'left' };
  // Captions: under the device in 9:16 (clear of the right-hand action rail), in the text column in 16:9.
  const capDevice = vertical ? { top: SY + SH + BEZ + 40, left: 70, right: 150, size: 46, align: 'center' } : { top: 800, left: 120, right: W - 740, size: 40, align: 'left' };
  const capWide = vertical ? { top: 1560, left: 70, right: 150, size: 50, align: 'center' } : { top: 950, left: 200, right: 200, size: 46, align: 'center' };
  return { W, H, SW, SH, BEZ, RAD, SX, SY, DW, DH, DX, DY, CHROME, text, capDevice, capWide, deskAspect };
}

type Device = 'phone' | 'desk';

interface Planned {
  sc: FilmScene;
  i: number;
  start: number;
  duration: number;
  vo: { file: string; duration: number; words: Word[] } | null;
  take?: { src: string; rel: string; from: number; span: number; device: Device; log: TakeLog | null; width: number; height: number };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Build a HyperFrames project for a demo film into `dir`: index.html, assets, plan.json and captions.srt. */
export async function buildFilm(spec: FilmSpec, dir: string, deps: FilmDeps): Promise<FilmResult> {
  const errs = validateFilmSpec(spec);
  if (errs.length) throw new Error(`film spec is invalid:\n- ${errs.join('\n- ')}`);
  const vertical = spec.format === 'vertical';
  const warnings: string[] = [];
  await mkdir(join(dir, 'assets'), { recursive: true });

  const copied = new Map<string, string>();
  const asset = async (src: string) => {
    if (copied.has(src)) return copied.get(src)!;
    const name = `${createHash('sha1').update(src).digest('hex').slice(0, 8)}-${basename(src).replace(/[^\w.-]/g, '_')}`;
    await copyFile(src, join(dir, 'assets', name));
    copied.set(src, `assets/${name}`);
    return `assets/${name}`;
  };

  // 1. Takes: footage length, device and log.
  const takes: Planned['take'][] = [];
  for (const [i, s] of spec.scenes.entries()) {
    if (!s.take) continue;
    const p = await probe(s.take.file);
    const log: TakeLog | null = s.take.log ? JSON.parse(await readFile(s.take.log, 'utf8')) : null;
    const width = p.video?.width ?? 1170;
    const height = p.video?.height ?? 2532;
    const device: Device = log?.viewport === 'desktop' || (!log?.viewport && width > height) ? 'desk' : 'phone';
    let from = s.take.from ?? 0;
    if (s.take.fromMark) {
      const mk = log?.marks?.find((x) => x.label === s.take!.fromMark);
      if (mk) from = mk.at;
      else warnings.push(`scene "${s.id}": no mark "${s.take.fromMark}" in the take log — starting at ${from.toFixed(1)} s`);
    }
    from = Math.max(0, Math.min(from, Math.max(0, p.duration - 0.5)));
    if (device === 'desk' && vertical) warnings.push(`scene "${s.id}": a desktop take in a 9:16 film is shown cropped around its zoom focus — a phone take reads better in vertical`);
    takes[i] = { src: s.take.file, rel: await asset(s.take.file), from: r3(from), span: r3(p.duration - from), device, log, width, height };
  }

  // 2. Voice per scene → durations.
  const voiced: Planned['vo'][] = [];
  for (const [i, s] of spec.scenes.entries()) {
    if (!spec.voice || !s.vo?.trim()) continue;
    voiced[i] = await deps.voice(s.vo.trim(), spec.voice.voice, spec.voice.speed ?? 1, join(dir, 'assets', `vo-${s.id}.wav`), { pronounce: spec.voice.pronounce, pause: spec.voice.pause, pace: spec.voice.pace });
  }

  // 3. Timeline: the voice (plus lead and tail) sets the length; footage caps how long a take can run.
  let t = 0;
  const plan: Planned[] = spec.scenes.map((sc, i) => {
    const vo = voiced[i] ?? null;
    const want = Math.max(sc.min ?? MIN[sc.kind], vo ? LEAD + vo.duration + TAIL : 0);
    let d = want;
    const take = takes[i];
    if (take && want > take.span + 0.05 && take.from > 0) {
      // Rather than freeze on the last frame, start earlier in the take: the viewer sees the screen arrive.
      const back = r3(Math.min(take.from, want - take.span + 0.1));
      take.from = r3(take.from - back);
      take.span = r3(take.span + back);
    }
    if (take) {
      if (want > take.span + 0.05)
        warnings.push(`scene "${sc.id}": the voice needs ${want.toFixed(1)} s but the take has ${take.span.toFixed(1)} s of footage from ${take.from.toFixed(1)} s — the last frame holds; trim the line or start the take earlier`);
      d = Math.max(want, Math.min(take.span, want + 0.2));
    }
    const p: Planned = { sc, i, start: r3(t), duration: r3(d), vo, take };
    t += d;
    return p;
  });
  const total = r3(t);
  if (spec.target && Math.abs(total - spec.target) / spec.target > 0.08) warnings.push(`${spec.target} s cut came out ${total.toFixed(1)} s`);
  // Captions show the script, so a line written the way it's said ("Edge Track") shows the respelling on screen.
  for (const [written, said] of Object.entries(spec.voice?.pronounce ?? {}))
    for (const sc of spec.scenes)
      if (said && said.toLowerCase() !== written.toLowerCase() && sc.vo?.toLowerCase().includes(said.toLowerCase()))
        warnings.push(`scene "${sc.id}": the line says "${said}" — write "${written}" (the pronunciation takes care of how it's said; captions show the line as written)`);

  // 4. Layout.
  const phoneTake = takes.find((x) => x?.device === 'phone');
  const deskTake = takes.find((x) => x?.device === 'desk');
  const L = layout(vertical, phoneTake ? phoneTake.height / phoneTake.width : 2532 / 1170, deskTake ? deskTake.height / deskTake.width : 1800 / 2880);
  const { W, H, SW, SH, BEZ, RAD, SX, SY, DW, DH, DX, DY, CHROME } = L;
  const screenOf = (p: Planned): Rect => (p.take?.device === 'desk' ? { x: DX, y: DY + CHROME, w: DW, h: DH } : { x: SX, y: SY, w: SW, h: SH });
  const deviceId = (p: Planned) => (p.take?.device === 'desk' ? (vertical ? '#pane' : '#win') : '#rig');

  // Taps on the film's clock.
  const tapsIn = (p: Planned) => (p.take?.log?.taps ?? []).filter((x) => x.at >= p.take!.from && x.at <= p.take!.from + p.duration).map((x) => ({ ...x, g: r3(p.start + x.at - p.take!.from) }));
  const zoomOf = (p: Planned) => (p.sc.zoom?.length ? p.sc.zoom : [[0, 1, 0.5, 0.5] as [number, number, number, number]]);
  /** A point on the recording (fractions) → canvas pixels, given the zoom at that moment. */
  const screenPoint = (p: Planned, fx: number, fy: number, at: number) => {
    const z = zoomOf(p);
    const rel = (at - p.start) / p.duration;
    let k = z[0];
    for (const zz of z) if (zz[0] <= rel) k = zz;
    const [, s, ox, oy] = k;
    const r = screenOf(p);
    return { x: r.x + (ox + (fx - ox) * s) * r.w, y: r.y + (oy + (fy - oy) * s) * r.h };
  };
  /** When the voice says a word starting like `stem` (after `after`), on the film's clock. */
  const voAt = (p: Planned, stem: string, after: number, fallback: number) => {
    const w = p.vo?.words.find((x) => x.start + p.start + LEAD > after && norm(x.text).startsWith(stem));
    return r3(w ? p.start + LEAD + w.start : fallback);
  };

  // 5. Fonts.
  const fonts = await localizeFonts([spec.brand.fonts.display, spec.brand.fonts.serif ?? '', spec.brand.fonts.body].filter(Boolean), join(dir, 'assets', 'fonts'), 'assets/fonts');
  const logo = spec.brand.logo ? await asset(spec.brand.logo) : '';
  if (spec.brand.logo && /\.png$/i.test(spec.brand.logo) && (await logoHasOpaqueCorners(spec.brand.logo, join(dir, 'assets'))))
    warnings.push(`brand.logo: the corners of ${basename(spec.brand.logo)} are opaque — it likely has a background box; use a transparent PNG`);

  let html = '';
  let js = '';
  const add = (s: string) => (html += s + '\n');
  const tl = (s: string) => (js += s + '\n');

  // Background: brand ground, a slow drifting glow, fine grain.
  add(`<div id="bg" class="clip" data-start="0" data-duration="${total}" data-track-index="0"><div class="bgf"></div><div class="glow g1"></div><div class="glow g2"></div><div class="grain"></div></div>`);
  tl(`tl.fromTo("#bg .g1",{x:${vertical ? -60 : -120},y:0,opacity:.55},{x:${vertical ? 60 : 120},y:${vertical ? 80 : 40},opacity:.85,duration:${total},ease:"sine.inOut"},0);`);
  tl(`tl.fromTo("#bg .g2",{x:${vertical ? 40 : 90},opacity:.35},{x:${vertical ? -40 : -90},opacity:.6,duration:${total},ease:"sine.inOut"},0);`);

  // 6. Devices. Each device element is untimed; its frame and recordings are timed children,
  // so videos never sit inside a timed wrapper and nothing backs the screen once a run ends.
  const runsOf = (pred: (p: Planned) => boolean) => {
    const runs: { start: number; end: number; scenes: Planned[] }[] = [];
    for (const p of plan.filter(pred)) {
      const last = runs.at(-1);
      if (last && Math.abs(last.end - p.start) < 0.01 && !last.scenes.at(-1)!.sc.dive) {
        last.end = r3(p.start + p.duration);
        last.scenes.push(p);
      } else runs.push({ start: p.start, end: r3(p.start + p.duration), scenes: [p] });
    }
    return runs;
  };
  /** `aspect` set: the recording keeps its shape, fills the height and is cropped around the scene's focus (zoom origin). */
  const screenVideos = (ps: Planned[], r: Rect, aspect?: number) =>
    ps
      .map((p) => {
        const vw = aspect ? Math.max(r.w, Math.round(r.h / aspect)) : r.w;
        const fx = p.sc.zoom?.[0]?.[2] ?? 0.5;
        const ox = aspect ? -Math.round((vw - r.w) * fx) : 0;
        const ripples = tapsIn(p)
          .filter((x) => x.g < p.start + p.duration - 0.3)
          .map((x, k) => `<div id="tp-${p.sc.id}-${k}" class="clip tap" data-start="${x.g}" data-duration="0.6" data-track-index="${7 + (k % 2)}" style="left:${Math.round(x.x * vw) + ox - 40}px;top:${Math.round(x.y * r.h) - 40}px"><u></u></div>`)
          .join('');
        return `<div class="zoom" id="z-${p.sc.id}" style="width:${r.w}px;height:${r.h}px"><video id="v-${p.sc.id}" src="${p.take!.rel}" muted playsinline data-start="${p.start}" data-duration="${p.duration}" data-media-start="${p.take!.from}" data-track-index="2" data-has-audio="false" data-volume="0" style="position:absolute;left:${ox}px;top:0;width:${vw}px;height:${r.h}px;object-fit:cover"></video>${ripples}</div>`;
      })
      .join('\n');

  const phoneRuns = runsOf((p) => p.take?.device === 'phone');
  if (phoneRuns.length) {
    add(`<div id="rig" style="position:absolute;left:${SX - BEZ}px;top:${SY - BEZ}px;width:${SW + 2 * BEZ}px;height:${SH + 2 * BEZ}px">`);
    phoneRuns.forEach((r, k) => add(`<div id="bz${k}" class="clip" data-start="${r.start}" data-duration="${r3(r.end - r.start)}" data-track-index="1"><div class="bz"></div><div class="btn b1"></div><div class="btn b2"></div><div class="btn b3"></div></div>`));
    add(`<div id="screen" style="position:absolute;left:${BEZ}px;top:${BEZ}px;width:${SW}px;height:${SH}px;border-radius:${RAD - BEZ}px;overflow:hidden">`);
    add(screenVideos(phoneRuns.flatMap((r) => r.scenes), { x: SX, y: SY, w: SW, h: SH }));
    add(`<div class="glass"></div></div></div>`);
    tl(`tl.set("#rig",{opacity:0},0);`);
    for (const r of phoneRuns) {
      tl(`tl.fromTo("#rig",{y:${vertical ? 260 : 200},rotationX:${vertical ? 18 : 10},rotationY:${vertical ? -16 : -22},scale:.9,opacity:0,transformPerspective:2200},{y:0,rotationX:0,rotationY:${vertical ? -4 : -8},scale:1,opacity:1,duration:1.1,ease:"expo.out",immediateRender:false},${r.start});`);
      tl(`tl.fromTo("#rig",{rotationY:${vertical ? -4 : -8},y:0},{rotationY:${vertical ? 4 : -2},y:${vertical ? -8 : -6},duration:${r3(Math.max(0.5, r.end - r.start - 1.4))},ease:"sine.inOut",immediateRender:false},${r3(r.start + 1.1)});`);
      if (!r.scenes.at(-1)!.sc.dive) tl(`tl.fromTo("#rig",{opacity:1},{opacity:0,duration:.3,immediateRender:false},${r3(r.end - 0.3)});`);
    }
  }
  const deskRuns = runsOf((p) => p.take?.device === 'desk');
  if (deskRuns.length && !vertical) {
    add(`<div id="win" style="position:absolute;left:${DX}px;top:${DY}px;width:${DW}px;height:${DH + CHROME}px">`);
    deskRuns.forEach((r, k) => add(`<div id="wc${k}" class="clip" data-start="${r.start}" data-duration="${r3(r.end - r.start)}" data-track-index="1"><div class="wframe"></div><div class="wchrome"><i></i><i></i><i></i></div></div>`));
    add(`<div id="wscreen" style="position:absolute;left:0;top:${CHROME}px;width:${DW}px;height:${DH}px;overflow:hidden;border-radius:0 0 14px 14px">`);
    add(screenVideos(deskRuns.flatMap((r) => r.scenes), { x: DX, y: DY + CHROME, w: DW, h: DH }));
    add(`</div></div>`);
    tl(`tl.set("#win",{opacity:0},0);`);
    for (const r of deskRuns) {
      tl(`tl.fromTo("#win",{x:140,rotationY:-14,opacity:0,transformPerspective:2400},{x:0,rotationY:-5,opacity:1,duration:1,ease:"expo.out",immediateRender:false},${r.start});`);
      tl(`tl.fromTo("#win",{rotationY:-5},{rotationY:-2,duration:${r3(Math.max(0.5, r.end - r.start - 1.3))},ease:"sine.inOut",immediateRender:false},${r3(r.start + 1)});`);
      if (!r.scenes.at(-1)!.sc.dive) tl(`tl.fromTo("#win",{opacity:1},{opacity:0,duration:.3,immediateRender:false},${r3(r.end - 0.3)});`);
    }
  } else if (deskRuns.length) {
    add(`<div id="pane" style="position:absolute;left:${DX}px;top:${DY}px;width:${DW}px;height:${DH}px">`);
    deskRuns.forEach((r, k) => add(`<div id="pf${k}" class="clip" data-start="${r.start}" data-duration="${r3(r.end - r.start)}" data-track-index="1"><div class="pframe"></div></div>`));
    add(`<div id="pscreen" style="position:absolute;left:0;top:0;width:${DW}px;height:${DH}px;overflow:hidden;border-radius:22px">`);
    add(screenVideos(deskRuns.flatMap((r) => r.scenes), { x: DX, y: DY, w: DW, h: DH }, L.deskAspect));
    add(`</div></div>`);
    tl(`tl.set("#pane",{opacity:0},0);`);
    for (const r of deskRuns) {
      tl(`tl.fromTo("#pane",{y:160,rotationX:12,scale:.94,opacity:0,transformPerspective:2200},{y:0,rotationX:0,scale:1,opacity:1,duration:1,ease:"expo.out",immediateRender:false},${r.start});`);
      tl(`tl.fromTo("#pane",{y:0},{y:-8,duration:${r3(Math.max(0.5, r.end - r.start - 1.3))},ease:"sine.inOut",immediateRender:false},${r3(r.start + 1)});`);
      if (!r.scenes.at(-1)!.sc.dive) tl(`tl.fromTo("#pane",{opacity:1},{opacity:0,duration:.3,immediateRender:false},${r3(r.end - 0.3)});`);
    }
  }
  // Camera: restrained zoom keyframes per scene, a tap ripple at each logged tap, and the dive.
  for (const p of plan.filter((x) => x.take)) {
    const z = zoomOf(p);
    const Z = `#z-${p.sc.id}`;
    const origin = (k: number[]) => `"${r3(k[2] * 100)}% ${r3(k[3] * 100)}%"`;
    tl(`tl.set("${Z}",{scale:${z[0][1]},transformOrigin:${origin(z[0])}},${p.start});`);
    for (let k = 1; k < z.length; k++) {
      const at = r3(p.start + p.duration * z[k][0]);
      const dur = r3(Math.max(0.4, Math.min(p.start + p.duration - at - 0.1, p.duration * ((z[k + 1]?.[0] ?? 1) - z[k][0]) - 0.2)));
      tl(`tl.fromTo("${Z}",{scale:${z[k - 1][1]},transformOrigin:${origin(z[k - 1])}},{scale:${z[k][1]},transformOrigin:${origin(z[k])},duration:${dur},ease:"power2.inOut",immediateRender:false},${at});`);
    }
    tapsIn(p).forEach((x, k) => {
      if (x.g >= p.start + p.duration - 0.3) return;
      tl(`tl.fromTo("#tp-${p.sc.id}-${k} u",{scale:.35,opacity:.95},{scale:1.5,opacity:0,duration:.55,ease:"power2.out"},${x.g});`);
    });
    if (p.sc.dive) {
      const last = z.at(-1)!;
      tl(`tl.fromTo("${Z}",{scale:${last[1]}},{scale:2.6,transformOrigin:"50% 48%",duration:.75,ease:"power3.in",immediateRender:false},${r3(p.start + p.duration - 0.78)});`);
      tl(`tl.fromTo("${deviceId(p)}",{scale:1,opacity:1},{scale:1.35,opacity:0,duration:.6,ease:"power3.in",immediateRender:false},${r3(p.start + p.duration - 0.55)});`);
    }
  }

  // 7. Scenes.
  const T = L.text;
  let calloutTrack = 0;
  for (const p of plan) {
    let { sc } = p;
    const S = `#g-${sc.id}`;
    const st = p.start;
    const d = p.duration;
    const open = (inner: string) => add(`<div id="g-${sc.id}" class="clip" data-start="${st}" data-duration="${d}" data-track-index="3">${inner}</div>`);
    const exit = (sel: string) => tl(`tl.fromTo("${sel}",{opacity:1},{opacity:0,duration:.3,immediateRender:false},${r3(st + d - 0.3)});`);
    const words = (cls: string, text?: string) => (text ? `<div class="${cls}">${esc(text)}</div>` : '');
    const textIn = () => {
      if (sc.kick) tl(`tl.fromTo("${S} .kick",{opacity:0,y:-10},{opacity:1,y:0,duration:.45},${r3(st + 0.2)});`);
      if (sc.head) tl(`tl.fromTo("${S} .head",{opacity:0,yPercent:40,clipPath:"inset(0 0 100% 0)"},{opacity:1,yPercent:0,clipPath:"inset(0 0 0% 0)",duration:.7,ease:"expo.out"},${r3(st + 0.28)});`);
      if (sc.sub) tl(`tl.fromTo("${S} .sub",{opacity:0,y:14},{opacity:1,y:0,duration:.6},${r3(st + 0.6)});`);
    };

    if (sc.kind === 'ui' || (sc.kind === 'bumper' && p.take)) {
      // Pipeline: a frosted panel whose steps draw on as the voice names them.
      const steps = sc.pipeline ?? [];
      const pipe = steps.length
        ? `<div class="pipe">${steps.map((lab, k) => `<div class="pn n${k}"><b><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/></svg></b><span>${esc(lab)}</span></div>${k < steps.length - 1 ? `<div class="pl pl${k}"></div>` : ''}`).join('')}</div>`
        : '';
      const deskLeft = !vertical && p.take?.device === 'desk';
      open(`<div class="side${deskLeft ? ' sdesk' : ''}">${words('kick', sc.kick)}${words('head', sc.head)}${words('sub', sc.sub)}${vertical ? '' : pipe}</div>${vertical && pipe ? `<div class="vpipe">${pipe}</div>` : ''}`);
      textIn();
      if (steps.length) {
        let after = st;
        steps.forEach((lab, k) => {
          const w = norm(lab.split(/\s+/)[0]);
          const stem = w.slice(0, Math.max(3, Math.min(6, w.length - 2)));
          const fb = r3(st + LEAD + ((p.vo?.duration ?? d - 1) * (k + 0.5)) / steps.length);
          const at = Math.min(r3(st + d - 0.6), voAt(p, stem, after, fb));
          after = at;
          tl(`tl.fromTo("${S} .n${k}",{opacity:.22,scale:.85},{opacity:1,scale:1,duration:.45,ease:"back.out(2.2)"},${at});tl.fromTo("${S} .n${k} path",{strokeDashoffset:1},{strokeDashoffset:0,duration:.5},${r3(at + 0.1)});`);
          if (k < steps.length - 1) tl(`tl.fromTo("${S} .pl${k}",{scaleX:0},{scaleX:1,duration:.5,ease:"power2.inOut"},${r3(at + 0.25)});`);
        });
        if (vertical) tl(`tl.fromTo("${S} .vpipe",{opacity:0,y:-16},{opacity:1,y:0,duration:.5,ease:"expo.out"},${r3(st + 0.5)});`);
      }
      exit(`${S}`);

      // Callouts: outside the device, at the real tap moments, short-lived.
      const taps = tapsIn(p);
      let list: { text: string; g: number; side?: 'left' | 'right'; tap?: (typeof taps)[number] }[] = [];
      if (sc.callouts === 'taps') {
        list = taps.map((x) => ({ text: x.label, g: x.g, tap: x }));
        if (!list.length) warnings.push(`scene "${sc.id}": callouts "taps" but no taps fall inside the take window`);
      } else if (Array.isArray(sc.callouts))
        list = sc.callouts.map((c, k) => {
          const byLabel = taps.find((x) => norm(x.label) === norm(c.text));
          const g = c.at !== undefined ? r3(st + c.at) : byLabel?.g ?? taps[k]?.g ?? r3(st + 0.6 + k * 1.6);
          const tap = taps.filter((x) => Math.abs(x.g - g) < 0.6).sort((a, b) => Math.abs(a.g - g) - Math.abs(b.g - g))[0] ?? byLabel;
          return { text: c.text, g, side: c.side, tap };
        });
      const r = screenOf(p);
      const desk = p.take?.device === 'desk';
      list.forEach((c, k) => {
        const len = r3(Math.min(2.2, st + d - c.g - 0.35));
        if (len < 0.8) return;
        const pt = screenPoint(p, c.tap ? c.tap.x : 0.5, c.tap ? c.tap.y : 0.3 + 0.18 * (k % 4), c.g + 0.2);
        const id = `co-${sc.id}-${k}`;
        let pos: string;
        let dx = 0;
        let dy = 0;
        if (desk) {
          // Desktop screens fill their side of the frame: the label sits just under the window, at the tap's x.
          const x = Math.round(Math.max(r.x, Math.min(r.x + r.w - 300, pt.x - 120)));
          pos = `left:${x}px;top:${r.y + r.h + 16}px;flex-direction:column;align-items:flex-start;height:auto`;
          dy = -16;
        } else {
          // Beside the phone: the open side in 16:9 is the left, in 9:16 the right (clear of the text above).
          const side = c.side ?? (vertical ? 'right' : 'left');
          const y = Math.round(Math.max(r.y + 30, Math.min(r.y + r.h - 30, pt.y)));
          pos = side === 'left' ? `right:${W - (SX - BEZ) + 10}px;flex-direction:row-reverse;top:${y - 30}px` : `left:${SX + SW + BEZ + 10}px;top:${y - 30}px`;
          dx = side === 'left' ? 20 : -20;
        }
        add(`<div id="${id}" class="clip co${desk ? ' cod' : ''}" data-start="${r3(c.g + 0.2)}" data-duration="${len}" data-track-index="${4 + (calloutTrack++ % 3)}" style="${pos}"><i></i><span>${esc(c.text)}</span></div>`);
        tl(`tl.fromTo("#${id} span",{opacity:0,x:${dx},y:${dy},scale:.85},{opacity:1,x:0,y:0,scale:1,duration:.4,ease:"back.out(2)"},${r3(c.g + 0.25)});tl.fromTo("#${id}",{opacity:1},{opacity:0,duration:.2,immediateRender:false},${r3(c.g + len)});`);
      });
    } else if (sc.kind === 'title') {
      const mark = sc.mark === false ? '' : logo ? `<div class="lg"><img src="${logo}" alt="${esc(spec.brand.name)}"><div class="shine" style="-webkit-mask-image:url(${logo});mask-image:url(${logo})"><div class="glint"><i></i></div></div></div>` : `<div class="nm">${esc(spec.brand.name)}</div>`;
      open(`<div class="title">${mark}${words('kick', sc.kick)}${words('head', sc.head)}${words('sub', sc.sub)}</div>`);
      if (sc.mark !== false && logo) tl(`tl.fromTo("${S} .lg",{clipPath:"inset(0 100% 0 0)",scale:1.08},{clipPath:"inset(0 0% 0 0)",scale:1,duration:.9,ease:"expo.out"},${r3(st + 0.05)});tl.fromTo("${S} .glint",{xPercent:-150},{xPercent:400,duration:.9,ease:"power2.inOut"},${r3(st + 0.7)});`);
      else if (sc.mark !== false) tl(`tl.fromTo("${S} .nm",{opacity:0,scaleX:.8},{opacity:1,scaleX:1,duration:.8,ease:"expo.out"},${r3(st + 0.1)});`);
      textIn();
      exit(`${S} .title`);
    } else if (sc.kind === 'card') {
      const prev = plan[p.i - 1];
      const dived = !!sc.dive || !!prev?.sc.dive;
      const img = sc.image ? await asset(sc.image) : '';
      const pi = sc.image ? (await probe(sc.image).catch(() => null))?.video : undefined;
      const aspect = pi?.width && pi.height ? pi.width / pi.height : 1;
      // The image fits its box: centred in 9:16 under the text; right of the text in 16:9 when there's a headline.
      const box = vertical ? { x: 80, y: 430, w: 920, h: 1040 } : sc.head ? { x: 780, y: 110, w: 1020, h: 800 } : { x: 260, y: 90, w: 1400, h: 820 };
      const iw = Math.round(Math.min(box.w, box.h * aspect));
      const ih = Math.round(iw / aspect);
      const frame = img ? `<div class="cw" style="left:${Math.round(box.x + (box.w - iw) / 2)}px;top:${Math.round(box.y + (box.h - ih) / 2)}px;width:${iw}px;height:${ih}px"><img src="${img}" alt=""><div class="sweep"><i></i></div></div>` : '';
      open(`<div class="card">${img && dived ? `<div class="cbg" style="background-image:url('${img}')"></div>` : ''}<div class="cglow"></div>${frame}<div class="side ${img ? 'cside' : 'cbig'}">${words('kick', sc.kick)}${words('head', sc.head)}${words('sub', sc.sub)}</div></div>`);
      if (dived && img) {
        // Landing from the push: the result arrives full-screen, turning in out of the zoom.
        tl(`tl.fromTo("${S} .cbg",{opacity:0,scale:1.25},{opacity:1,scale:1,duration:1.1,ease:"expo.out"},${st});tl.fromTo("${S} .cw",{scale:1.7,rotationY:-26,rotationX:10,opacity:0,transformPerspective:1600},{scale:1,rotationY:0,rotationX:0,opacity:1,duration:1.15,ease:"expo.out"},${r3(st + 0.02)});`);
      } else if (img) tl(`tl.fromTo("${S} .cw",{rotationY:-50,rotationX:12,scale:.7,opacity:0,transformPerspective:1600},{rotationY:0,rotationX:0,scale:1,opacity:1,duration:1.2,ease:"expo.out"},${r3(st + 0.05)});`);
      tl(`tl.fromTo("${S} .cglow",{opacity:0,scale:.5},{opacity:1,scale:1,duration:1.3,ease:"expo.out"},${st});`);
      if (img) tl(`tl.fromTo("${S} .sweep",{xPercent:-170},{xPercent:420,duration:1.4,ease:"power2.inOut"},${r3(st + 0.9)});tl.fromTo("${S} .cw",{rotationY:0,rotationX:0,y:0},{rotationY:6,rotationX:-3,y:${vertical ? -12 : -8},duration:${r3(Math.max(0.5, d - 1.6))},ease:"sine.inOut",immediateRender:false},${r3(st + 1.25)});`);
      textIn();
      exit(`${S} .card`);
    } else if (sc.kind === 'cta') {
      // The URL gets its own pill; a sub line that only repeats it is dropped.
      const norm = (u?: string) => (u ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\.|\/$/g, '');
      if (spec.brand.url && norm(sc.sub) === norm(spec.brand.url)) sc = { ...sc, sub: undefined };
      const mark = logo ? `<div class="mark"><img src="${logo}" alt="${esc(spec.brand.name)}"><div class="shine" style="-webkit-mask-image:url(${logo});mask-image:url(${logo})"><div class="glint"><i></i></div></div></div>` : `<div class="nm">${esc(spec.brand.name)}</div>`;
      open(`<div class="cta">${mark}${words('kick', sc.kick)}${words('head', sc.head)}${words('sub', sc.sub)}${spec.brand.url ? `<div class="url">${esc(spec.brand.url)}</div>` : ''}</div>`);
      if (logo) tl(`tl.fromTo("${S} .mark",{clipPath:"inset(0 100% 0 0)",x:-30},{clipPath:"inset(0 0% 0 0)",x:0,duration:.8,ease:"expo.out"},${r3(st + 0.05)});tl.fromTo("${S} .glint",{xPercent:-160},{xPercent:400,duration:.8,ease:"power2.inOut"},${r3(st + 0.55)});`);
      else tl(`tl.fromTo("${S} .nm",{opacity:0,scaleX:.8},{opacity:1,scaleX:1,duration:.8,ease:"expo.out"},${r3(st + 0.05)});`);
      const items = ['kick', 'head', 'sub'].filter((k) => sc[k as 'kick']).map((k) => `${S} .${k}`);
      if (items.length) tl(`tl.fromTo("${items.join(',')}",{opacity:0,y:22},{opacity:1,y:0,duration:.6,stagger:.18,ease:"expo.out"},${r3(st + 0.75)});`);
      if (spec.brand.url) tl(`tl.fromTo("${S} .url",{opacity:0,scale:.85},{opacity:1,scale:1,duration:.5,ease:"back.out(2)"},${r3(st + 1.4)});`);
    } else if (sc.kind === 'badges') {
      // Chips wipe in on the word that names them, like the speed bars of a scoreboard.
      const items = sc.items ?? [];
      const chips = items.map((x, k) => `<div class="chip c${k}"><b></b><span>${esc(x)}</span></div>`).join('');
      open(`<div class="badges">${words('kick', sc.kick)}${words('head', sc.head)}<div class="chips n${items.length}">${chips}</div>${words('sub', sc.sub)}</div>`);
      textIn();
      let last = st + 0.5;
      items.forEach((x, k) => {
        const at = voAt(p, norm(x.split(/\s+/)[0]), last - 0.01, Math.min(st + d - 1, st + 0.6 + k * Math.min(0.45, (d - 1.6) / items.length)));
        last = Math.max(last, at);
        tl(`tl.fromTo("${S} .c${k}",{opacity:0,x:-40,clipPath:"inset(0 100% 0 0)"},{opacity:1,x:0,clipPath:"inset(0 0% 0 0)",duration:.5,ease:"expo.out"},${r3(at)});tl.fromTo("${S} .c${k} b",{scaleY:0},{scaleY:1,duration:.35,ease:"power3.out"},${r3(at + 0.12)});`);
      });
      exit(`${S} .badges`);
    } else if (sc.kind === 'stat') {
      // Scoreboard digits: each digit is a drum of 0–9 that rolls to its value, so every frame is exact.
      const stats = sc.stats ?? [];
      const drum = (v: number, cls: string) => String(v).split('').map((dg, k) => `<span class="dr ${cls}-${k}" data-d="${dg}"><i>${'0123456789'.split('').map((n) => `<em>${n}</em>`).join('')}</i></span>`).join('');
      open(`<div class="stats">${words('kick', sc.kick)}${words('head', sc.head)}<div class="srow n${stats.length}">${stats.map((x, k) => `<div class="st s${k}"><div class="num">${drum(x.value, `d${k}`)}${x.suffix ? `<span class="sx">${esc(x.suffix)}</span>` : ''}</div><div class="lab">${esc(x.label)}</div></div>`).join('')}</div>${words('sub', sc.sub)}</div>`);
      textIn();
      let last = st + 0.5;
      stats.forEach((x, k) => {
        const at = voAt(p, norm(x.label.split(/\s+/)[0]), last - 0.01, st + 0.6 + k * 0.5);
        const start = r3(Math.max(st + 0.4, Math.min(at, st + d - 1.4) - 0.6));
        last = Math.max(last, at);
        tl(`tl.fromTo("${S} .s${k}",{opacity:0,y:30},{opacity:1,y:0,duration:.5,ease:"expo.out"},${start});`);
        String(x.value).split('').forEach((dg, j) => tl(`tl.fromTo("${S} .d${k}-${j} i",{yPercent:0},{yPercent:${-Number(dg) * 10},duration:${r3(0.9 + j * 0.15)},ease:"power3.out"},${start});`));
      });
      exit(`${S} .stats`);
    } else if (sc.kind === 'bumper') {
      open(`<div class="bump">${logo ? `<img class="bl" src="${logo}" alt="${esc(spec.brand.name)}">` : ''}${words('head', sc.head ?? spec.brand.name)}${words('sub', sc.sub)}</div>`);
      tl(`tl.fromTo("${S} .bump .head",{opacity:0,yPercent:60},{opacity:1,yPercent:0,duration:.6,ease:"expo.out"},${r3(st + 0.25)});`);
      if (sc.sub) tl(`tl.fromTo("${S} .bump .sub",{opacity:0,y:16},{opacity:1,y:0,duration:.6,ease:"expo.out"},${r3(st + 0.6)});`);
      if (logo) tl(`tl.fromTo("${S} .bl",{opacity:0},{opacity:1,duration:.5},${r3(st + 0.1)});`);
      exit(`${S} .bump`);
    }
  }

  // 8. Captions: phrase-led cues per scene (never across a cut); the spoken word lights up.
  const words: Word[] = [];
  const cues: (Cue & { device: boolean; desk: boolean })[] = [];
  for (const p of plan) {
    if (!p.vo?.words.length) continue;
    const ws = p.vo.words.map((w) => ({ text: w.text, start: r3(w.start + p.start + LEAD), end: r3(w.end + p.start + LEAD) }));
    words.push(...ws);
    for (const c of phraseCues(ws)) cues.push({ ...c, end: r3(Math.min(c.end, p.start + p.duration - 0.05)), device: !!p.take, desk: p.take?.device === 'desk' });
  }
  for (let k = 0; k < cues.length - 1; k++) if (cues[k].end > cues[k + 1].start - 0.01) cues[k].end = r3(cues[k + 1].start - 0.01);
  const hi = spec.brand.colors.highlight ?? spec.brand.colors.accent;
  cues.forEach((c, k) => {
    const inner = c.words.map((w, j) => `<b id="w${k}_${j}">${esc(w.text)}</b>`).join(' ');
    add(`<div id="cap${k}" class="clip cap ${c.device ? 'capd' : 'capw'}" data-start="${r3(c.start)}" data-duration="${r3(Math.max(0.3, c.end - c.start))}" data-track-index="9"><span>${inner}</span></div>`);
    tl(`tl.fromTo("#cap${k} span",{opacity:0,y:10},{opacity:1,y:0,duration:.16},${r3(c.start)});`);
    c.words.forEach((w, j) => tl(`tl.set("#w${k}_${j}",{color:"${hi}"},${r3(w.start)});tl.set("#w${k}_${j}",{color:"${spec.brand.colors.ink}"},${r3(Math.max(w.start + 0.05, w.end))});`));
  });
  const srt = cues.length ? join(dir, 'captions.srt') : null;
  if (srt) await writeFile(srt, toSrt(cues));

  // 9. Sound: one voice track, a score with an energy arc and SFX on cuts, taps, the card and the CTA; then the mix.
  let audio: string | null = null;
  const withVoice = plan.filter((p) => p.vo);
  let voiceTrack: string | null = null;
  if (withVoice.length) {
    voiceTrack = join(dir, 'assets', 'voice.wav');
    const inputs = withVoice.flatMap((p) => ['-i', p.vo!.file]);
    const delays = withVoice.map((p, k) => `[${k}:a]aresample=48000,adelay=${Math.round((p.start + LEAD) * 1000)}:all=1[v${k}]`).join(';');
    const graph = `${delays};${withVoice.map((_, k) => `[v${k}]`).join('')}amix=inputs=${withVoice.length}:normalize=0:duration=longest,apad=whole_dur=${total}[out]`;
    const r = await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-t', String(total), '-ac', '1', voiceTrack], { timeoutMs: 300_000 });
    if (r.code !== 0) throw new Error(`voice track failed: ${r.stderr.slice(-300)}`);
  }
  let music: string | null = null;
  if (spec.music !== null) {
    const mood = (spec.music?.mood ?? 'uplifting') as Mood;
    const level: Record<FilmKind, number> = { title: 0.5, ui: 0.62, card: 1, cta: 0.85, bumper: 0.9, badges: 0.75, stat: 0.8 };
    const energy = [{ at: 0, level: 0.3 }, ...plan.map((p) => ({ at: p.start, level: level[p.sc.kind] }))];
    const sfx: FilmSfx[] = [];
    for (const p of plan) {
      if (p.start > 0.3) sfx.push({ kind: 'whoosh', at: r3(p.start - 0.14), gain: plan[p.i - 1]?.sc.dive ? 0.3 : 0.13 });
      if (p.sc.kind === 'card') sfx.push({ kind: 'riser', at: r3(Math.max(0, p.start - 1.4)), gain: 0.2 }, { kind: 'impact', at: r3(p.start + 0.05), gain: 0.22 });
      if (p.sc.kind === 'cta') sfx.push({ kind: 'impact', at: r3(p.start + 0.15), gain: 0.16 });
      if (p.sc.kind === 'stat') sfx.push({ kind: 'riser', at: r3(Math.max(0, p.start - 0.8)), gain: 0.14 }, { kind: 'impact', at: r3(p.start + 1.3), gain: 0.14 });
      if (p.sc.kind === 'badges') (p.sc.items ?? []).forEach((_, k) => sfx.push({ kind: 'pop', at: r3(p.start + 0.7 + k * 0.4), gain: 0.18 }));
      for (const x of tapsIn(p)) sfx.push({ kind: 'tick', at: x.g, gain: 0.32 });
    }
    music = (await deps.music(mood, r3(total + 0.6), sfx, join(dir, 'assets', 'music.wav'), energy, { bpm: spec.music?.bpm, seed: spec.music?.seed })).file || null;
  }
  if (voiceTrack || music) audio = (await deps.mix(voiceTrack, music, join(dir, 'assets', 'mix.wav'), total, -18)).file;
  let audioRel = '';
  if (audio) {
    audioRel = `assets/${basename(audio)}`;
    if (audio !== join(dir, audioRel)) await copyFile(audio, join(dir, audioRel));
    add(`<audio id="mix" src="${audioRel}" data-start="0" data-duration="${total}" data-track-index="10" data-volume="1"></audio>`);
  }

  // 10. Page.
  const C = spec.brand.colors;
  const fam = (f: string | undefined, fb: string) => (f ? `'${f}', ${fb}` : fb);
  const FD = fam(spec.brand.fonts.display, 'system-ui, sans-serif');
  const FS = fam(spec.brand.fonts.serif, FD);
  const FB = fam(spec.brand.fonts.body, 'system-ui, sans-serif');
  const cap = (c: typeof L.capDevice) => `left:${c.left}px;right:${c.right}px;top:${c.top}px;justify-content:${c.align === 'center' ? 'center' : 'flex-start'}`;
  const css = `${fonts.css}
:root{--bg:${C.bg};--ink:${C.ink};--accent:${C.accent};--hi:${hi};--fd:${FD};--fs:${FS};--fb:${FB}}
html,body{margin:0;background:var(--bg)}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:var(--fb);color:var(--ink);background:var(--bg)}
.clip{position:absolute;inset:0}
#bg .bgf{position:absolute;inset:0;background:radial-gradient(110% 70% at 50% ${vertical ? '36%' : '42%'},color-mix(in srgb,var(--accent) 16%,var(--bg)) 0%,var(--bg) 72%)}
#bg .glow{position:absolute;border-radius:50%;filter:blur(60px)}
#bg .g1{left:${vertical ? -260 : -200}px;top:${vertical ? -200 : -300}px;width:${vertical ? 900 : 1100}px;height:${vertical ? 900 : 1100}px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 30%,transparent),transparent 65%)}
#bg .g2{right:${vertical ? -300 : -260}px;bottom:${vertical ? -200 : -360}px;width:${vertical ? 900 : 1000}px;height:${vertical ? 900 : 1000}px;background:radial-gradient(circle,color-mix(in srgb,var(--hi) 22%,transparent),transparent 65%)}
#bg .grain{position:absolute;inset:0;opacity:.07;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.bz{position:absolute;inset:0;border-radius:${RAD}px;background:linear-gradient(145deg,#2a3036,#0a0c0e 40%,#16191c);box-shadow:0 60px 140px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.08),inset 0 0 0 2px rgba(255,255,255,.07)}
.btn{position:absolute;width:5px;border-radius:3px;background:#2a3036}.b1{left:-4px;top:22%;height:7%}.b2{left:-4px;top:31%;height:7%}.b3{right:-4px;top:26%;height:11%}
.glass{position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,0) 28%,rgba(255,255,255,0) 70%,rgba(255,255,255,.05) 100%)}
.zoom{position:absolute;left:0;top:0}
.tap{inset:auto;width:80px;height:80px}.tap u{display:block;width:80px;height:80px;border-radius:50%;border:4px solid var(--hi);background:color-mix(in srgb,var(--hi) 25%,transparent);box-sizing:border-box}
.wframe{position:absolute;inset:0;border-radius:16px;box-shadow:0 60px 140px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08)}
.wchrome{position:absolute;left:0;top:0;right:0;height:${CHROME}px;border-radius:16px 16px 0 0;background:#e9edf0;display:flex;align-items:center;gap:9px;padding-left:18px}
.wchrome i{display:block;width:13px;height:13px;border-radius:50%;background:#ff5f57}.wchrome i:nth-child(2){background:#febc2e}.wchrome i:nth-child(3){background:#28c840}
.pframe{position:absolute;inset:-10px;border-radius:30px;background:#111417;box-shadow:0 50px 120px rgba(0,0,0,.5),0 0 0 2px rgba(255,255,255,.08)}
.side{position:absolute;left:${T.left}px;right:${T.right}px;top:${T.top}px;text-align:${T.align}}
.sdesk{right:${W - DX + 50}px}
.kick{font:700 ${T.kick}px/1 var(--fb);letter-spacing:.24em;text-transform:uppercase;color:var(--accent)}
.head{margin-top:${vertical ? 14 : 18}px;font:800 ${T.head}px/0.98 var(--fd);text-wrap:balance}
.sub{margin-top:${vertical ? 12 : 18}px;font:400 ${T.sub}px/1.15 var(--fs);opacity:.86;text-wrap:balance}
.pipe{display:flex;align-items:flex-start;${vertical ? 'justify-content:center;' : ''}gap:10px;margin-top:${vertical ? 0 : 40}px}
.vpipe{position:absolute;left:${SX - 80}px;width:${SW + 160}px;top:${SY + 50}px;padding:20px 0 18px;border-radius:26px;background:color-mix(in srgb,var(--bg) 74%,transparent);backdrop-filter:blur(14px);box-shadow:0 20px 60px rgba(0,0,0,.4)}
.pn{display:flex;flex-direction:column;align-items:center;gap:10px;font:700 ${vertical ? 24 : 26}px/1 var(--fb)}
.pn b{display:flex;align-items:center;justify-content:center;width:${vertical ? 60 : 72}px;height:${vertical ? 60 : 72}px;border-radius:50%;background:color-mix(in srgb,var(--accent) 18%,transparent);border:2px solid var(--accent)}
.pn svg{width:55%;height:55%}.pn path{fill:none;stroke:var(--ink);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1}
.pl{display:block;width:${vertical ? 46 : 64}px;height:3px;margin-top:${vertical ? 29 : 35}px;background:linear-gradient(90deg,var(--accent),var(--hi));transform-origin:0 50%}
.co{inset:auto;height:60px;display:flex;align-items:center}
.co i{display:block;width:26px;height:2px;background:var(--hi)}
.cod i{width:2px;height:16px}
.co span{display:inline-block;max-width:${vertical ? 230 : 330}px;padding:10px 18px;border-radius:999px;background:var(--hi);color:var(--bg);font:800 ${vertical ? 26 : 28}px/1.1 var(--fb);box-shadow:0 10px 30px rgba(0,0,0,.35)}
.badges,.stats{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${vertical ? 70 : 160}px}
.chips{display:grid;gap:${vertical ? 22 : 26}px;margin:${vertical ? 56 : 44}px 0 ${vertical ? 30 : 20}px;grid-template-columns:repeat(${vertical ? 2 : 3},minmax(0,1fr));width:100%;max-width:${vertical ? 940 : 1500}px}
.chips.n2{grid-template-columns:repeat(2,minmax(0,1fr))}${vertical ? '' : '.chips.n4,.chips.n8{grid-template-columns:repeat(4,minmax(0,1fr))}'}
.chip{position:relative;display:flex;align-items:center;gap:18px;padding:${vertical ? '26px 30px' : '28px 32px'};background:linear-gradient(100deg,color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--accent) 6%,transparent));border:2px solid color-mix(in srgb,var(--accent) 45%,transparent);border-radius:14px 34px 14px 34px;text-align:left}
.chip b{display:block;flex:none;width:12px;height:${vertical ? 54 : 58}px;border-radius:6px;background:var(--hi);transform-origin:50% 100%}
.chip span{font:400 ${vertical ? 62 : 64}px/1 var(--fd);letter-spacing:.02em;color:var(--ink);text-transform:uppercase}
.srow{display:flex;gap:${vertical ? 40 : 90}px;margin:${vertical ? 60 : 50}px 0 ${vertical ? 30 : 20}px;flex-wrap:wrap;justify-content:center}
.st{display:flex;flex-direction:column;align-items:center;min-width:${vertical ? 380 : 300}px}
.num{display:flex;align-items:flex-start;font:400 ${vertical ? 230 : 210}px/1 var(--fd);color:var(--ink)}
.dr{display:inline-block;height:1em;overflow:hidden}.dr i{display:block;font-style:normal}.dr em{display:block;height:1em;font-style:normal}
.sx{color:var(--hi);font-size:.6em;margin-left:6px}
.lab{margin-top:14px;font:700 ${vertical ? 36 : 34}px/1.1 var(--fb);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.title,.cta,.bump{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${vertical ? 80 : 160}px}
.title .head,.bump .head{font-size:${vertical ? 96 : 104}px}
.lg,.mark{position:relative;overflow:hidden;margin-bottom:${vertical ? 40 : 30}px}.lg img{display:block;width:${vertical ? 520 : 460}px}.mark img{display:block;width:${vertical ? 300 : 220}px}
.shine{position:absolute;inset:0;overflow:hidden;-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
.glint{position:absolute;top:0;left:0;width:25%;height:100%}.glint i{display:block;width:100%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.75),transparent);transform:skewX(-16deg)}
.nm{font:900 ${vertical ? 120 : 132}px/1 var(--fd);margin-bottom:24px}
.card{position:absolute;inset:0}
.cbg{position:absolute;inset:-60px;background-size:cover;background-position:center;filter:blur(36px) brightness(.42)}
.cglow{position:absolute;left:50%;top:46%;width:${vertical ? 1400 : 1500}px;height:${vertical ? 1400 : 1100}px;margin:-${vertical ? 700 : 550}px 0 0 -${vertical ? 700 : 750}px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 30%,transparent) 0%,transparent 66%)}
.cw{position:absolute;border-radius:${vertical ? 32 : 26}px;overflow:hidden;box-shadow:0 60px 160px rgba(0,0,0,.6),0 0 0 2px color-mix(in srgb,var(--hi) 40%,transparent)}.cw img{display:block;width:100%;height:100%;object-fit:contain}
.sweep{position:absolute;top:-10%;left:0;width:26%;height:120%}.sweep i{display:block;width:100%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent);transform:skewX(-14deg)}
.cside{${vertical ? '' : 'top:300px;'}}
.cbig{top:${vertical ? 700 : 340}px;left:${vertical ? 80 : 200}px;right:${vertical ? 80 : 200}px;text-align:center}.cbig .head{font-size:${vertical ? 104 : 120}px}
.cta .head{margin-top:${vertical ? 26 : 18}px;font-size:${vertical ? 84 : 92}px;max-width:${vertical ? 920 : 1500}px}
.url{margin-top:${vertical ? 44 : 30}px;font:800 ${vertical ? 46 : 42}px/1 var(--fb);padding:14px 34px;border:3px solid var(--ink);border-radius:18px}
.bump .bl{width:${vertical ? 220 : 200}px;margin-bottom:30px}
.cap{inset:auto;position:absolute;display:flex}
.capd{${cap(L.capDevice)}}
.capw{${cap(L.capWide)}}
.cap span{display:inline-block;max-width:100%;padding:12px 24px;border-radius:16px;background:color-mix(in srgb,var(--bg) 86%,transparent);font:800 ${L.capDevice.size}px/1.18 var(--fb);color:var(--ink);text-align:${L.capDevice.align};box-shadow:0 10px 34px rgba(0,0,0,.35)}
.capw span{font-size:${L.capWide.size}px;text-align:center}
.cap b{font-weight:800}
`;
  await writeFile(
    join(dir, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<title>${esc(spec.brand.name)} film ${vertical ? '9x16' : '16x9'}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>${css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
${html}</div>
<script>(()=>{const tl=gsap.timeline({paused:true});
${js}window.__timelines["main"]=tl;})();</script>
</body></html>`,
  );
  if (!existsSync(join(dir, 'hyperframes.json'))) await writeFile(join(dir, 'hyperframes.json'), JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', paths: { assets: 'assets' }, registryItems: [] }, null, 2));
  if (!existsSync(join(dir, 'meta.json'))) await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: basename(dir), name: `${spec.brand.name} film`, createdAt: new Date().toISOString() }, null, 2));

  const scenes = plan.map((p) => ({ id: p.sc.id, kind: p.sc.kind, start: p.start, duration: p.duration }));
  await writeFile(
    join(dir, 'plan.json'),
    JSON.stringify(
      {
        format: spec.format,
        width: W,
        height: H,
        total,
        target: spec.target ?? null,
        scenes: plan.map((p) => ({
          id: p.sc.id,
          kind: p.sc.kind,
          start: p.start,
          duration: p.duration,
          voStart: p.vo ? r3(p.start + LEAD) : null,
          voDuration: p.vo ? r3(p.vo.duration) : null,
          voText: p.sc.vo ?? null,
          take: p.take ? { file: p.take.rel, device: p.take.device, from: p.take.from, footage: p.take.span, taps: tapsIn(p).length } : null,
        })),
        warnings,
      },
      null,
      1,
    ),
  );
  return { dir, width: W, height: H, total, scenes, warnings, srt, audio: audioRel ? join(dir, audioRel) : null, words };
}
