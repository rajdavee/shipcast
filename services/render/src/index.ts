import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertInHome, callService, contactSheet, createService, frameDetail, home, PRESETS, presetForSize, run, SERVICE_PORTS, npxRun, engineEnv, chatterboxReady, findBroll, getSecret, readSettings } from '@shipcast/engine';
import { SCENES } from './scenes.ts';
import { CAPTION_STYLES } from './captions.ts';
import { compileStoryboard, echoesVoice, validateStoryboard, type Storyboard } from './compile.ts';
import { compileCaptionVideo } from './captionVideo.ts';
import { compileInfographic, validateInfographic } from './infographic.ts';

export { SCENES, CAPTION_STYLES, compileStoryboard, validateStoryboard, validateInfographic, echoesVoice };
export type { Storyboard };

/** Voice lines are cached by (text, voice, speed): editing visuals never re-synthesizes speech. */
async function cachedVoice(text: string, voice: string, speed: number, out: string) {
  // Your own ElevenLabs voice replaces Kokoro everywhere when it's switched on.
  const s = await readSettings();
  if (s.voiceProvider === 'chatterbox' && chatterboxReady() && !voice.startsWith('eleven:')) voice = 'chatterbox';
  else if (s.voiceProvider === 'elevenlabs' && s.elevenVoice && !voice.startsWith('eleven:') && (await getSecret('elevenlabs'))) voice = `eleven:${s.elevenVoice}:${s.elevenModel || 'eleven_multilingual_v2'}`;
  const key = createHash('sha256').update(JSON.stringify([text, voice, speed])).digest('hex').slice(0, 24);
  const dir = join(home(), 'cache', 'voice');
  const wav = join(dir, `${key}.wav`);
  const meta = join(dir, `${key}.json`);
  if (!existsSync(wav) || !existsSync(meta)) {
    await mkdir(dir, { recursive: true });
    const r = await callService('media', 'voice', { text, voice, speed, out: wav });
    await writeFile(meta, JSON.stringify({ duration: r.duration, words: r.words, engine: r.engine }));
  }
  await copyFile(wav, out);
  const m = JSON.parse(await readFile(meta, 'utf8'));
  return { file: out, duration: m.duration, words: m.words };
}

const deps = {
  voice: cachedVoice,
  broll: (query: string, seconds: number, orientation: 'landscape' | 'portrait' | 'square') => findBroll(query, seconds, orientation),
  music: (mood: string, seconds: number, sfx: unknown[], out: string, energy?: { at: number; level: number }[]) => callService('media', 'music', { mood, seconds, sfx, out, energy }),
  mix: (voice: string | null, music: string | null, out: string, seconds: number, gainDb?: number) => callService('media', 'mix', { voice, music, out, seconds, ...(gainDb !== undefined ? { musicGainDb: gainDb } : {}) }),
};

/** Render with HyperFrames; when parallel capture times out under load, retry once with a single worker. */
async function hfRender(args: string[], cwd: string) {
  const r = await hf(args, cwd);
  if (r.code !== 0 && /Navigation timeout|sequential capture|--workers 1/i.test(r.stderr + r.stdout)) return hf([...args, '--workers', '1'], cwd);
  return r;
}

async function hf(args: string[], cwd: string, timeoutMs = 1_800_000) {
  return npxRun(['hyperframes', ...args], { cwd, env: { ...process.env, ...engineEnv() }, timeoutMs, cap: 200_000 });
}

/**
 * HyperFrames' in-browser checks on the compiled project: text overlaps,
 * clipping, contrast and craft rules (empty first frame, unreadable last line).
 * Layout errors block; the rest are warnings with the engine's own fix hints.
 */
