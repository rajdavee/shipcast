import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { run } from './exec.ts';
import { probe } from './ffmpeg.ts';

/**
 * Platform export: a finished video or image set, re-cut for each place it
 * will be posted — shape, length, file size and caption limits — with an
 * upload checklist. No Claude: pure ffmpeg plus the copy the piece already has.
 * Limits are the platforms' published ones (Nov 2026) and are conservative.
 */

export interface PlatformTarget {
  id: string;
  label: string;
  /** Target frame for video; images use `image`. */
  video?: { w: number; h: number; maxSeconds: number; maxMB: number; fps: number };
  image?: { w: number; h: number };
  caption: { max: number; fold?: number; hashtags: number };
  notes: string[];
}

export const PLATFORMS: PlatformTarget[] = [
  { id: 'tiktok', label: 'TikTok', video: { w: 1080, h: 1920, maxSeconds: 600, maxMB: 280, fps: 30 }, image: { w: 1080, h: 1920 }, caption: { max: 2200, fold: 100, hashtags: 5 }, notes: ['Keep text out of the bottom 380 px and right 140 px (buttons, caption).', 'Turn on the "AI-generated" label if the video shows a synthetic person.'] },
  { id: 'reels', label: 'Instagram Reels', video: { w: 1080, h: 1920, maxSeconds: 180, maxMB: 250, fps: 30 }, image: { w: 1080, h: 1350 }, caption: { max: 2200, fold: 125, hashtags: 5 }, notes: ['The grid shows the centre 4:5 crop as the cover — check the cover frame.', 'Meta asks you to label realistic AI-generated people and scenes ("AI info").'] },
  { id: 'shorts', label: 'YouTube Shorts', video: { w: 1080, h: 1920, maxSeconds: 180, maxMB: 1024, fps: 30 }, caption: { max: 100, hashtags: 3 }, notes: ['The title (≤ 100 chars) is what people read; put #Shorts-free hooks first.', 'Tick "Altered or synthetic content" in Studio if a person or scene is AI-made.'] },
  { id: 'linkedin', label: 'LinkedIn feed', video: { w: 1080, h: 1350, maxSeconds: 600, maxMB: 200, fps: 30 }, image: { w: 1080, h: 1350 }, caption: { max: 3000, fold: 210, hashtags: 3 }, notes: ['Native captions: upload the .srt alongside when you have one.', 'Links in the post body reduce reach — put the link in the first comment.'] },
  { id: 'x', label: 'X', video: { w: 1280, h: 720, maxSeconds: 140, maxMB: 512, fps: 30 }, image: { w: 1600, h: 900 }, caption: { max: 280, hashtags: 1 }, notes: ['Videos over 2:20 need a Premium account.', 'Put the link in a reply to keep the first post\'s reach.'] },
  { id: 'facebook', label: 'Facebook feed', video: { w: 1080, h: 1350, maxSeconds: 600, maxMB: 1024, fps: 30 }, image: { w: 1080, h: 1350 }, caption: { max: 2000, fold: 125, hashtags: 3 }, notes: ['Label realistic AI-generated content ("AI info").'] },
  { id: 'youtube', label: 'YouTube (landscape)', video: { w: 1920, h: 1080, maxSeconds: 43200, maxMB: 4096, fps: 30 }, caption: { max: 100, hashtags: 3 }, notes: ['Title ≤ 60 chars to avoid truncation; description and chapters live in description.md when the piece has one.'] },
];

const textFiles = ['caption.md', 'captions.md', 'post.txt', 'summary.md', 'description.md'];

