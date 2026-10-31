import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertInHome, callService, contactSheet, createService, home, PRESETS, presetForSize, run, SERVICE_PORTS, engineEnv, getSecret, readSettings } from '@shipcast/engine';
import { SCENES } from './scenes.ts';
import { CAPTION_STYLES } from './captions.ts';
import { compileStoryboard, validateStoryboard, type Storyboard } from './compile.ts';
import { compileCaptionVideo } from './captionVideo.ts';
import { compileInfographic, validateInfographic } from './infographic.ts';

export { SCENES, CAPTION_STYLES, compileStoryboard, validateStoryboard, validateInfographic };
export type { Storyboard };

/** Voice lines are cached by (text, voice, speed): editing visuals never re-synthesizes speech. */
async function cachedVoice(text: string, voice: string, speed: number, out: string) {
  // Your own ElevenLabs voice replaces Kokoro everywhere when it's switched on.
  const s = await readSettings();
  if (s.voiceProvider === 'elevenlabs' && s.elevenVoice && !voice.startsWith('eleven:') && (await getSecret('elevenlabs'))) voice = `eleven:${s.elevenVoice}:${s.elevenModel || 'eleven_multilingual_v2'}`;
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
  music: (mood: string, seconds: number, sfx: unknown[], out: string) => callService('media', 'music', { mood, seconds, sfx, out }),
  mix: (voice: string | null, music: string | null, out: string, seconds: number, gainDb?: number) => callService('media', 'mix', { voice, music, out, seconds, ...(gainDb !== undefined ? { musicGainDb: gainDb } : {}) }),
};

async function hf(args: string[], cwd: string, timeoutMs = 1_800_000) {
  const { spawn } = await import('node:child_process');
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const c = spawn('npx', ['-y', 'hyperframes', ...args], { cwd, env: { ...process.env, ...engineEnv() }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout = (stdout + d).slice(-100_000)));
    c.stderr.on('data', (d) => (stderr = (stderr + d).slice(-40_000)));
    const t = setTimeout(() => c.kill('SIGTERM'), timeoutMs);
    c.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
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
async function finishProject(o: { project: string; dir: string; name: string; quality: string; fps: number; preset?: string; posterAt: number; progress: (f: number, m?: string) => void }) {
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
  const r = await hf(['render', '.', '-o', raw, '--quality', o.quality === 'draft' ? 'draft' : 'delivery', '--fps', String(o.fps), '--quiet'], project);
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
  const sheet = await contactSheet(final, join(dir, `${name}.sheet.jpg`));
  o.progress(0.9, 'quality checks');
  const [qa, layout] = await Promise.all([
    callService('qa', 'video', { file: final, preset: o.preset }).catch((e: Error) => ({ pass: false, issues: [{ rule: 'qa.unavailable', severity: 'warn', message: e.message }], facts: {} })),
    compositionFindings(project),
  ]);
  qa.issues.push(...layout);
  qa.pass = !qa.issues.some((i: any) => i.severity === 'error');
  return { file: final, poster, sheet, project, lint: lintJson?.summary ?? lintJson ?? undefined, qa };
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
        const project = join(dir, 'project');
        const compiled = await compileStoryboard(storyboard as Storyboard, { dir: project, brandDir: brandDir ? assertInHome(brandDir, 'brandDir') : undefined, deps, progress: (f, m) => ctx.progress(f * 0.4, m) });
        const firstScene = compiled.scenes[0];
        const posterAt = firstScene ? firstScene.start + Math.min(firstScene.duration * 0.8, firstScene.duration - 0.1) : 1;
        const out = await finishProject({ project, dir, name, quality, fps: compiled.preset.fps ?? 30, preset: compiled.preset.id, posterAt, progress: ctx.progress });
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