async function compositionFindings(project: string) {
  const r = await hf(['check', '.', '--json', '--samples', '12'], project, 600_000);
  let j: any;
  try {
    j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {
    return [];
  }
  const out: { rule: string; severity: string; message: string; at?: number; fix?: string }[] = [];
  for (const area of ['layout', 'contrast', 'craft', 'lint'] as const) {
    for (const f of j[area]?.findings ?? []) {
      if (f.severity === 'info') continue;
      // Frame 0 is replaced by the poster frame after rendering.
      if (f.code === 'first_frame_empty') continue;
      // Captions are allowed to sit over product footage.
      if (f.code === 'content_overlap' && /host-captions/.test(`${f.containerSelector ?? ''}${f.selector ?? ''}`) && /\.cam|img/.test(f.selector ?? '')) continue;
      out.push({
        rule: `${area}.${f.code}`,
        severity: area === 'layout' && f.severity === 'error' ? 'error' : 'warn',
        message: `${f.message}${f.text ? ` ("${String(f.text).slice(0, 40)}")` : ''}`,
        at: typeof f.time === 'number' ? f.time : undefined,
        fix: f.fixHint,
      });
    }
  }
  return out.slice(0, 30);
}

/** Shared tail of every render: lint → render → master → poster frame 0 → contact sheet → QA. */
async function finishProject(o: { project: string; dir: string; name: string; quality: string; fps: number; preset?: string; posterAt: number; scenes?: { id: string; start: number; duration: number; kind: string }[]; progress: (f: number, m?: string) => void }) {
  const { project, dir, name } = o;
  o.progress(0.42, 'lint');
  const lint = await hf(['lint', '.', '--json'], project, 300_000);
  let lintJson: any = null;
  try {
    lintJson = JSON.parse(lint.stdout.slice(lint.stdout.indexOf('{')));
  } catch {
    /* non-JSON output */
  }
  const raw = join(dir, `${name}.raw.mp4`);
  o.progress(0.45, 'rendering frames');
  const r = await hfRender(['render', '.', '-o', raw, '--quality', o.quality === 'draft' ? 'draft' : 'delivery', '--fps', String(o.fps), '--quiet'], project);
  if (r.code !== 0) throw new Error(`render failed: ${(r.stderr || r.stdout).slice(-900)}`);
  o.progress(0.85, 'mastering');
  const final = join(dir, `${name}.mp4`);
  await callService('media', 'finish', { input: raw, output: final, preset: o.preset });
  await run('rm', ['-f', raw]);
  const poster = join(dir, `${name}.jpg`);
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', o.posterAt.toFixed(2), '-i', final, '-frames:v', '1', '-q:v', '2', poster]);
  // Frame 0 is the thumbnail on most social players: make it the settled hook frame.
  const withPoster = join(dir, `${name}.p.mp4`);
  const pr = await run('ffmpeg', ['-y', '-v', 'error', '-i', final, '-i', poster, '-filter_complex', "[1:v]scale=iw:ih[p];[0:v][p]overlay=enable='eq(n\\,0)'", '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', withPoster]);
  if (pr.code === 0) await run('mv', [withPoster, final]);
  // Each scene at its settled moment — after its entrances (late in the scene), before the exit fade (~0.5 s):
  // what a viewer sees, not a transition caught halfway.
  const settled = (o.scenes ?? []).filter((s) => s.id !== 'captions').map((s) => ({ ...s, at: +(s.start + Math.max(s.duration * 0.55, s.duration - 0.8)).toFixed(2) }));
  const sheet = await contactSheet(final, join(dir, `${name}.sheet.jpg`), { at: settled.map((s) => s.at) });
  o.progress(0.9, 'quality checks');
  const [qa, layout, empty] = await Promise.all([
    callService('qa', 'video', { file: final, preset: o.preset }).catch((e: Error) => ({ pass: false, issues: [{ rule: 'qa.unavailable', severity: 'warn', message: e.message }], facts: {} })),
    compositionFindings(project),
    emptyScenes(final, settled),
  ]);
  qa.issues.push(...layout, ...empty);
  qa.pass = !qa.issues.some((i: any) => i.severity === 'error');
  return { file: final, poster, sheet, project, lint: lintJson?.summary ?? lintJson ?? undefined, qa };
}


/** Scenes that are nearly empty at their settled moment (a logo sting is meant to be sparse). */
async function emptyScenes(file: string, scenes: { id: string; kind: string; at: number }[]) {
  const out = [];
  for (const [i, s] of scenes.entries()) {
    if (/logo-sting|^block:/.test(s.kind)) continue;
    const d = await frameDetail(file, s.at);
    if (d !== null && d < EMPTY_DETAIL) out.push({ rule: 'picture.empty-scene', severity: 'error', at: s.at, message: `Scene ${i + 1} (${s.kind}) is nearly empty at ${s.at.toFixed(1)}s — the viewer sees a flat background.`, fix: 'Give it content that holds (headline, product shot, footage), or cut the scene.' });
  }
  return out;
}

/** Below this edge density a settled frame reads as blank (measured: content 2–14, lone logo ~1). */
export const EMPTY_DETAIL = 0.6;

const ts = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

/**
 * Long-form: every chapter is its own HyperFrames project (voice only),
 * cached by a hash of its content, so a 10-minute video renders in pieces
 * that fit in memory and an edit to one chapter re-renders only that one.
 * Chapters join without re-encoding; one continuous music bed and one
 * master pass go over the whole thing. Also writes YouTube chapter
 * timestamps and a full SRT.
 */
/** Fingerprint of the scene engine, so cached chapters re-render when the engine changes. */
const ENGINE_REV = (() => {
  const h = createHash('sha256');
  for (const f of ['compile.ts', 'scenes.ts', 'scenes-explainer.ts', 'captions.ts']) {
    try {
      h.update(readFileSync(new URL(`./${f}`, import.meta.url)));
    } catch {}
  }
  return h.digest('hex').slice(0, 12);
})();

async function renderChapters(story: Storyboard, dir: string, brandDir: string | undefined, name: string, quality: string, progress: (f: number, m?: string) => void) {
  const chapters = story.chapters!;
  const parts: { video: string; audio: string; duration: number; title: string; start: number }[] = [];
  const words: { text: string; start: number; end: number }[] = [];
  const credits: string[] = [];
  let t = 0;
  let preset: { id: string; fps?: number } | undefined;
  for (const [i, ch] of chapters.entries()) {
    const card = ch.card ?? i > 0;
    const sub: Storyboard = {
      ...story,
      chapters: undefined,
      music: null,
      scenes: [...(card ? [story.chapterCards === 'part' ? { scene: 'part', fields: { label: `Part ${chapters.slice(0, i + 1).filter((c, k) => c.card ?? k > 0).length}`, title: ch.title }, transition: 'fade' as const } : { scene: 'chapter', fields: { number: i + 1, title: ch.title, total: chapters.length }, transition: 'fade' as const }] : []), ...ch.scenes],
    };
    const cdir = join(dir, 'chapters', String(i + 1).padStart(2, '0'));
    const hash = createHash('sha256').update(JSON.stringify([sub, brandDir ?? '', quality, ENGINE_REV])).digest('hex').slice(0, 20);
    const video = join(cdir, 'video.mp4');
    const audio = join(cdir, 'audio.wav');
    const meta = join(cdir, 'chapter.json');
    let m: { hash: string; duration: number; words: typeof words; preset: { id: string; fps?: number }; credits?: string[] } | null = null;
    try {
      m = JSON.parse(await readFile(meta, 'utf8'));
    } catch {}
    const span = (f: number) => (i + f) / chapters.length;
    if (!m || m.hash !== hash || !existsSync(video) || !existsSync(audio)) {
      progress(0.02 + 0.8 * span(0), `chapter ${i + 1}/${chapters.length}: ${ch.title}`);
      await run('rm', ['-rf', cdir]);
      const project = join(cdir, 'project');
      const compiled = await compileStoryboard(sub, { dir: project, brandDir, deps, progress: (f, msg) => progress(0.02 + 0.8 * span(f * 0.4), `chapter ${i + 1}: ${msg ?? ''}`) });
      const raw = join(cdir, 'raw.mp4');
      const r = await hfRender(['render', '.', '-o', raw, '--quality', quality === 'draft' ? 'draft' : 'delivery', '--fps', String(compiled.preset.fps ?? 30), '--quiet'], project);
      if (r.code !== 0) throw new Error(`chapter ${i + 1} render failed: ${(r.stderr || r.stdout).slice(-600)}`);
      // Split picture and sound: pictures join losslessly, sound is re-mixed as one track.
      await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-an', '-c:v', 'copy', video]);
      const hasAudio = (await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', raw])).stdout.trim().length > 0;
      if (hasAudio) await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-vn', '-ac', '2', '-ar', '48000', '-t', String(compiled.duration), audio]);
      else await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(compiled.duration), audio]);
      await run('rm', ['-f', raw]);
      m = { hash, duration: compiled.duration, words: compiled.words, preset: { id: compiled.preset.id, fps: compiled.preset.fps }, credits: compiled.credits };
      await writeFile(meta, JSON.stringify(m));
    } else progress(0.02 + 0.8 * span(1), `chapter ${i + 1}: unchanged, reused`);
    preset = m.preset;
    credits.push(...(m.credits ?? []));
    parts.push({ video, audio, duration: m.duration, title: ch.title, start: t });
    for (const w of m.words) words.push({ text: w.text, start: +(w.start + t).toFixed(3), end: +(w.end + t).toFixed(3) });
    t += m.duration;
  }
  const total = Math.round(t * 100) / 100;
  progress(0.84, 'joining chapters');
  const vlist = join(dir, 'chapters', 'video.txt');
  const alist = join(dir, 'chapters', 'audio.txt');
  await writeFile(vlist, parts.map((p) => `file '${p.video}'`).join('\n'));
  await writeFile(alist, parts.map((p) => `file '${p.audio}'`).join('\n'));
  const joinedV = join(dir, `${name}.video.mp4`);
  const joinedA = join(dir, `${name}.voice.wav`);
  let r = await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', vlist, '-c', 'copy', joinedV], { timeoutMs: 900_000 });
  if (r.code !== 0) throw new Error(`joining chapters failed: ${r.stderr.slice(-300)}`);
  r = await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', alist, '-c', 'pcm_s16le', joinedA], { timeoutMs: 900_000 });
  if (r.code !== 0) throw new Error(`joining audio failed: ${r.stderr.slice(-300)}`);
  // One continuous bed under the whole video, with a whoosh at every chapter.
  const mood = story.music === null ? null : story.music?.mood ?? 'chill';
  let bed: string | null = story.music?.file && existsSync(story.music.file) ? story.music.file : null;
  if (!bed && mood) {
    progress(0.87, `scoring (${mood})`);
    bed = (await deps.music(mood, total, parts.slice(1).map((p) => ({ kind: 'whoosh', at: p.start, gain: 0.35 })), join(dir, 'chapters', 'bed.wav'))).file;
  }
  progress(0.9, 'mixing and mastering');
  const sound = (await deps.mix(joinedA, bed, join(dir, 'chapters', 'soundtrack.m4a'), total, story.music?.gainDb ?? -20)).file;
  const raw = join(dir, `${name}.raw.mp4`);
  r = await run('ffmpeg', ['-y', '-v', 'error', '-i', joinedV, '-i', sound, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', raw], { timeoutMs: 900_000 });
  if (r.code !== 0) throw new Error(`muxing failed: ${r.stderr.slice(-300)}`);
  const final = join(dir, `${name}.mp4`);
  await callService('media', 'finish', { input: raw, output: final, preset: preset?.id });
  await run('rm', ['-f', raw, joinedV, joinedA]);
  const poster = join(dir, `${name}.jpg`);
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(2, total / 3)), '-i', final, '-frames:v', '1', '-q:v', '2', poster]);
  const sheet = await contactSheet(final, join(dir, `${name}.sheet.jpg`));
  // YouTube needs the first chapter at 0:00, at least three, each ≥ 10 s.
  const stamps = parts.map((p, i) => `${ts(i ? p.start : 0)} ${p.title}`).join('\n');
  await writeFile(join(dir, 'chapters.txt'), stamps + '\n');
  if (credits.length) await writeFile(join(dir, 'credits.txt'), `Stock footage\n${[...new Set(credits)].map((c) => `- ${c}`).join('\n')}\n`);
  if (words.length) await callService('media', 'captions', { words, out: join(dir, `${name}.srt`), maxWords: 7, maxChars: 42 });
  progress(0.95, 'quality checks');
  const qa = await callService('qa', 'video', { file: final, preset: preset?.id }).catch((e: Error) => ({ pass: false, issues: [{ rule: 'qa.unavailable', severity: 'warn', message: e.message }], facts: {} }));
  return { file: final, poster, sheet, qa, duration: total, chapters: parts.map((p) => ({ title: p.title, start: p.start, duration: p.duration })), timestamps: stamps };
}
/**
 * render — storyboards → HyperFrames projects → MP4. Draft renders are
 * quick previews; final renders are mastered (loudness, codec) and gated
 * by the qa service before they're returned.
 */
