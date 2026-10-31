import { run } from './exec.ts';

export interface Probe {
  duration: number;
  sizeBytes: number;
  video?: { width: number; height: number; fps: number; codec: string; pixFmt: string; profile?: string };
  audio?: { codec: string; sampleRate: number; channels: number };
}

export async function probe(file: string): Promise<Probe> {
  const r = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.trim().slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams?.find((s: any) => s.codec_type === 'video');
  const a = j.streams?.find((s: any) => s.codec_type === 'audio');
  const rate = (s?: string) => {
    if (!s) return 0;
    const [n, d] = s.split('/').map(Number);
    return d ? n / d : n;
  };
  return {
    duration: Number(j.format?.duration ?? 0),
    sizeBytes: Number(j.format?.size ?? 0),
    video: v ? { width: v.width, height: v.height, fps: Math.round(rate(v.avg_frame_rate || v.r_frame_rate) * 100) / 100, codec: v.codec_name, pixFmt: v.pix_fmt, profile: v.profile } : undefined,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : undefined,
  };
}

export interface Loudness {
  integrated: number;
  truePeak: number;
  lra: number;
  thresh: number;
}

/** EBU R128 measurement via ffmpeg's loudnorm analysis pass. */
export async function measureLoudness(file: string): Promise<Loudness | null> {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { timeoutMs: 600_000 });
  const m = r.stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  const n = (x: string) => (x === '-inf' ? -99 : Number(x));
  return { integrated: n(j.input_i), truePeak: n(j.input_tp), lra: n(j.input_lra), thresh: n(j.input_thresh) };
}

export interface Span {
  start: number;
  end: number;
}

/** Stretches of (near) black picture, ≥ minSeconds. */
export async function blackSpans(file: string, minSeconds = 0.5): Promise<Span[]> {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', `blackdetect=d=${minSeconds}:pix_th=0.08`, '-an', '-f', 'null', '-'], { timeoutMs: 600_000 });
  return [...r.stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
}

/** Stretches where the picture doesn't change at all, ≥ minSeconds. */
export async function frozenSpans(file: string, minSeconds = 2): Promise<Span[]> {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', `freezedetect=n=0.0015:d=${minSeconds}`, '-an', '-f', 'null', '-'], { timeoutMs: 600_000 });
  const starts = [...r.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? s + minSeconds }));
}

/** A grid of evenly spaced frames, for human or model review. */
export async function contactSheet(file: string, out: string, { cols = 4, rows = 3, width = 360 } = {}): Promise<string> {
  const p = await probe(file);
  const n = cols * rows;
  const every = Math.max(p.duration / n, 0.1);
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', `fps=1/${every.toFixed(3)},scale=${width}:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x111111`, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 300_000 });
  if (r.code !== 0) throw new Error(`contact sheet failed: ${r.stderr.slice(-300)}`);
  return out;
}

/**
 * Broadcast-style finish: two-pass loudnorm to the target, H.264 High
 * yuv420p, AAC 48 kHz, faststart. Video is re-encoded only when it isn't
 * already H.264/yuv420p.
 */
export async function finishVideo(input: string, output: string, { lufs = -14, truePeak = -1, lra = 11, crf = 18 } = {}): Promise<{ loudness: Loudness | null }> {
  const p = await probe(input);
  const v = p.video;
  const videoArgs = v && v.codec === 'h264' && v.pixFmt === 'yuv420p' ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  let audioArgs: string[] = ['-an'];
  if (p.audio) {
    const m = await measureLoudness(input);
    const filter = m
      ? `loudnorm=I=${lufs}:TP=${truePeak}:LRA=${lra}:measured_I=${m.integrated}:measured_TP=${m.truePeak}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:linear=true`
      : `loudnorm=I=${lufs}:TP=${truePeak}:LRA=${lra}`;
    audioArgs = ['-af', `${filter},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'];
  }
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', input, ...videoArgs, ...audioArgs, '-movflags', '+faststart', output], { timeoutMs: 1_800_000 });
  if (r.code !== 0) throw new Error(`finish failed: ${r.stderr.slice(-400)}`);
  return { loudness: p.audio ? await measureLoudness(output) : null };
}
