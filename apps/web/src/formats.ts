import type { Pack, Step } from './api.ts';

/** The formats people pick on Home, in the order they appear. Preview images live in /public/formats. */
export const FORMATS: { id: string; title: string; line: string; img?: string; ratio: number }[] = [
  { id: 'custom-video', title: 'Anything', line: 'Describe any video — Claude builds it from scratch', ratio: 16 / 9 },
  { id: 'infographic', title: 'Infographic post', line: 'Animated framework post with real logos', img: '/formats/infographic.jpg', ratio: 4 / 5 },
  { id: 'carousel', title: 'Carousel', line: 'Swipe slides for LinkedIn and Instagram', img: '/formats/carousel.jpg', ratio: 4 / 5 },
  { id: 'photo-carousel', title: 'Photo carousel', line: 'TikTok photo mode and Instagram 4:5 slides, with music', img: '/formats/photo-carousel.jpg', ratio: 9 / 16 },
  { id: 'quote-cards', title: 'Quote cards', line: 'Pull quotes, testimonials and post-style cards', img: '/formats/quote-cards.jpg', ratio: 4 / 5 },
  { id: 'app-store-screens', title: 'App store screens', line: 'iOS and Google Play screenshot sets in a phone frame', img: '/formats/app-store-screens.jpg', ratio: 9 / 16 },
  { id: 'product-hunt-kit', title: 'Product Hunt kit', line: 'Gallery, thumbnail, tagline and maker comment', img: '/formats/product-hunt-kit.jpg', ratio: 1270 / 760 },
  { id: 'profile-kit', title: 'Profile kit', line: 'Banners, covers, avatar and link previews that match', img: '/formats/profile-kit.jpg', ratio: 16 / 9 },
  { id: 'presentation', title: 'Presentation', line: 'Pitch or sales deck — PDF and editable PowerPoint', img: '/formats/presentation.jpg', ratio: 16 / 9 },
  { id: 'ad-set', title: 'Ad set', line: 'Hook variants in every ad size, with upload sheet', img: '/formats/ad-set.jpg', ratio: 1 },
  { id: 'landing', title: 'Landing page', line: 'Responsive page + section snippets for any site builder', img: '/formats/landing.jpg', ratio: 4 / 5 },
  { id: 'print', title: 'Print', line: 'Posters, flyers and roll-ups with bleed and crop marks', img: '/formats/print.jpg', ratio: 0.707 },
  { id: 'email', title: 'Email', line: 'Launch email, newsletter or sequence — HTML + text', img: '/formats/email.jpg', ratio: 4 / 5 },
  { id: 'document', title: 'PDF document', line: 'One-pager, case study, ebook or whitepaper', img: '/formats/document.jpg', ratio: 0.707 },
  { id: 'case-study', title: 'Case study', line: 'Customer story PDF with social cards — real or a labelled template', img: '/formats/case-study.jpg', ratio: 4 / 5 },
  { id: 'battlecard', title: 'Battlecard', line: 'Sales battlecard and an honest comparison page', img: '/formats/battlecard.jpg', ratio: 4 / 5 },
  { id: 'ugc-ad', title: 'UGC ad', line: 'Creator-style ad with a labelled AI presenter', ratio: 9 / 16 },
  { id: 'reel', title: 'Reel', line: 'Vertical video with captions', img: '/formats/reel.jpg', ratio: 9 / 16 },
  { id: 'launch-film', title: 'Launch film', line: '30-second video for launch day', img: '/formats/launch-film.jpg', ratio: 16 / 9 },
  { id: 'youtube-video', title: 'YouTube video', line: '3–10 minutes in chapters, with timestamps', img: '/formats/youtube-video.jpg', ratio: 16 / 9 },
  { id: 'explainer-video', title: 'Explainer', line: 'Narrated 60-second walkthrough', img: '/formats/explainer-video.jpg', ratio: 16 / 9 },
  { id: 'thumbnails', title: 'Thumbnails', line: 'YouTube, link cards and banners', img: '/formats/thumbnails.jpg', ratio: 16 / 9 },
  { id: 'copy-kit', title: 'Posts', line: 'Ready-to-paste posts for every channel', ratio: 4 / 5 },
  { id: 'trend-brief', title: 'Trend brief', line: 'What your audience cares about this week, with ideas', ratio: 4 / 5 },
  { id: 'teardown', title: 'Competitor teardown', line: 'Break down their ads and pages, then beat them', ratio: 4 / 5 },
];
export const DEFAULT_FORMATS = ['infographic', 'carousel', 'copy-kit'];

/** Friendly one-liners (falls back to the pack's tagline). */
export const PLAIN: Record<string, string> = Object.fromEntries(FORMATS.map((f) => [f.id, f.line]));
PLAIN['feature-spotlight'] = 'A short silent clip that loops in the feed';
PLAIN['short-film'] = 'A 45–120 s story shot like a film';
PLAIN['shorts'] = 'Vertical Shorts cut from your long video';
PLAIN['caption-video'] = 'Styled captions on a clip you upload';
PLAIN['trend-brief'] = 'What your audience cares about this week, with ideas to make';
PLAIN['teardown'] = 'Break down competitor ads and pages, then beat them';

export const isStudio = (p: Pack) => !!p.spec || !!p.pipeline;

/** Output shape (w/h) for a deliverable card. */
export function shape(pack: Pack | undefined, step?: Step): number {
  const o = step?.options ?? {};
  const pick = (k: string) => o[k] ?? pack?.options.find((x) => x.key === k)?.default;
  const preset = pick('preset');
  if (pack?.id === 'reel' || pack?.id === 'ugc-ad' || preset === 'vertical') return 9 / 16;
  if (preset === 'linkedin-video') return 4 / 5;
  if (preset === 'square-video') return 1;
  if (pack?.id === 'infographic') return pick('size') === '1080x1080' ? 1 : 4 / 5;
  if (pack?.id === 'carousel') return pick('platform') === '1080x1080' ? 1 : 4 / 5;
  if (pack?.id === 'photo-carousel') return pick('platform') === 'instagram' ? 4 / 5 : 9 / 16;
  if (pack?.id === 'quote-cards') return 4 / 5;
  if (pack?.id === 'app-store-screens') return 9 / 16;
  if (pack?.id === 'product-hunt-kit') return 1270 / 760;
  if (pack?.id === 'profile-kit') return 16 / 9;
  if (pack?.id === 'battlecard' || pack?.id === 'case-study') return 0.707;
  if (pack?.id === 'document') return 0.707;
  if (pack?.id === 'ad-set') return 1;
  if (pack?.id === 'print') return 0.707;
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
