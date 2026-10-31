import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { brandCss, getPreset, loadBrand, localizeFonts, normalizeBrand, resolveIcons, run, type BrandKit, type PlatformPreset } from '@shipcast/engine';
import { getScene, type SceneCtx } from './scenes.ts';
import { MOODS, type Mood } from '@shipcast/media';
import { buildCaptions, CAPTION_STYLES, type CaptionStyle, type Word } from './captions.ts';

export type Transition = 'cut' | 'flash' | 'wipe' | 'fade' | 'zoom';

export interface StoryScene {
  /** Shipcast scene id (see SCENES) … */
  scene?: string;
  /** … or a HyperFrames registry block, with its variables. */
  block?: string;
  fields?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  /** Seconds. Grows to fit the voice line and the scene's minimum. */
  duration?: number;
  /** Narration spoken over this scene. */
  vo?: string;
  /** How this scene enters. */
  transition?: Transition;
}

export interface StoryChapter {
  title: string;
  scenes: StoryScene[];
  /** false = no chapter card (e.g. the cold open). Default true from chapter 2 on. */
  card?: boolean;
}

export interface Storyboard {
  title?: string;
  preset: string;
  scenes: StoryScene[];
  /** Long-form: chapters render separately (cached), then join into one video. Replaces `scenes`. */
  chapters?: StoryChapter[];
  voice?: { voice: string; speed?: number } | null;
  /** A file to use, or a mood for Shipcast's procedural bed. `null` = no music. Default: an uplifting bed. */
  music?: { file?: string; mood?: Mood; gainDb?: number } | null;
  captions?: CaptionStyle;
}

export interface CompileDeps {
  /** media.voice — returns audio + aligned words. */
  voice: (text: string, voice: string, speed: number, out: string) => Promise<{ file: string; duration: number; words: Word[] }>;
  /** media.music — procedural bed with SFX. */
  music: (mood: Mood, seconds: number, sfx: { kind: string; at: number; gain?: number }[], out: string) => Promise<{ file: string; bpm: number }>;
  /** media.mix — voice over music, mastered. */
  mix: (voice: string | null, music: string | null, out: string, seconds: number, gainDb?: number) => Promise<{ file: string }>;
}

export interface Compiled {
  dir: string;
  duration: number;
  scenes: { id: string; start: number; duration: number; kind: string }[];
  audio?: string;
  captions?: string;
  words: Word[];
  preset: PlatformPreset;
}

const VO_LEAD = 0.3;
const VO_TAIL = 0.55;

/** Validate a storyboard and return human-readable problems (empty = ok). */
export function validateStoryboard(s: Storyboard): string[] {
  const errs: string[] = [];
  if (!getPreset(s.preset)) errs.push(`unknown preset "${s.preset}"`);
  if (Array.isArray(s.chapters)) {
    if (s.chapters.length < 2 || s.chapters.length > 16) errs.push('chapters must have 2–16 entries');
    s.chapters.forEach((ch, k) => {
      if (!ch?.title?.trim()) errs.push(`chapter ${k + 1} needs a title`);
      if (!Array.isArray(ch?.scenes) || !ch.scenes.length) errs.push(`chapter ${k + 1} needs scenes`);
      for (const e of validateStoryboard({ ...s, chapters: undefined, scenes: ch?.scenes ?? [] })) errs.push(`chapter ${k + 1}: ${e}`);
    });
    return [...new Set(errs)];
  }
  if (!Array.isArray(s.scenes) || !s.scenes.length) errs.push('scenes must be a non-empty array');
  (s.scenes ?? []).forEach((sc, i) => {
    if (!sc.scene && !sc.block) errs.push(`scene ${i + 1}: needs "scene" or "block"`);
    if (sc.scene) {
      try {
        const def = getScene(sc.scene);
        for (const f of def.fields) if (!f.optional && (sc.fields?.[f.id] === undefined || sc.fields?.[f.id] === '')) errs.push(`scene ${i + 1} (${sc.scene}): missing field "${f.id}"`);
      } catch (e) {
        errs.push(`scene ${i + 1}: ${(e as Error).message}`);
      }
    }
    if (sc.block && !/^[a-z0-9-]+$/.test(sc.block)) errs.push(`scene ${i + 1}: bad block id`);
  });
  if (s.music?.mood && !(s.music.mood in MOODS)) errs.push(`music.mood must be one of ${Object.keys(MOODS).join(', ')}`);
  if (s.captions && !(s.captions in CAPTION_STYLES)) errs.push(`captions must be one of ${Object.keys(CAPTION_STYLES).join(', ')}`);
  return errs;
}

