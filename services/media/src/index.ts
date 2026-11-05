import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertInHome, chatterboxSpeak, createService, elevenSpeak, engineEnv, finishVideo, getPreset, measureLoudness, probe, run, SERVICE_PORTS, npxRun, voiceReady } from '@shipcast/engine';
import { alignScript, applyPronunciations, buildCues, paceTempo, phraseCues, sentences, toSrt, toVtt, type Word } from './align.ts';
import { addSfx, makeMusic, MOODS, toWav, type Mood, type Sfx } from './synth.ts';

export * from './align.ts';
export * from './synth.ts';

export const VOICES = ['af_heart', 'af_nova', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george'] as const;

async function hf(args: string[], timeoutMs = 600_000) {
  // engineEnv() points HyperFrames at Shipcast's managed Python (Kokoro). Prefer the cached
  // package so a registry hiccup can't stall speech.
  return npxRun(['hyperframes', ...args], { env: { ...process.env, ...engineEnv() }, timeoutMs, cap: 400_000 });
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
 * One synthesis pass with fallbacks: your ElevenLabs voice, then local
 * Chatterbox, then Kokoro, then the OS voice, so a run never dies for lack of
 * one engine. Returns provider word timings when the engine gives them.
 */
async function speakOnce(text: string, voice: string, speed: number, wav: string, ctx: { dir: string; progress: (p: number, m: string) => void }) {
  if (voice.startsWith('eleven:')) {
    try {
      const [, id, model] = voice.split(':');
      const sp = await elevenSpeak(text, id, { model, speed });
      const pcm = wav.replace(/\.wav$/, '.pcm');
      await writeFile(pcm, sp.pcm);
      const conv = await run('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, wav]);
      await run('rm', ['-f', pcm]);
      if (conv.code !== 0) throw new Error(conv.stderr.slice(-200));
      return { engine: 'elevenlabs', voice, words: sp.words.length ? alignScript(text, sp.words) : null };
    } catch (e) {
      ctx.progress(0.15, `ElevenLabs failed (${(e as Error).message.slice(0, 120)}); using Kokoro`);
      voice = 'af_heart';
    }
  }
  if (voice === 'chatterbox') {
    try {
      await chatterboxSpeak(text, wav);
      return { engine: 'chatterbox', voice, words: null };
    } catch (e) {
      ctx.progress(0.15, `Chatterbox failed (${(e as Error).message.slice(0, 120)}); using Kokoro`);
      voice = 'af_heart';
    }
  }
  const r = await hf(['tts', text, '-v', voice, '-s', String(speed), '-o', wav, '--json'], 240_000);
  if (lastJson(r.stdout)?.ok) return { engine: 'kokoro', voice, words: null };
  const aiff = wav.replace(/\.wav$/, '.aiff');
  const say = process.platform === 'darwin' ? await run('say', ['-o', aiff, text]) : await run('espeak-ng', ['-w', wav, text]);
  if (say.code !== 0) throw new Error(`no voice engine available: ${r.stderr.slice(-200)}`);
  if (process.platform === 'darwin') await run('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-ar', '24000', wav]);
  return { engine: 'system', voice, words: null };
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
      /**
       * Speak a script and return the audio plus word timings aligned to the script.
       * Optional: `pronounce` respells words for the voice only (captions keep the
       * script's spelling), `pause` adds a breath of that many seconds between
       * sentences, and `pace` (words per minute) retimes the read to that pace.
       */
      voice: async ({ text, voice = 'af_heart', speed = 1, out, pronounce, pause, pace }, ctx) => {
        if (!text?.trim()) throw new Error('text is required');
        const eleven = typeof voice === 'string' && voice.startsWith('eleven:');
        const local = voice === 'chatterbox';
        if (!eleven && !local && !VOICES.includes(voice)) throw new Error(`voice must be one of ${VOICES.join(', ')} or eleven:<voice id>`);
        if (pronounce != null && (typeof pronounce !== 'object' || Object.values(pronounce).some((v) => typeof v !== 'string'))) throw new Error('pronounce must map words to how they are said');
        if (pause != null && !(pause >= 0 && pause <= 2)) throw new Error('pause must be 0–2 seconds');
        if (pace != null && !(pace >= 90 && pace <= 220)) throw new Error('pace must be 90–220 words per minute');
        const wav = out ? assertInHome(out, 'out') : join(ctx.dir, 'voice.wav');
        await mkdir(dirname(wav), { recursive: true });
        const spoken = applyPronunciations(text, pronounce);
        const parts = pause ? sentences(spoken) : [spoken];
        const shaped = parts.length > 1 || !!pace || spoken !== text;
        ctx.progress(0.1, 'synthesizing');
        let engine = '';
        let words: Word[] | null = null;
        const wavs: string[] = [];
        for (const [i, part] of parts.entries()) {
          const pw = parts.length > 1 ? join(ctx.dir, `part-${i}.wav`) : shaped ? join(ctx.dir, 'raw.wav') : wav;
          const r = await speakOnce(part, voice, speed, pw, ctx);
          engine = r.engine;
          voice = r.voice;
          words = r.words;
          wavs.push(pw);
        }
        if (shaped) {
          ctx.progress(0.5, 'pacing');
          // Trim each sentence's edge silence (gently: soft word endings sit near -45 dB), join with even breaths, then retime to the pace.
          const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse';
          const ins = wavs.flatMap((w) => ['-i', w]);
          let graph = wavs.map((_, i) => `[${i}:a]aresample=24000,aformat=channel_layouts=mono,${trim}[s${i}]`).join(';');
          const gap = pause ? `aevalsrc=0:d=${pause}:s=24000` : '';
          const seq: string[] = [];
          wavs.forEach((_, i) => {
            if (i && gap) {
              graph += `;${gap}[g${i}]`;
              seq.push(`[g${i}]`);
            }
            seq.push(`[s${i}]`);
          });
          graph += `;${seq.join('')}concat=n=${seq.length}:v=0:a=1[joined]`;
          const joined = join(ctx.dir, 'joined.wav');
          const c = await run('ffmpeg', ['-y', '-v', 'error', ...ins, '-filter_complex', graph, '-map', '[joined]', joined]);
          if (c.code !== 0) throw new Error(`could not join sentences: ${c.stderr.slice(-200)}`);
          const tempo = pace ? paceTempo(text.split(/\s+/).filter(Boolean).length, (await probe(joined)).duration, pace) : 1;
          const t = await run('ffmpeg', ['-y', '-v', 'error', '-i', joined, '-af', `atempo=${tempo.toFixed(3)}`, wav]);
          if (t.code !== 0) throw new Error(`could not pace the voice: ${t.stderr.slice(-200)}`);
          words = null;
        }
        ctx.progress(0.6, 'timing words');
        const aligned = words ?? alignScript(text, await transcribe(wav, ctx.dir));
        const p = await probe(wav);
        await writeFile(wav.replace(/\.wav$/, '.words.json'), JSON.stringify(aligned, null, 1));
        return { file: wav, duration: p.duration, engine, voice, words: aligned, wpm: Math.round((text.split(/\s+/).filter(Boolean).length / p.duration) * 60) };
      },

      /** Word timings for any audio/video; optional known script for exact spelling. */
      transcribe: async ({ file, script }, ctx) => {
        const words = await transcribe(assertInHome(file, 'file'), ctx.dir);
        return { words: script ? alignScript(script, words) : words };
      },

      /** Caption cues from word timings, written as SRT and VTT. */
      captions: async ({ words, out, style = 'phrase', maxWords = 3, maxChars }) => {
        if (style !== 'phrase' && style !== 'chunk') throw new Error('style must be phrase or chunk');
        // Phrase cues carry their words so a film can highlight each word as it's spoken.
        const cues = style === 'phrase' ? phraseCues(words as Word[], { maxChars: maxChars ?? 30 }) : buildCues(words as Word[], { maxWords, maxChars: maxChars ?? 28 });
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
      music: async ({ mood = 'uplifting', seconds, bpm, seed, sfx = [], energy, out }: { mood?: Mood; seconds: number; bpm?: number; seed?: number; sfx?: { kind: Sfx; at: number; gain?: number }[]; energy?: { at: number; level: number }[]; out: string }) => {
        if (!(mood in MOODS)) throw new Error(`mood must be one of ${Object.keys(MOODS).join(', ')}`);
        if (!(seconds > 0 && seconds <= 600)) throw new Error('seconds must be between 0 and 600');
        const o = assertInHome(out, 'out');
        await mkdir(dirname(o), { recursive: true });
        const track = makeMusic({ mood, seconds, bpm, seed, energy: Array.isArray(energy) ? energy.filter((e) => Number.isFinite(e?.at) && Number.isFinite(e?.level)).slice(0, 400) : undefined });
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
