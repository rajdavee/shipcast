/**
 * Platform presets: canvas, timing, encode and safe-zone rules per placement.
 * Every deliverable renders against a preset, and the QA service checks
 * against the same numbers. Sources: docs/research/landscape-2026.md §5.
 */

export interface SafeZone {
  /** Pixels from each edge that platform UI may cover. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Profile photos and logos the platform lays over the image (canvas px). */
  avoid?: { x: number; y: number; w: number; h: number; what: string }[];
  /** Shown cropped to the inscribed circle (avatars): content must sit inside it. */
  circle?: boolean;
  /** Logos and pictures count as content too, not just text — the platform crops the whole image. */
  images?: boolean;
}

export interface PlatformPreset {
  id: string;
  label: string;
  kind: 'video' | 'image' | 'document';
  width: number;
  height: number;
  fps?: number;
  /** Max duration in seconds (video). */
  maxSeconds?: number;
  /** Recommended duration range for this placement. */
  idealSeconds?: [number, number];
  /** Max file size in bytes. */
  maxBytes?: number;
  safe: SafeZone;
  /** Loudness target (integrated LUFS) and true-peak ceiling (dBTP). */
  loudness?: { lufs: number; truePeak: number };
  notes?: string;
}

const LOUD = { lufs: -14, truePeak: -1 };
const MB = 1024 * 1024;
const box = (all: number): SafeZone => ({ top: all, right: all, bottom: all, left: all });

/**
 * One 9:16 mask that keeps content clear of Reels, TikTok and Shorts UI at
 * once (the platforms disagree; this is the union), so a single vertical
 * master is safe everywhere.
 */
export const VERTICAL_SAFE: SafeZone = { top: 270, right: 140, bottom: 672, left: 65 };

/**
 * Where the standard end-screen template puts its elements on a 1920×1080
 * frame (two stacked videos at the right, the subscribe circle beside them),
 * with a little air: a background keeps words and logos out of all three.
 */
export const END_SCREEN_ZONES = [
  { x: 1160, y: 130, w: 680, h: 400, what: 'the first end-screen video' },
  { x: 1160, y: 550, w: 680, h: 400, what: 'the second end-screen video' },
  { x: 840, y: 400, w: 280, h: 280, what: 'the subscribe button' },
];