function subcomp(id: string, width: number, height: number, part: { markup: string; css: string; js: string }): string {
  return `<!doctype html><html><head><meta charset="UTF-8"></head><body><template>
<style>${part.css}</style>
<div id="${id}" data-composition-id="${id}" data-width="${width}" data-height="${height}">${part.markup}</div>
<script>(()=>{const root=document.getElementById("${id}")||document.querySelector('[data-composition-id="${id}"]');
// Shrink a headline only if it truly overflows. Wait for real layout first: before the scene is
// mounted its box is 0 wide and every line would look too long. Always fit from the authored size.
const fit=()=>{const c=root.getBoundingClientRect();if(c.width<${Math.round(width / 2)})return false;for(const el of root.querySelectorAll("h1,h2,.num,p")){const cs=getComputedStyle(el);if(cs.display==="inline"||!el.clientWidth)continue;if(!el.dataset.fs0)el.dataset.fs0=parseFloat(cs.fontSize);let s=+el.dataset.fs0;el.style.fontSize=s+"px";const min=Math.max(s*.6,28);const room=()=>{const p=el.parentElement.getBoundingClientRect(),r=el.getBoundingClientRect();return Math.min(el.clientWidth,p.right-r.left,c.right-r.left);};for(let i=0;i<30&&s>min&&el.scrollWidth>room()+Math.max(6,s*.08);i++){s*=.95;el.style.fontSize=s+"px";}}return true;};
let tries=0;const tryFit=()=>{if(!fit()&&tries++<120)requestAnimationFrame(tryFit);};tryFit();
if(window.ResizeObserver)new ResizeObserver(()=>fit()).observe(root);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
const tl=gsap.timeline({paused:true});
${part.js}
window.__timelines["${id}"]=tl;})();</script>
</template></body></html>`;
}

