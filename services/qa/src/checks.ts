import { stat } from 'node:fs/promises';
import { blackSpans, CAPTION_RULES, frozenSpans, getPreset, measureLoudness, presetForSize, probe, run, type PlatformPreset } from '@shipcast/engine';

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  /** Seconds into the video, when it applies to a moment. */
  at?: number;
  /** Concrete instruction for the fixer (Claude or a human). */
  fix?: string;
}

export interface Report {
  pass: boolean;
  preset?: string;
  issues: Issue[];
  facts: Record<string, unknown>;
}

const report = (issues: Issue[], facts: Record<string, unknown>, preset?: PlatformPreset): Report => ({
  pass: !issues.some((i) => i.severity === 'error'),
  preset: preset?.id,
  issues,
  facts,
});

export async function checkVideo(file: string, presetId?: string): Promise<Report> {
  const p = await probe(file);
  const issues: Issue[] = [];
  const v = p.video;
  if (!v) return report([{ rule: 'video.stream', severity: 'error', message: 'No video stream.' }], { probe: p });
  const preset = (presetId && getPreset(presetId)) || presetForSize(v.width, v.height, 'video');

  if (preset) {
    if (v.width !== preset.width || v.height !== preset.height)
      issues.push({ rule: 'spec.size', severity: 'error', message: `Canvas is ${v.width}×${v.height}; ${preset.label} needs ${preset.width}×${preset.height}.`, fix: `Render at ${preset.width}×${preset.height}.` });
    if (preset.maxSeconds && p.duration > preset.maxSeconds + 0.5)
      issues.push({ rule: 'spec.duration', severity: 'error', message: `${p.duration.toFixed(1)}s is over the ${preset.maxSeconds}s limit for ${preset.label}.` });
    if (preset.idealSeconds && (p.duration < preset.idealSeconds[0] - 1 || p.duration > preset.idealSeconds[1] + 1))
      issues.push({ rule: 'pacing.duration', severity: 'info', message: `${p.duration.toFixed(1)}s is outside the usual ${preset.idealSeconds[0]}–${preset.idealSeconds[1]}s for ${preset.label}.` });
    if (preset.maxBytes && p.sizeBytes > preset.maxBytes) issues.push({ rule: 'spec.size-bytes', severity: 'error', message: `File is ${(p.sizeBytes / 1e6).toFixed(1)} MB, over the limit.` });
  }
  if (v.codec !== 'h264') issues.push({ rule: 'encode.codec', severity: 'warn', message: `Video codec is ${v.codec}; H.264 plays everywhere.`, fix: 'Run the finishing pass.' });
  if (v.pixFmt !== 'yuv420p') issues.push({ rule: 'encode.pixfmt', severity: 'warn', message: `Pixel format ${v.pixFmt}; some players need yuv420p.`, fix: 'Run the finishing pass.' });
  if (v.fps > 60) issues.push({ rule: 'encode.fps', severity: 'error', message: `${v.fps} fps — most platforms cap at 60.` });

  const [loud, black, frozen] = await Promise.all([p.audio ? measureLoudness(file) : null, blackSpans(file), frozenSpans(file, 2.5)]);
  if (loud) {
    const target = preset?.loudness ?? { lufs: -14, truePeak: -1 };
    if (Math.abs(loud.integrated - target.lufs) > 2)
      issues.push({ rule: 'audio.loudness', severity: 'warn', message: `Integrated loudness ${loud.integrated.toFixed(1)} LUFS; target ${target.lufs}.`, fix: 'Run the finishing pass (two-pass loudnorm).' });
    if (loud.truePeak > target.truePeak + 0.5)
      issues.push({ rule: 'audio.peak', severity: 'warn', message: `True peak ${loud.truePeak.toFixed(1)} dBTP — risk of clipping after platform transcode.`, fix: 'Run the finishing pass.' });
    if (loud.integrated < -40) issues.push({ rule: 'audio.silent', severity: 'warn', message: 'Audio track is essentially silent.' });
  }
  for (const b of black) {
    const isEdge = b.start < 0.3 || b.end > p.duration - 0.3;
    if (b.end - b.start >= (isEdge ? 1.2 : 0.6))
      issues.push({ rule: 'picture.black', severity: 'error', at: b.start, message: `Black picture from ${b.start.toFixed(1)}s to ${b.end.toFixed(1)}s.`, fix: 'Something failed to render or a scene starts empty — fill it or cut it.' });
  }
  for (const f of frozen)
    issues.push({ rule: 'picture.frozen', severity: 'warn', at: f.start, message: `Nothing moves from ${f.start.toFixed(1)}s to ${f.end.toFixed(1)}s.`, fix: 'Add secondary motion (slow drift/scale) or shorten the hold.' });

  return report(issues, { probe: p, loudness: loud, black, frozen }, preset);
}