/** The post copy a piece already carries, flattened to plain text. */
async function captionFor(out: string): Promise<string> {
  for (const f of textFiles) {
    const p = join(out, f);
    if (existsSync(p)) return (await readFile(p, 'utf8')).replace(/^#+\s.*$/gm, '').replace(/\*\*|__/g, '').trim();
  }
  return '';
}

/** Trim copy to a platform's limits without cutting a word, and cap hashtags. */
export function fitCaption(text: string, p: PlatformTarget): string {
  let tags = 0;
  let t = text.replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, (m, pre, tag) => (++tags <= p.caption.hashtags ? `${pre}${tag}` : ''));
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= p.caption.max) return t;
  const cut = t.slice(0, p.caption.max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), cut.length - 20)).trimEnd()}…`;
}

/** Re-frame a video to the target: crop when the shapes are close, blur-pad when they aren't, trim and cap bitrate. */
async function exportVideo(src: string, dst: string, v: NonNullable<PlatformTarget['video']>): Promise<{ file: string; seconds: number; mb: number; trimmed: boolean }> {
  const info = await probe(src);
  const sw = info.video?.width ?? v.w;
  const sh = info.video?.height ?? v.h;
  const seconds = Math.min(info.duration ?? v.maxSeconds, v.maxSeconds);
  const close = Math.abs(sw / sh - v.w / v.h) / (v.w / v.h) < 0.3;
  const vf = close
    ? `scale=${v.w}:${v.h}:force_original_aspect_ratio=increase,crop=${v.w}:${v.h},fps=${v.fps}`
    : `split[a][b];[a]scale=${v.w}:${v.h}:force_original_aspect_ratio=increase,crop=${v.w}:${v.h},boxblur=28:2,eq=brightness=-0.08[bg];[b]scale=${v.w}:${v.h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${v.fps}`;
  // Leave headroom under the size cap: video bitrate from the size budget, never above 12 Mb/s.
  const kbps = Math.max(1500, Math.min(12000, Math.floor((v.maxMB * 8192 * 0.9) / Math.max(1, seconds) - 160)));
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-t', String(seconds), '-filter_complex', vf, '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', dst], { timeoutMs: 1_800_000 });
  if (r.code !== 0) throw new Error(`export failed: ${r.stderr.slice(-300)}`);
  const mb = (await import('node:fs/promises').then((f) => f.stat(dst))).size / 1048576;
  return { file: dst, seconds, mb: +mb.toFixed(1), trimmed: (info.duration ?? 0) > v.maxSeconds + 0.5 };
}

async function exportImage(src: string, dst: string, im: NonNullable<PlatformTarget['image']>): Promise<string> {
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-filter_complex', `split[a][b];[a]scale=${im.w}:${im.h}:force_original_aspect_ratio=increase,crop=${im.w}:${im.h},boxblur=24:2,eq=brightness=-0.06[bg];[b]scale=${im.w}:${im.h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`, '-frames:v', '1', dst]);
  if (r.code !== 0) throw new Error(`image export failed: ${r.stderr.slice(-200)}`);
  return dst;
}

/** Export a finished step's main media for each platform into outDir/<platform>/. */
export async function exportForPlatforms(srcOut: string, outDir: string, platformIds: string[], log: (s: string) => void = () => {}): Promise<{ platform: string; files: string[]; warnings: string[] }[]> {
  const files = await readdir(srcOut).catch(() => [] as string[]);
  const video = ['video.mp4', 'carousel.mp4', 'infographic.mp4', 'short-1.mp4'].map((f) => join(srcOut, f)).find(existsSync);
  const images = files.filter((f) => /\.(png|jpe?g)$/i.test(f) && !/\.sheet\.|-mobile|-desktop|^video\.jpg$/.test(f)).map((f) => join(srcOut, f));
  const slides = existsSync(join(srcOut, 'slides')) ? (await readdir(join(srcOut, 'slides'))).filter((f) => f.endsWith('.png')).sort().map((f) => join(srcOut, 'slides', f)) : [];
  const stills = images.length ? images : slides;
  if (!video && !stills.length) throw new Error('Nothing to export: this piece has no video or images.');
  const caption = await captionFor(srcOut);
  const results = [];
  for (const id of platformIds) {
    const p = PLATFORMS.find((x) => x.id === id);
    if (!p) continue;
    const dir = join(outDir, p.id);
    await mkdir(dir, { recursive: true });
    const out: string[] = [];
    const warnings: string[] = [];
    if (video && p.video) {
      log(`${p.label}: re-cutting the video`);
      const v = await exportVideo(video, join(dir, `${p.id}.mp4`), p.video);
      out.push(v.file);
      if (v.trimmed) warnings.push(`Trimmed to ${p.video.maxSeconds}s — ${p.label}'s limit.`);
      if (v.mb > p.video.maxMB) warnings.push(`File is ${v.mb} MB, over ${p.video.maxMB} MB.`);
    } else if (stills.length && p.image) {
      log(`${p.label}: fitting ${stills.length} image(s)`);
      for (const [i, s] of stills.slice(0, 10).entries()) out.push(await exportImage(s, join(dir, `${p.id}-${String(i + 1).padStart(2, '0')}${s.endsWith('.png') ? '.png' : '.jpg'}`), p.image));
    } else {
      warnings.push(`${p.label} takes ${p.video ? 'video' : 'images'}; this piece has none.`);
    }
    const text = caption ? fitCaption(caption, p) : '';
    if (caption && text.length < caption.length) warnings.push(`Caption shortened to ${p.caption.max} characters.`);
    if (p.caption.fold && text && text.split('\n')[0].length > p.caption.fold) warnings.push(`The first line runs past the "more" fold (~${p.caption.fold} chars) — the hook should fit before it.`);
    if (text) await writeFile(join(dir, 'caption.txt'), `${text}\n`);
    await writeFile(join(dir, 'CHECKLIST.md'), [`# ${p.label}`, '', ...out.map((f) => `- [ ] Upload \`${basename(f)}\``), text ? '- [ ] Paste `caption.txt`' : '- [ ] Write a caption (none came with this piece)', ...p.notes.map((n) => `- [ ] ${n}`), ...warnings.map((w) => `- ⚠️ ${w}`), ''].join('\n'));
    results.push({ platform: p.id, files: out, warnings });
  }
  return results;
}
