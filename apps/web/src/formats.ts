import type { Pack, Step } from './api.ts';

/** The formats people pick on Home, in the order they appear. Preview images live in /public/formats. */
export const FORMATS: { id: string; title: string; line: string; img?: string; ratio: number }[] = [
  { id: 'infographic', title: 'Infographic post', line: 'Animated framework post with real logos', img: '/formats/infographic.jpg', ratio: 4 / 5 },
  { id: 'carousel', title: 'Carousel', line: 'Swipe slides for LinkedIn and Instagram', img: '/formats/carousel.jpg', ratio: 4 / 5 },
  { id: 'reel', title: 'Reel', line: 'Vertical video with captions', img: '/formats/reel.jpg', ratio: 9 / 16 },
  { id: 'launch-film', title: 'Launch film', line: '30-second video for launch day', img: '/formats/launch-film.jpg', ratio: 16 / 9 },
  { id: 'youtube-video', title: 'YouTube video', line: '3–10 minutes in chapters, with timestamps', img: '/formats/youtube-video.jpg', ratio: 16 / 9 },
  { id: 'explainer-video', title: 'Explainer', line: 'Narrated 60-second walkthrough', img: '/formats/explainer-video.jpg', ratio: 16 / 9 },
  { id: 'thumbnails', title: 'Thumbnails', line: 'YouTube, link cards and banners', img: '/formats/thumbnails.jpg', ratio: 16 / 9 },
  { id: 'copy-kit', title: 'Posts', line: 'Ready-to-paste posts for every channel', ratio: 4 / 5 },
];
export const DEFAULT_FORMATS = ['infographic', 'carousel', 'copy-kit'];

/** Friendly one-liners (falls back to the pack's tagline). */
export const PLAIN: Record<string, string> = Object.fromEntries(FORMATS.map((f) => [f.id, f.line]));
PLAIN['feature-spotlight'] = 'A short silent clip that loops in the feed';
PLAIN['shorts'] = 'Vertical Shorts cut from your long video';
PLAIN['caption-video'] = 'Styled captions on a clip you upload';

export const isStudio = (p: Pack) => !!p.spec || !!p.pipeline;

/** Output shape (w/h) for a deliverable card. */
export function shape(pack: Pack | undefined, step?: Step): number {
  const o = step?.options ?? {};
  const pick = (k: string) => o[k] ?? pack?.options.find((x) => x.key === k)?.default;
  const preset = pick('preset');
  if (pack?.id === 'reel' || preset === 'vertical') return 9 / 16;
  if (preset === 'linkedin-video') return 4 / 5;
  if (preset === 'square-video') return 1;
  if (pack?.id === 'infographic') return pick('size') === '1080x1080' ? 1 : 4 / 5;
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