export async function checkImage(file: string, presetId?: string): Promise<Report> {
  const issues: Issue[] = [];
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  const size = (await stat(file)).size;
  const preset = (presetId && getPreset(presetId)) || presetForSize(w, h);
  if (preset && (w !== preset.width || h !== preset.height))
    issues.push({ rule: 'spec.size', severity: 'error', message: `Image is ${w}×${h}; ${preset.label} needs ${preset.width}×${preset.height}.` });
  if (preset?.maxBytes && size > preset.maxBytes)
    issues.push({ rule: 'spec.size-bytes', severity: 'error', message: `File is ${(size / 1e6).toFixed(2)} MB; limit is ${(preset.maxBytes / 1e6).toFixed(0)} MB.`, fix: 'Export as JPG at quality 85, or reduce detail.' });
  return report(issues, { width: w, height: h, bytes: size }, preset);
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseSrt(src: string): Cue[] {
  const t = (s: string) => {
    const [hms, ms] = s.trim().split(/[,.]/);
    const [h, m, sec] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + sec + Number(ms ?? 0) / 1000;
  };
  return src
    .replace(/\r/g, '')
    .split(/\n\n+/)
    .flatMap((block) => {
      const lines = block.trim().split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) return [];
      const [a, b] = lines[i].split('-->');
      return [{ start: t(a), end: t(b), text: lines.slice(i + 1).join('\n').trim() }];
    });
}

export function checkCaptions(srt: string): Report {
  const cues = parseSrt(srt);
  const issues: Issue[] = [];
  const R = CAPTION_RULES;
  cues.forEach((c, i) => {
    const dur = c.end - c.start;
    const chars = c.text.replace(/\s+/g, ' ').length;
    const lines = c.text.split('\n');
    if (dur > 0 && chars / dur > R.maxCps + 3)
      issues.push({ rule: 'captions.speed', severity: 'warn', at: c.start, message: `Cue ${i + 1} needs ${(chars / dur).toFixed(0)} chars/s (comfortable ≤ ${R.maxCps}).`, fix: 'Split the cue or hold it longer.' });
    if (dur < R.minSeconds - 0.2 && c.text.split(/\s+/).length > 1) issues.push({ rule: 'captions.flash', severity: 'warn', at: c.start, message: `Cue ${i + 1} is on screen for only ${dur.toFixed(2)}s.` });
    if (dur > R.maxSeconds) issues.push({ rule: 'captions.long', severity: 'info', at: c.start, message: `Cue ${i + 1} holds for ${dur.toFixed(1)}s.` });
    if (lines.length > R.maxLines) issues.push({ rule: 'captions.lines', severity: 'warn', at: c.start, message: `Cue ${i + 1} has ${lines.length} lines (max ${R.maxLines}).` });
    if (lines.some((l) => l.length > R.maxCharsPerLine)) issues.push({ rule: 'captions.width', severity: 'warn', at: c.start, message: `Cue ${i + 1} has a line over ${R.maxCharsPerLine} characters.` });
    if (i > 0 && c.start < cues[i - 1].end - 0.05) issues.push({ rule: 'captions.overlap', severity: 'error', at: c.start, message: `Cue ${i + 1} overlaps the previous one.` });
  });
  return report(issues, { cues: cues.length });
}

/** HyperFrames' own runtime checks (layout overflow, contrast, motion) on a composition folder. */
export async function checkComposition(dir: string): Promise<Report> {
  const r = await run('npx', ['-y', 'hyperframes', 'check', dir, '--json', '--samples', '9', '--at-transitions'], { timeoutMs: 600_000 });
  let parsed: any = null;
  try {
    parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {
    return report([{ rule: 'composition.check', severity: 'warn', message: `hyperframes check did not return JSON: ${(r.stderr || r.stdout).slice(-300)}` }], {});
  }
  const list: any[] = parsed.issues ?? parsed.findings ?? [];
  const issues: Issue[] = list.slice(0, 60).map((f) => ({
    rule: `composition.${f.rule ?? f.code ?? f.type ?? 'issue'}`,
    severity: f.severity === 'error' ? 'error' : f.severity === 'info' ? 'info' : 'warn',
    message: String(f.message ?? f.description ?? JSON.stringify(f)).slice(0, 300),
    at: typeof f.time === 'number' ? f.time : typeof f.at === 'number' ? f.at : undefined,
    fix: f.fix ?? f.suggestion,
  }));
  return report(issues, { ok: parsed.ok ?? parsed.pass, summary: parsed.summary });
}