export const PRESETS: PlatformPreset[] = [
  // ── vertical video ───────────────────────────────────────────────
  { id: 'vertical', label: 'Reels · Shorts · TikTok', kind: 'video', width: 1080, height: 1920, fps: 30, maxSeconds: 180, idealSeconds: [15, 45], safe: VERTICAL_SAFE, loudness: LOUD, notes: 'One master for all three platforms.' },
  { id: 'reels', label: 'Instagram Reels', kind: 'video', width: 1080, height: 1920, fps: 30, maxSeconds: 180, idealSeconds: [7, 30], safe: { top: 269, right: 65, bottom: 672, left: 65 }, loudness: LOUD, notes: 'Grid cover crops to 1080×1440.' },
  { id: 'tiktok', label: 'TikTok', kind: 'video', width: 1080, height: 1920, fps: 30, maxSeconds: 600, idealSeconds: [15, 60], safe: { top: 160, right: 140, bottom: 480, left: 120 }, loudness: LOUD },
  { id: 'shorts', label: 'YouTube Shorts', kind: 'video', width: 1080, height: 1920, fps: 30, maxSeconds: 180, idealSeconds: [15, 60], safe: { top: 270, right: 120, bottom: 380, left: 65 }, loudness: LOUD },
  { id: 'story', label: 'Instagram / LinkedIn Story', kind: 'video', width: 1080, height: 1920, fps: 30, maxSeconds: 60, idealSeconds: [5, 15], safe: { top: 270, right: 65, bottom: 380, left: 65 }, loudness: LOUD },
  // ── landscape / square / portrait video ──────────────────────────
  { id: 'youtube', label: 'YouTube (16:9)', kind: 'video', width: 1920, height: 1080, fps: 30, idealSeconds: [30, 180], safe: { top: 54, right: 96, bottom: 54, left: 96 }, loudness: LOUD, notes: 'Title-safe 90%.' },
  { id: 'linkedin-video', label: 'LinkedIn video (4:5)', kind: 'video', width: 1080, height: 1350, fps: 30, maxSeconds: 900, idealSeconds: [15, 90], maxBytes: 5 * 1024 * MB, safe: box(60), loudness: LOUD, notes: 'Plays muted by default — captions are essential.' },
  { id: 'square-video', label: 'Square video (1:1)', kind: 'video', width: 1080, height: 1080, fps: 30, idealSeconds: [10, 60], safe: box(60), loudness: LOUD },
  { id: 'x-video', label: 'X video (16:9)', kind: 'video', width: 1920, height: 1080, fps: 30, maxSeconds: 1200, idealSeconds: [15, 60], safe: box(54), loudness: LOUD, notes: 'H.264 High, AAC LC, ≤60 fps.' },
  // ── stills ───────────────────────────────────────────────────────
  { id: 'linkedin-carousel', label: 'LinkedIn carousel page', kind: 'document', width: 1080, height: 1350, safe: box(80), maxBytes: 100 * MB, notes: 'PDF, 6–10 pages recommended.' },
  { id: 'instagram-carousel', label: 'Instagram carousel (4:5)', kind: 'image', width: 1080, height: 1350, safe: { top: 80, right: 80, bottom: 80, left: 80 }, notes: 'Grid shows a centred 3:4 crop.' },
  { id: 'tiktok-photo', label: 'TikTok photo carousel (9:16)', kind: 'image', width: 1080, height: 1920, safe: { top: 150, right: 140, bottom: 420, left: 60 }, notes: 'Tabs on top, the button column on the right, caption, sound and slide dots at the bottom.' },
  { id: 'instagram-post', label: 'Feed post (1:1)', kind: 'image', width: 1080, height: 1080, safe: box(60), notes: 'Instagram, Facebook and LinkedIn feed.' },
  { id: 'linkedin-image', label: 'LinkedIn image (4:5)', kind: 'image', width: 1080, height: 1350, safe: box(60) },
  { id: 'linkedin-landscape', label: 'Landscape post (1.91:1)', kind: 'image', width: 1200, height: 627, safe: box(48), notes: 'LinkedIn and Facebook shared-image size.' },
  { id: 'youtube-thumbnail', label: 'YouTube thumbnail', kind: 'image', width: 1280, height: 720, maxBytes: 2 * MB, safe: { top: 36, right: 200, bottom: 90, left: 36 }, notes: 'Bottom-right holds the duration badge; must read at 160 px wide.' },
  { id: 'app-store-ios', label: 'App Store screenshot (iPhone 6.9″)', kind: 'image', width: 1290, height: 2796, safe: box(80), notes: 'PNG or JPEG, no transparency; 3–10 per locale, the first 3 show in search.' },
  { id: 'play-store', label: 'Google Play phone screenshot', kind: 'image', width: 1080, height: 1920, safe: box(64), notes: 'PNG or JPEG, no transparency, 9:16; at least 4 for promotion in recommendations.' },
  { id: 'producthunt-gallery', label: 'Product Hunt gallery image', kind: 'image', width: 1270, height: 760, maxBytes: 3 * MB, safe: box(48), notes: 'The first image is the one shown in shares and the launch page header.' },
  { id: 'producthunt-thumb', label: 'Product Hunt thumbnail', kind: 'image', width: 240, height: 240, maxBytes: 3 * MB, safe: box(16), notes: 'Shown at 80 px and smaller in lists.' },
  { id: 'article-cover', label: 'Article / newsletter cover (16:9)', kind: 'image', width: 1920, height: 1080, maxBytes: 8 * MB, safe: { top: 100, right: 140, bottom: 100, left: 140 }, notes: 'LinkedIn article and newsletter cover; feeds crop it toward 1.91:1, so keep words in the middle band.' },
  { id: 'article-figure', label: 'In-article figure', kind: 'image', width: 1600, height: 1000, safe: box(48), notes: 'Shown about 720 px wide on desktop and 350 px on phones.' },
  { id: 'og-card', label: 'Link preview (OG)', kind: 'image', width: 1200, height: 630, safe: { top: 65, right: 100, bottom: 65, left: 100 } },
  { id: 'x-image', label: 'X image (16:9)', kind: 'image', width: 1600, height: 900, maxBytes: 5 * MB, safe: box(60) },
  { id: 'story-image', label: 'Story card', kind: 'image', width: 1080, height: 1920, safe: { top: 270, right: 65, bottom: 380, left: 65 } },
  { id: 'github-banner', label: 'GitHub social preview', kind: 'image', width: 1280, height: 640, safe: box(40), notes: 'Repository settings → social preview; 40 px border keeps it clear of rounded crops.' },
  // ── profile banners: each platform crops differently and lays its own photo over a corner ──
  { id: 'linkedin-banner', label: 'LinkedIn personal banner', kind: 'image', width: 1584, height: 396, maxBytes: 8 * MB, safe: { top: 24, right: 48, bottom: 24, left: 48, images: true, avoid: [{ x: 0, y: 150, w: 470, h: 246, what: 'the profile photo' }] }, notes: 'Profile photo covers the bottom-left; phones trim the sides.' },
  { id: 'linkedin-company-banner', label: 'LinkedIn company cover', kind: 'image', width: 1128, height: 191, maxBytes: 3 * MB, safe: { top: 16, right: 32, bottom: 16, left: 32, images: true, avoid: [{ x: 0, y: 105, w: 250, h: 86, what: 'the page logo' }] }, notes: 'The page logo overlaps the bottom-left.' },
  { id: 'x-header', label: 'X header', kind: 'image', width: 1500, height: 500, maxBytes: 2 * MB, safe: { top: 60, right: 40, bottom: 60, left: 40, images: true, avoid: [{ x: 0, y: 320, w: 400, h: 180, what: 'the profile photo' }] }, notes: 'Phones trim top and bottom; the profile photo covers the bottom-left.' },
  { id: 'youtube-banner', label: 'YouTube channel art', kind: 'image', width: 2560, height: 1440, maxBytes: 6 * MB, safe: { top: 508, right: 507, bottom: 509, left: 507, images: true }, notes: 'Only the centre 1546×423 shows on every device; TVs show it all.' },
  { id: 'facebook-cover', label: 'Facebook cover', kind: 'image', width: 851, height: 315, maxBytes: 3 * MB, safe: { top: 16, right: 106, bottom: 16, left: 106, images: true }, notes: 'Phones show only the centre ~640 px.' },
  { id: 'profile-avatar', label: 'Avatar / profile logo', kind: 'image', width: 400, height: 400, maxBytes: 2 * MB, safe: { top: 0, right: 0, bottom: 0, left: 0, circle: true, images: true }, notes: 'Every platform crops to a circle (some to a rounded square).' },
  // ── long-tail discovery ──────────────────────────────────────────
  { id: 'pinterest-pin', label: 'Pinterest standard pin (2:3)', kind: 'image', width: 1000, height: 1500, maxBytes: 20 * MB, safe: { top: 80, right: 64, bottom: 110, left: 64 }, notes: 'Seen ~236 px wide in the grid: the title must read at that size. The save button sits top-right, the menu bottom-right; the link lives on the pin, not in the image.' },
  { id: 'youtube-endscreen', label: 'YouTube end-screen background', kind: 'image', width: 1920, height: 1080, maxBytes: 2 * MB, safe: { top: 54, right: 96, bottom: 54, left: 96, images: true, avoid: END_SCREEN_ZONES }, notes: 'The last 5–20 s of a video: two video elements and a subscribe button are placed over the right side in the editor, so that side stays empty.' },
];

export function getPreset(id: string): PlatformPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Find the preset whose canvas matches a size, preferring the given kind. */
export function presetForSize(width: number, height: number, kind?: PlatformPreset['kind']): PlatformPreset | undefined {
  const same = PRESETS.filter((p) => p.width === width && p.height === height);
  // Never match across kinds: a 1280×720 video is not a YouTube thumbnail.
  return kind ? same.find((p) => p.kind === kind) : same[0];
}

/** Caption readability limits used by the QA service and caption styles. */
export const CAPTION_RULES = {
  maxWordsPerChunk: 5,
  maxCharsPerLine: 42,
  maxLines: 2,
  /** Characters per second a viewer can comfortably read on mobile. */
  maxCps: 17,
  minSeconds: 0.7,
  maxSeconds: 6,
};

/** Motion tokens shared by every template (research §5: easing + durations). */
export const MOTION = {
  ease: {
    enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
    move: 'cubic-bezier(0.65, 0, 0.35, 1)',
    pop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  gsap: { enter: 'expo.out', exit: 'power3.in', move: 'power3.inOut', pop: 'back.out(1.6)' },
  durations: { micro: 0.2, text: 0.45, scene: 0.6, hold: 1.0, perWord: 0.3 },
  stagger: 0.06,
};
