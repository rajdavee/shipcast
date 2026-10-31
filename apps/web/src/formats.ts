import type { Pack, Step } from './api.ts';

/** Three starting points instead of a catalogue of formats. */
export const GOALS = [
  {
    id: 'launch',
    title: 'Launch kit',
    blurb: 'Launch film, a reel, a carousel, YouTube thumbnails and ready-to-post copy.',
    packs: ['launch-film', 'reel', 'carousel', 'thumbnails', 'copy-kit'],
    shapes: [[30, 18], [12, 22], [18, 22], [28, 16], [14, 20]],
  },
  {
    id: 'social',
    title: 'Social pack',
    blurb: 'A reel, a silent feature clip, an animated carousel and posts for the week.',
    packs: ['reel', 'feature-spotlight', 'carousel', 'copy-kit'],
    shapes: [[12, 22], [18, 22], [18, 22], [14, 20]],
  },
  {
    id: 'video',
    title: 'Video only',
    blurb: 'A narrated launch film, a vertical reel and a 60-second explainer.',
    packs: ['launch-film', 'reel', 'explainer-video'],
    shapes: [[30, 18], [12, 22], [30, 18]],
  },
] as const;

/** Friendly one-liners shown in Customize (falls back to the pack's tagline). */
export const PLAIN: Record<string, string> = {
  'launch-film': 'A 20–40 s film for YouTube, LinkedIn or your site',
  reel: 'Vertical 9:16 for Reels, Shorts and TikTok, with captions',
  'feature-spotlight': 'A short silent clip that loops in the feed',
  'explainer-video': 'A narrated 60 s explainer of the problem you solve',
  'caption-video': 'Add styled captions to a clip you upload',
  carousel: 'LinkedIn / Instagram swipe slides, PDF and MP4',
  thumbnails: 'YouTube thumbnails, link previews, banners, stories',
  'copy-kit': 'Posts for LinkedIn, X, YouTube, Product Hunt and more',
};

export const isStudio = (p: Pack) => !!p.spec || !!p.pipeline;

/** Output shape (w/h) for a deliverable card. */
export function shape(pack: Pack | undefined, step?: Step): number {
  const o = step?.options ?? {};
  const pick = (k: string) => o[k] ?? pack?.options.find((x) => x.key === k)?.default;
  const preset = pick('preset');
  if (pack?.id === 'reel' || preset === 'vertical') return 9 / 16;
  if (preset === 'linkedin-video') return 4 / 5;
  if (preset === 'square-video') return 1;
  if (pack?.id === 'carousel') return pick('platform') === '1080x1080' ? 1 : 4 / 5;
  if (pack?.category === 'copy') return 4 / 5;
  return 16 / 9;
}

export function relTime(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