/** Compile a storyboard into a HyperFrames project folder. */
export async function compileStoryboard(story: Storyboard, opts: { dir: string; brandDir?: string; brand?: Partial<BrandKit>; deps: CompileDeps; progress?: (f: number, m: string) => void }): Promise<Compiled> {
  const errs = validateStoryboard(story);
  if (errs.length) throw new Error(`storyboard is invalid:\n- ${errs.join('\n- ')}`);
  const preset = getPreset(story.preset)!;
  const { width, height } = preset;
  const dir = opts.dir;
  const brand = opts.brandDir ? await loadBrand(opts.brandDir) : normalizeBrand(opts.brand);
  await mkdir(join(dir, 'compositions'), { recursive: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  const progress = opts.progress ?? (() => {});

  // Assets are copied in and referenced relatively so the project is portable.
  const copied = new Map<string, string>();
  const asset = (src: string): string => {
    if (copied.has(src)) return copied.get(src)!;
    if (!existsSync(src)) return '';
    const name = `${createHash('sha1').update(src).digest('hex').slice(0, 8)}-${basename(src).replace(/[^\w.-]/g, '_')}`;
    copied.set(src, `assets/${name}`);
    pendingCopies.push(copyFile(src, join(dir, 'assets', name)));
    return `assets/${name}`;
  };
  const pendingCopies: Promise<void>[] = [];

  // 1. Voice per scene → durations.
  const voiced: { file: string; duration: number; words: Word[] }[] = [];
  for (const [i, sc] of story.scenes.entries()) {
    if (story.voice && sc.vo?.trim()) {
      progress(0.05 + (0.35 * i) / story.scenes.length, `voice ${i + 1}/${story.scenes.length}`);
      voiced[i] = await opts.deps.voice(sc.vo.trim(), story.voice.voice, story.voice.speed ?? 1, join(dir, 'assets', `vo-${i + 1}.wav`));
    }
  }

  // 2. Timeline. With a procedural bed, every scene length is a whole number of beats so cuts land on the beat.
  const mood: Mood | null = story.music === null ? null : story.music?.file ? null : (story.music?.mood ?? 'uplifting');
  const beat = mood ? 60 / MOODS[mood].bpm : 0;
  const snap = (d: number) => (beat ? Math.ceil(d / beat - 0.15) * beat : d);
  let t = 0;
  const timeline = story.scenes.map((sc, i) => {
    const min = sc.scene ? getScene(sc.scene).minSeconds : 3;
    const vo = voiced[i] ? voiced[i].duration + VO_LEAD + VO_TAIL : 0;
    // The last scene holds an extra beat so the closing line is read, not flashed.
    const tail = i === story.scenes.length - 1 ? 1.2 : 0;
    const duration = Math.round(snap(Math.max(sc.duration ?? 0, min, vo + tail)) * 1000) / 1000;
    const entry = { sc, i, id: `s${i + 1}-${sc.scene ?? sc.block}`.replace(/[^\w-]/g, ''), start: Math.round(t * 100) / 100, duration };
    t += duration;
    return entry;
  });
  const total = Math.round(t * 100) / 100;

  // 3. Words on the global timeline, and one voice track.
  const words: Word[] = [];
  let audio: string | undefined;
  const vIdx = timeline.filter((e) => voiced[e.i]);
  if (vIdx.length) {
    for (const e of vIdx) for (const w of voiced[e.i].words) words.push({ text: w.text, start: +(w.start + e.start + VO_LEAD).toFixed(3), end: +(w.end + e.start + VO_LEAD).toFixed(3) });
    const voiceTrack = join(dir, 'assets', 'voice.wav');
    const inputs = vIdx.flatMap((e) => ['-i', voiced[e.i].file]);
    const delays = vIdx.map((e, k) => `[${k}:a]aresample=48000,adelay=${Math.round((e.start + VO_LEAD) * 1000)}:all=1[v${k}]`).join(';');
    const mixf = `${delays};${vIdx.map((_, k) => `[v${k}]`).join('')}amix=inputs=${vIdx.length}:normalize=0:duration=longest,apad=whole_dur=${total}[out]`;
    const r = await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', mixf, '-map', '[out]', '-t', String(total), voiceTrack], { timeoutMs: 300_000 });
    if (r.code !== 0) throw new Error(`voice track failed: ${r.stderr.slice(-300)}`);
    audio = voiceTrack;
  }
  let music = story.music?.file && existsSync(story.music.file) ? story.music.file : null;
  if (!music && mood) {
    progress(0.42, `scoring (${mood})`);
    // Transition hits: whoosh into wipes/zooms, a soft impact on flashes, a pop when a stat lands.
    const sfx: { kind: string; at: number; gain?: number }[] = [];
    for (const e of timeline.slice(1)) {
      const kind = e.sc.transition ?? 'wipe';
      if (kind === 'wipe' || kind === 'zoom') sfx.push({ kind: 'whoosh', at: e.start, gain: 0.35 });
      if (kind === 'flash') sfx.push({ kind: 'impact', at: e.start, gain: 0.4 });
    }
    for (const e of timeline) if (e.sc.scene === 'stat') sfx.push({ kind: 'pop', at: e.start + 0.12, gain: 0.3 });
    const bed = await opts.deps.music(mood, total, sfx, join(dir, 'assets', 'bed.wav'));
    music = bed.file;
  }
  if (audio || music) {
    progress(0.45, 'mixing audio');
    const mixed = await opts.deps.mix(audio ?? null, music, join(dir, 'assets', 'soundtrack.m4a'), total, story.music?.gainDb);
    audio = mixed.file;
  }

  // 4. Fonts (local files, required for deterministic renders).
  progress(0.55, 'fonts');
  const fonts = await localizeFonts([brand.fonts.display, brand.fonts.body, brand.fonts.mono], join(dir, 'assets', 'fonts'), 'assets/fonts');
  const fallbackBrand: BrandKit = {
    ...brand,
    fonts: {
      display: fonts.families.includes(brand.fonts.display) ? brand.fonts.display : 'system-ui',
      body: fonts.families.includes(brand.fonts.body) ? brand.fonts.body : 'system-ui',
      mono: fonts.families.includes(brand.fonts.mono) ? brand.fonts.mono : 'ui-monospace',
      fallback: 'system-ui',
    },
  };

  // 5. Scenes. With captions on, scenes keep their text above the caption band.
  progress(0.6, 'scenes');
  const style0 = story.captions ?? (words.length ? 'karaoke' : 'none');
  const vertical = height > width * 1.2;
  const u = Math.min(width, height) / 1080;
  const captionBand = words.length && style0 !== 'none' ? (vertical ? Math.max(preset.safe.bottom, 560 * u) + 250 * u : Math.round(height * 0.1) + 150 * u) : 0;
  const hosts: string[] = [];
  // Logos for scenes that show real tools (same resolver and cache as the infographics).
  const iconNames = timeline.flatMap((e) => (e.sc.scene === 'logos' ? String(Array.isArray(e.sc.fields?.items) ? (e.sc.fields!.items as string[]).join('\n') : (e.sc.fields?.items ?? '')).split('\n').map((x) => x.trim()).filter(Boolean) : []));
  const icons = iconNames.length ? await resolveIcons(iconNames) : {};
  for (const e of timeline) {
    const sctx: SceneCtx = { id: e.id, width, height, duration: e.duration, safe: preset.safe, brand: fallbackBrand, assetsDir: opts.brandDir, asset, icons, captionBand: e.sc.scene === 'product' || e.sc.scene === 'scroll' ? 0 : captionBand };
    if (e.sc.scene) {
      const part = getScene(e.sc.scene).build((e.sc.fields ?? {}) as Record<string, any>, sctx);
      await writeFile(join(dir, 'compositions', `${e.id}.html`), subcomp(e.id, width, height, part));
      hosts.push(`<div id="host-${e.id}" data-composition-id="${e.id}" data-composition-src="compositions/${e.id}.html" data-start="${e.start}" data-duration="${e.duration}" data-track-index="1" data-width="${width}" data-height="${height}"></div>`);
    } else if (e.sc.block) {
      const r = await run('npx', ['-y', 'hyperframes', 'add', e.sc.block, '--no-clipboard'], { cwd: dir, timeoutMs: 180_000 });
      if (!existsSync(join(dir, 'compositions', `${e.sc.block}.html`))) {
        const r2 = r.code === 0 ? r : await run('npx', ['-y', 'hyperframes', 'add', e.sc.block], { cwd: dir, timeoutMs: 180_000 });
        if (!existsSync(join(dir, 'compositions', `${e.sc.block}.html`))) throw new Error(`could not add registry block ${e.sc.block}: ${(r2.stderr || r2.stdout).slice(-200)}`);
      }
      const vals = esc(JSON.stringify(e.sc.variables ?? {}));
      hosts.push(`<div id="host-${e.id}" data-composition-id="${e.sc.block}" data-composition-src="compositions/${e.sc.block}.html" data-variable-values='${vals}' data-start="${e.start}" data-duration="${e.duration}" data-track-index="1" data-width="${width}" data-height="${height}"></div>`);
    }
  }

  // 6. Captions.
  const style = story.captions ?? (words.length ? 'karaoke' : 'none');
  let captionsFile: string | undefined;
  if (words.length && style !== 'none') {
    const part = buildCaptions(words, style, { id: 'captions', width, height, safe: preset.safe, brand: fallbackBrand });
    captionsFile = join(dir, 'compositions', 'captions.html');
    await writeFile(captionsFile, subcomp('captions', width, height, part));
    hosts.push(`<div id="host-captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${total}" data-track-index="5" data-track-kind="captions" data-width="${width}" data-height="${height}"></div>`);
  }

  // 7. Transitions (overlays on the root timeline, centred on each cut).
  const tx: string[] = [];
  const txJs: string[] = [];
  for (const e of timeline.slice(1)) {
    const kind = e.sc.transition ?? 'wipe';
    if (kind === 'cut') continue;
    const at = e.start;
    const id = `tx-${e.id}`;
    const f = (n: number) => n.toFixed(3);
    // Every overlay starts hidden at t=0 and uses explicit from→to pairs, so
    // any seek order (preview scrubbing, chunked renders) lands on the same frame.
    if (kind === 'flash') {
      tx.push(`<div class="sc-tx flash" id="${id}"></div>`);
      txJs.push(`tl.set("#${id}",{opacity:0},0);tl.fromTo("#${id}",{opacity:0},{opacity:.85,duration:.06,ease:"none"},${f(at - 0.06)});tl.fromTo("#${id}",{opacity:.85},{opacity:0,duration:.22,ease:"power2.out",immediateRender:false},${f(at)});`);
    } else if (kind === 'wipe') {
      tx.push(`<div class="sc-tx wipe" id="${id}"></div>`);
      txJs.push(`tl.set("#${id}",{xPercent:-101},0);tl.fromTo("#${id}",{xPercent:-101},{xPercent:0,duration:.28,ease:"power3.in",immediateRender:false},${f(at - 0.28)});tl.fromTo("#${id}",{xPercent:0},{xPercent:101,duration:.32,ease:"power3.out",immediateRender:false},${f(at)});`);
    } else if (kind === 'fade') {
      tx.push(`<div class="sc-tx dip" id="${id}"></div>`);
      txJs.push(`tl.set("#${id}",{opacity:0},0);tl.fromTo("#${id}",{opacity:0},{opacity:1,duration:.22,ease:"power1.in",immediateRender:false},${f(at - 0.22)});tl.fromTo("#${id}",{opacity:1},{opacity:0,duration:.3,ease:"power1.out",immediateRender:false},${f(at)});`);
    } else if (kind === 'zoom') {
      tx.push(`<div class="sc-tx zoom" id="${id}"></div>`);
      txJs.push(`tl.set("#${id}",{scale:0,opacity:1},0);tl.fromTo("#${id}",{scale:0,opacity:1},{scale:3,duration:.36,ease:"power3.in",immediateRender:false},${f(at - 0.3)});tl.fromTo("#${id}",{opacity:1},{opacity:0,duration:.2,immediateRender:false},${f(at + 0.06)});tl.set("#${id}",{scale:0},${f(at + 0.3)});`);
    }
  }

  await Promise.all(pendingCopies);
  const audioRel = audio ? `assets/${basename(audio)}` : '';
  if (audio && !audio.startsWith(join(dir, 'assets'))) await copyFile(audio, join(dir, audioRel));

  const index = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${width}, height=${height}">
<title>${esc(story.title ?? 'Shipcast')}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
${fonts.css}
${brandCss(fallbackBrand)}
html,body{margin:0;background:#000}
#main{position:relative;width:${width}px;height:${height}px;overflow:hidden;font-family:var(--font-body)}
[id^="host-"]{position:absolute;left:0;top:0;width:${width}px;height:${height}px}
.sc-tx{position:absolute;inset:0;z-index:50;pointer-events:none}
.sc-tx.flash{background:#fff;opacity:0}
.sc-tx.wipe{background:var(--brand-primary)}
.sc-tx.dip{background:#05060a;opacity:0}
.sc-tx.zoom{left:50%;top:50%;width:${Math.max(width, height)}px;height:${Math.max(width, height)}px;margin:-${Math.max(width, height) / 2}px 0 0 -${Math.max(width, height) / 2}px;border-radius:50%;background:var(--brand-primary)}
</style></head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-width="${width}" data-height="${height}" data-duration="${total}">
${hosts.join('\n')}
${tx.join('\n')}
${audioRel ? `<audio id="soundtrack" src="${audioRel}" data-start="0" data-duration="${total}" data-track-index="9" data-volume="1"></audio>` : ''}
</div>
<script>(()=>{const tl=gsap.timeline({paused:true});
${txJs.join('\n')}
window.__timelines["main"]=tl;})();</script>
</body></html>`;
  await writeFile(join(dir, 'index.html'), index);
  if (!existsSync(join(dir, 'hyperframes.json')))
    await writeFile(join(dir, 'hyperframes.json'), JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true }, registryItems: [] }, null, 2));
  if (!existsSync(join(dir, 'meta.json'))) await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: basename(dir), name: story.title ?? basename(dir), createdAt: new Date().toISOString() }, null, 2));
  await writeFile(join(dir, 'storyboard.json'), JSON.stringify(story, null, 2));
  progress(0.7, 'compiled');
  return {
    dir,
    duration: total,
    scenes: timeline.map((e) => ({ id: e.id, start: e.start, duration: e.duration, kind: e.sc.scene ?? `block:${e.sc.block}` })),
    audio: audioRel || undefined,
    captions: captionsFile,
    words,
    preset,
  };
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

export const extOf = (f: string) => extname(f).slice(1).toLowerCase();