export function createRenderService() {
  return createService({
    name: 'render',
    port: SERVICE_PORTS.render,
    version: '0.2.0',
    concurrency: 1,
    handlers: {
      catalog: async () => ({
        scenes: SCENES.map(({ build, ...s }) => s),
        captions: CAPTION_STYLES,
        presets: PRESETS.filter((p) => p.kind === 'video').map((p) => ({ id: p.id, label: p.label, width: p.width, height: p.height })),
      }),

      validate: async ({ storyboard }) => ({ errors: validateStoryboard(storyboard) }),

      /** Compile only, then grab still frames at each scene's midpoint. */
      preview: async ({ storyboard, outDir, brandDir }, ctx) => {
        const dir = assertInHome(outDir, 'outDir');
        const compiled = await compileStoryboard(storyboard, { dir, brandDir: brandDir ? assertInHome(brandDir, 'brandDir') : undefined, deps, progress: ctx.progress });
        const at = compiled.scenes.map((s) => +(s.start + Math.min(s.duration * 0.7, s.duration - 0.2)).toFixed(2));
        const snapDir = join(dir, 'preview');
        await mkdir(snapDir, { recursive: true });
        const r = await hf(['snapshot', '.', '--at', at.join(','), '--no-end', '-o', snapDir], dir, 600_000);
        const frames = (await readdir(snapDir).catch(() => [] as string[])).filter((f) => f.endsWith('.png')).sort().map((f) => join(snapDir, f));
        return { ...compiled, frames, log: r.code === 0 ? undefined : (r.stderr || r.stdout).slice(-600) };
      },

      /** Full render: compile → lint → render → finish → qa. */
      render: async ({ storyboard, outDir, brandDir, name = 'video', quality = 'final' }, ctx) => {
        const dir = assertInHome(outDir, 'outDir');
        if (Array.isArray((storyboard as Storyboard).chapters)) return renderChapters(storyboard as Storyboard, dir, brandDir ? assertInHome(brandDir, 'brandDir') : undefined, name, quality, ctx.progress);
        const project = join(dir, 'project');
        const compiled = await compileStoryboard(storyboard as Storyboard, { dir: project, brandDir: brandDir ? assertInHome(brandDir, 'brandDir') : undefined, deps, progress: (f, m) => ctx.progress(f * 0.4, m) });
        const firstScene = compiled.scenes[0];
        const posterAt = firstScene ? firstScene.start + Math.min(firstScene.duration * 0.8, firstScene.duration - 0.1) : 1;
        const out = await finishProject({ project, dir, name, quality, fps: compiled.preset.fps ?? 30, preset: compiled.preset.id, posterAt, scenes: compiled.scenes, progress: ctx.progress });
        if (compiled.credits.length) await writeFile(join(dir, 'credits.txt'), `Stock footage\n${compiled.credits.map((c) => `- ${c}`).join('\n')}\n`);
        return { ...out, duration: compiled.duration, scenes: compiled.scenes };
      },

      validateInfographic: async ({ spec }) => ({ errors: validateInfographic(spec) }),

      /** Animated framework infographic → looping MP4, GIF for LinkedIn, PNG still. */
      infographic: async ({ spec, outDir, brandDir, name = 'infographic' }, ctx) => {
        const dir = assertInHome(outDir, 'outDir');
        const project = join(dir, 'project');
        ctx.progress(0.05, 'laying out');
        const c = await compileInfographic(spec, { dir: project, brandDir: brandDir ? assertInHome(brandDir, 'brandDir') : undefined });
        const out = await finishProject({ project, dir, name, quality: 'final', fps: 30, preset: c.height === 1350 ? 'linkedin-video' : 'square-video', posterAt: Math.max(0.1, c.duration - 0.15), progress: (f, m) => ctx.progress(0.1 + f * 0.75, m) });
        ctx.progress(0.9, 'making the GIF');
        const gif = join(dir, `${name}.gif`);
        const pal = join(dir, 'palette.png');
        await run('ffmpeg', ['-y', '-v', 'error', '-i', out.file, '-vf', 'fps=15,scale=1080:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff', pal]);
        await run('ffmpeg', ['-y', '-v', 'error', '-i', out.file, '-i', pal, '-lavfi', 'fps=15,scale=1080:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif]);
        await run('rm', ['-f', pal]);
        const png = join(dir, `${name}.png`);
        await run('ffmpeg', ['-y', '-v', 'error', '-ss', '0.85', '-i', out.file, '-frames:v', '1', png]);
        return { ...out, gif, png, duration: c.duration };
      },

      /** Your footage + word-timed captions (+ optional hook title), mastered and checked. */
      captions: async ({ video, outDir, brandDir, style = 'bold', hook, name = 'captioned' }, ctx) => {
        const dir = assertInHome(outDir, 'outDir');
        const src = assertInHome(video, 'video');
        ctx.progress(0.05, 'transcribing');
        const { words } = await callService('media', 'transcribe', { file: src });
        if (!words?.length) throw new Error('no speech found in the video');
        const project = join(dir, 'project');
        const c = await compileCaptionVideo({ dir: project, video: src, words, style, hook, brandDir: brandDir ? assertInHome(brandDir, 'brandDir') : undefined });
        const p = presetForSize(c.width, c.height, 'video');
        const out = await finishProject({ project, dir, name, quality: 'final', fps: 30, preset: p?.id, posterAt: Math.min(1.5, c.duration / 2), progress: (f, m) => ctx.progress(0.2 + f * 0.8, m) });
        await callService('media', 'captions', { words, out: join(dir, `${name}.srt`) });
        return { ...out, duration: c.duration, words: words.length };
      },
    },
  });
}
