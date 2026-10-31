/**
 * Shorts from a long video. We keep the storyboard, so instead of cropping a
 * 16:9 render we re-direct the strongest chapters natively for 9:16: a hook
 * card, the chapter's scenes trimmed to ~45 s, and the original outro.
 */

interface Scene {
  scene?: string;
  block?: string;
  fields?: Record<string, unknown>;
  vo?: string;
  duration?: number;
  transition?: string;
}
interface Board {
  title?: string;
  preset: string;
  scenes?: Scene[];
  chapters?: { title: string; scenes: Scene[]; card?: boolean }[];
  voice?: unknown;
  music?: unknown;
  captions?: string;
}

const ENERGY = new Set(['stat', 'kinetic', 'chart', 'compare', 'logos', 'stack3d', 'terminal']);

/** Rough on-screen seconds for a scene: its voice line at ~2.4 words/s plus breathing room. */
export function estimateSeconds(sc: Scene): number {
  const words = String(sc.vo ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(sc.duration ?? 0, words ? words / 2.4 + 0.85 : 3, 2.2);
}

export function shortsFromStoryboard(sb: Board, count = 3, opts: { maxSeconds?: number; captions?: string } = {}): Board[] {
  const max = opts.maxSeconds ?? 45;
  const all = sb.chapters ?? [{ title: sb.title ?? 'Highlights', scenes: sb.scenes ?? [] }];
  const outro = [...(sb.chapters?.at(-1)?.scenes ?? sb.scenes ?? [])].reverse().find((s) => s.scene === 'outro');
  const ranked = all
    .map((ch, i) => ({ ch, i, score: (i === 0 ? 100 : 0) + ch.scenes.filter((s) => ENERGY.has(s.scene ?? '')).length * 10 + Math.min(ch.scenes.length, 8) }))
    .filter((x) => x.ch.scenes.some((s) => s.scene !== 'outro'))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.i - b.i);
  return ranked.map(({ ch, i }) => {
    const body = ch.scenes.filter((s) => s.scene !== 'outro' && s.scene !== 'chapter');
    const opensStrong = ['title', 'kinetic', 'statement', 'stat'].includes(body[0]?.scene ?? '');
    const scenes: Scene[] = opensStrong ? [] : [{ scene: 'title', fields: { title: i === 0 ? sb.title ?? ch.title : ch.title }, vo: '' }];
    let t = scenes.reduce((s, x) => s + estimateSeconds(x), 0) + (outro ? estimateSeconds(outro) : 0);
    for (const s of body) {
      const d = estimateSeconds(s);
      if (scenes.length && t + d > max) break;
      scenes.push({ ...s, transition: scenes.length ? s.transition : 'cut' });
      t += d;
    }
    // The long video's sign-off often points at "the description" — a Short closes on the visual alone.
    if (outro) scenes.push({ ...outro, vo: '', duration: Math.max(outro.duration ?? 0, 3) });
    return { title: `${sb.title ?? 'Short'} — ${ch.title}`, preset: 'vertical', voice: sb.voice, music: sb.music, captions: opts.captions ?? 'highlight', scenes };
  });
}
