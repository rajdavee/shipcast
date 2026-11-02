import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { home } from './paths.ts';
import { getSecret } from './voices.ts';

/**
 * Optional stock B-roll with the user's own free API key: Pixabay first
 * (free for commercial use, no attribution required), Pexels as a fallback.
 * Clips are downloaded once into ~/.shipcast/cache/broll and reused (Pixabay
 * doesn't allow hotlinking). Every clip comes back with its credit anyway.
 */

export interface BrollClip {
  file: string;
  width: number;
  height: number;
  duration: number;
  credit: string;
  url: string;
}

const API = 'https://api.pexels.com';
const PIXABAY = 'https://pixabay.com/api';

/** Stock providers in the order they're tried for footage. */
export const BROLL_PROVIDERS = ['pixabay', 'pexels'] as const;

export async function pixabayCheck(apiKey: string): Promise<void> {
  const r = await fetch(`${PIXABAY}/?key=${encodeURIComponent(apiKey)}&q=office&per_page=3`, { signal: AbortSignal.timeout(15_000) });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error('Pixabay rejected that API key');
  if (!r.ok) throw new Error(`Pixabay check failed (${r.status})`);
}

export async function unsplashCheck(apiKey: string): Promise<void> {
  const r = await fetch('https://api.unsplash.com/search/photos?query=office&per_page=1', { headers: { Authorization: `Client-ID ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw new Error('Unsplash rejected that access key');
  if (!r.ok) throw new Error(`Unsplash check failed (${r.status})`);
}

const fits = (w: number, h: number, o: 'landscape' | 'portrait' | 'square') => (o === 'portrait' ? h > w : o === 'square' ? Math.abs(w - h) / Math.max(w, h) < 0.2 : w > h);

async function pixabayClip(key: string, query: string, seconds: number, orientation: 'landscape' | 'portrait' | 'square', dir: string): Promise<BrollClip | null> {
  const r = await fetch(`${PIXABAY}/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&per_page=30&safesearch=true`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return null;
  const data = (await r.json()) as { hits?: any[] };
  const wantW = orientation === 'portrait' ? 1080 : 1920;
  const fileOf = (v: any) => Object.values(v.videos ?? {}).filter((f: any) => f?.url && f.width).sort((a: any, b: any) => Math.abs(a.width - wantW) - Math.abs(b.width - wantW))[0] as any;
  const long = (data.hits ?? []).filter((v) => v.duration >= Math.min(seconds, 20) && fileOf(v));
  const v = long.find((x) => fits(fileOf(x).width, fileOf(x).height, orientation)) ?? long[0];
  if (!v) return null;
  const f = fileOf(v);
  const file = join(dir, `pixabay-${v.id}-${f.width}.mp4`);
  if (!existsSync(file)) {
    const dl = await fetch(f.url, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) return null;
    await writeFile(file, Buffer.from(await dl.arrayBuffer()));
  }
  return { file, width: f.width, height: f.height, duration: v.duration, credit: `Video by ${v.user || 'a Pixabay creator'} on Pixabay`, url: v.pageURL };
}

export async function pexelsCheck(apiKey: string): Promise<void> {
  const r = await fetch(`${API}/v1/search?query=office&per_page=1`, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw new Error('Pexels rejected that API key');
  if (!r.ok) throw new Error(`Pexels check failed (${r.status})`);
}

/** Find and download a clip for `query` that is at least `seconds` long, in the frame's orientation. */
export async function findBroll(query: string, seconds: number, orientation: 'landscape' | 'portrait' | 'square'): Promise<BrollClip | null> {
  if (!query.trim()) return null;
  const keys = { pixabay: await getSecret('pixabay'), pexels: await getSecret('pexels') };
  if (!keys.pixabay && !keys.pexels) return null;
  const dir = join(home(), 'cache', 'broll');
  await mkdir(dir, { recursive: true });
  const metaFile = join(dir, `${createHash('sha1').update(`${query}|${orientation}|${Math.ceil(seconds)}`).digest('hex').slice(0, 16)}.json`);
  if (existsSync(metaFile)) {
    try {
      const m = JSON.parse(await import('node:fs/promises').then((f) => f.readFile(metaFile, 'utf8')));
      if (m && existsSync(m.file)) return m;
    } catch {}
  }
  let clip: BrollClip | null = null;
  if (keys.pixabay) clip = await pixabayClip(keys.pixabay, query, seconds, orientation, dir).catch(() => null);
  if (!clip && keys.pexels) clip = await pexelsClip(keys.pexels, query, seconds, orientation, dir).catch(() => null);
  if (clip) await writeFile(metaFile, JSON.stringify(clip));
  return clip;
}

async function pexelsClip(key: string, query: string, seconds: number, orientation: 'landscape' | 'portrait' | 'square', dir: string): Promise<BrollClip | null> {
  const r = await fetch(`${API}/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&size=medium&per_page=15`, { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return null;
  const data = (await r.json()) as { videos?: any[] };
  const wantW = orientation === 'portrait' ? 1080 : 1920;
  const pick = (data.videos ?? [])
    .filter((v) => v.duration >= Math.min(seconds, 20))
    .map((v) => ({ v, f: (v.video_files ?? []).filter((x: any) => x.file_type === 'video/mp4' && x.width).sort((a: any, b: any) => Math.abs(a.width - wantW) - Math.abs(b.width - wantW))[0] }))
    .find((x) => x.f);
  if (!pick) return null;
  const file = join(dir, `${pick.v.id}-${pick.f.width}.mp4`);
  if (!existsSync(file)) {
    const dl = await fetch(pick.f.link, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) return null;
    await writeFile(file, Buffer.from(await dl.arrayBuffer()));
  }
  return { file, width: pick.f.width, height: pick.f.height, duration: pick.v.duration, credit: `Video by ${pick.v.user?.name ?? 'a Pexels creator'} on Pexels`, url: pick.v.url };
}
