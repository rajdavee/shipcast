import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertInHome, createService, engineEnv, finishVideo, getPreset, measureLoudness, probe, run, SERVICE_PORTS, voiceReady } from '@shipcast/engine';
import { alignScript, buildCues, toSrt, toVtt, type Word } from './align.ts';
import { addSfx, makeMusic, MOODS, toWav, type Mood, type Sfx } from './synth.ts';

export * from './align.ts';
export * from './synth.ts';

export const VOICES = ['af_heart', 'af_nova', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george'] as const;

async function hf(args: string[], timeoutMs = 600_000) {
  // engineEnv() points HyperFrames at Shipcast's managed Python (Kokoro).
  const env = { ...process.env, ...engineEnv() };
  const { spawn } = await import('node:child_process');
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const c = spawn('npx', ['-y', 'hyperframes', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout = (stdout + d).slice(-200_000)));
    c.stderr.on('data', (d) => (stderr = (stderr + d).slice(-20_000)));
    const t = setTimeout(() => c.kill('SIGTERM'), timeoutMs);
    c.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const lastJson = (s: string) => {
  const lines = s.trim().split('\n').reverse();
  for (const l of lines) {
    try {
      return JSON.parse(l);
    } catch {
      /* keep looking */
    }
  }
  return null;
};

async function transcribe(file: string, dir: string): Promise<Word[]> {
  const r = await hf(['transcribe', file, '-d', dir, '--json']);
  const j = lastJson(r.stdout);
  if (!j?.ok) throw new Error(`transcription failed: ${(j?.error ?? r.stderr).toString().slice(-300)}`);
  return JSON.parse(await readFile(j.transcriptPath, 'utf8')).map((w: any) => ({ text: String(w.text), start: Number(w.start), end: Number(w.end) }));
}

/**
 * media — voice, transcription, caption timing, mixing and the finishing
 * master. Everything runs locally: Kokoro for voice, whisper.cpp for timing,
 * FFmpeg for audio.
 */
export function createMediaService() {
  return createService({
    name: 'media',
    port: SERVICE_PORTS.media,
    version: '0.2.0',
    concurrency: 1,
    health: async () => ({ voice: (await voiceReady()) ? 'kokoro' : 'system-fallback', voices: VOICES, moods: Object.keys(MOODS) }),
    handlers: {
      /** Speak a script and return the audio plus word timings aligned to the script. */
      voice: async ({ text, voice = 'af_heart', speed = 1, out }, ctx) => {
        if (!text?.trim()) throw new Error('text is required');
        if (!VOICES.includes(voice)) throw new Error(`voice must be one of ${VOICES.join(', ')}`);
        const wav = out ? assertInHome(out, 'out') : join(ctx.dir, 'voice.wav');
        await mkdir(dirname(wav), { recursive: true });
        ctx.progress(0.1, 'synthesizing');
        let engine = 'kokoro';
        const r = await hf(['tts', text, '-v', voice, '-s', String(speed), '-o', wav, '--json']);
        if (!lastJson(r.stdout)?.ok) {
          // Fallback: the OS voice, so a run never dies for lack of Kokoro.
          engine = 'system';
          const aiff = wav.replace(/\.wav$/, '.aiff');
          const say = process.platform === 'darwin' ? await run('say', ['-o', aiff, text]) : await run('espeak-ng', ['-w', wav, text]);
          if (say.code !== 0) throw new Error(`no voice engine available: ${r.stderr.slice(-200)}`);
          if (process.platform === 'darwin') await run('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-ar', '24000', wav]);
        }
        ctx.progress(0.6, 'timing words');
        const words = alignScript(text, await transcribe(wav, ctx.dir));
        const p = await probe(wav);
        await writeFile(wav.replace(/\.wav$/, '.words.json'), JSON.stringify(words, null, 1));
        return { file: wav, duration: p.duration, engine, voice, words };
      },

      /** Word timings for any audio/video; optional known script for exact spelling. */
      transcribe: async ({ file, script }, ctx) => {
        const words = await transcribe(assertInHome(file, 'file'), ctx.dir);
        return { words: script ? alignScript(script, words) : words };
      },

      /** Caption cues from word timings, written as SRT and VTT. */
      captions: async ({ words, out, maxWords = 3, maxChars = 28 }) => {
        const cues = buildCues(words as Word[], { maxWords, maxChars });
        const base = assertInHome(out, 'out').replace(/\.(srt|vtt)$/, '');
        await mkdir(dirname(base), { recursive: true });
        await writeFile(`${base}.srt`, toSrt(cues));
        await writeFile(`${base}.vtt`, toVtt(cues));
        return { cues, srt: `${base}.srt`, vtt: `${base}.vtt` };
      },

      /**
       * Mix a voice track over a music bed with sidechain ducking, then master
       * to -14 LUFS / -1 dBTP. Music fades in 0.5 s and out over the last 1.5 s.
       */
      mix: async ({ voice, music, out, seconds, musicGainDb = -16, duck = true }) => {
        const o = assertInHome(out, 'out');
        await mkdir(dirname(o), { recursive: true });
        const inputs: string[] = [];
        if (voice) inputs.push('-i', assertInHome(voice, 'voice'));
        if (music) inputs.push('-stream_loop', '-1', '-i', assertInHome(music, 'music'));
        if (!inputs.length) throw new Error('voice or music is required');
        const len = seconds ?? (voice ? (await probe(assertInHome(voice, 'voice'))).duration + 1.5 : 20);
        const fadeOut = Math.max(0, len - 1.5).toFixed(2);
        let filter: string;
        if (voice && music) {
          filter = `[1:a]volume=${musicGainDb}dB,afade=t=in:d=0.5,afade=t=out:st=${fadeOut}:d=1.5[bed];`;
          filter += duck
            ? `[0:a]asplit=2[vo][key];[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=250[ducked];[ducked][vo]amix=inputs=2:normalize=0:duration=longest[mix]`
            : `[bed][0:a]amix=inputs=2:normalize=0:duration=longest[mix]`;
        } else if (music) filter = `[0:a]afade=t=in:d=0.5,afade=t=out:st=${fadeOut}:d=1.5[mix]`;
        else filter = `[0:a]anull[mix]`;
        filter += `;[mix]highpass=f=60,loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[a]`;
        const r = await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-map', '[a]', '-t', len.toFixed(2), '-c:a', o.endsWith('.wav') ? 'pcm_s16le' : 'aac', '-b:a', '192k', o], { timeoutMs: 600_000 });
        if (r.code !== 0) throw new Error(`mix failed: ${r.stderr.slice(-400)}`);
        return { file: o, loudness: await measureLoudness(o) };
      },

      /** Broadcast finish for a rendered video: loudness, codec, faststart. */
      finish: async ({ input, output, preset }) => {
        const p = preset ? getPreset(preset) : undefined;
        const i = assertInHome(input, 'input');
        const o = assertInHome(output ?? i.replace(/\.(\w+)$/, '.final.$1'), 'output');
        const r = await finishVideo(i, o, p?.loudness ? { lufs: p.loudness.lufs, truePeak: p.loudness.truePeak } : {});
        return { file: o, ...r };
      },

      /** A procedural, license-free music bed (optionally with transition SFX baked in). */
      music: async ({ mood = 'uplifting', seconds, bpm, seed, sfx = [], out }: { mood?: Mood; seconds: number; bpm?: number; seed?: number; sfx?: { kind: Sfx; at: number; gain?: number }[]; out: string }) => {
        if (!(mood in MOODS)) throw new Error(`mood must be one of ${Object.keys(MOODS).join(', ')}`);
        if (!(seconds > 0 && seconds <= 600)) throw new Error('seconds must be between 0 and 600');
        const o = assertInHome(out, 'out');
        await mkdir(dirname(o), { recursive: true });
        const track = makeMusic({ mood, seconds, bpm, seed });
        sfx.forEach((s, i) => addSfx(track, s.kind, s.at, s.gain ?? 0.5, i + 1));
        await writeFile(o, toWav(track));
        return { file: o, bpm: track.bpm, beat: track.beat, mood };
      },

      /** Tempo of a music file (for cutting on the beat). */
      beats: async ({ file }, ctx) => {
        const f = assertInHome(file, 'file');
        const r = await hf(['beats', f, '--json'], 300_000);
        const j = lastJson(r.stdout);
        if (!j) throw new Error(`beat detection failed: ${r.stderr.slice(-200)}`);
        if (existsSync(join(ctx.dir, 'beats.json'))) return JSON.parse(await readFile(join(ctx.dir, 'beats.json'), 'utf8'));
        return j;
      },
    },
  });
}
