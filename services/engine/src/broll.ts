import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { home } from './paths.ts';
import { getSecret } from './voices.ts';

/**
 * Optional stock B-roll from Pexels with the user's own free API key.
 * Clips are downloaded once into ~/.shipcast/cache/broll and reused.
 * Pexels asks for attribution, so every clip comes back with its credit.
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

export async function pexelsCheck(apiKey: string): Promise<void> {
  const r = await fetch(`${API}/v1/search?query=office&per_page=1`, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw new Error('Pexels rejected that API key');
  if (!r.ok) throw new Error(`Pexels check failed (${r.status})`);
}

/** Find and download a clip for `query` that is at least `seconds` long, in the frame's orientation. */
export async function findBroll(query: string, seconds: number, orientation: 'landscape' | 'portrait' | 'square'): Promise<BrollClip | null> {
  const key = await getSecret('pexels');
  if (!key || !query.trim()) return null;
  const dir = join(home(), 'cache', 'broll');
  await mkdir(dir, { recursive: true });
  const metaFile = join(dir, `${createHash('sha1').update(`${query}|${orientation}|${Math.ceil(seconds)}`).digest('hex').slice(0, 16)}.json`);
  if (existsSync(metaFile)) {
    try {
      const m = JSON.parse(await import('node:fs/promises').then((f) => f.readFile(metaFile, 'utf8')));
      if (m && existsSync(m.file)) return m;
    } catch {}
  }
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
  const clip: BrollClip = { file, width: pick.f.width, height: pick.f.height, duration: pick.v.duration, credit: `Video by ${pick.v.user?.name ?? 'a Pexels creator'} on Pexels`, url: pick.v.url };
  await writeFile(metaFile, JSON.stringify(clip));
  return clip;
}
