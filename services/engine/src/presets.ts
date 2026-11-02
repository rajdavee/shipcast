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
  { id: 'og-card', label: 'Link preview (OG)', kind: 'image', width: 1200, height: 630, safe: { top: 65, right: 100, bottom: 65, left: 100 } },
  { id: 'x-image', label: 'X image (16:9)', kind: 'image', width: 1600, height: 900, maxBytes: 5 * MB, safe: box(60) },
  { id: 'story-image', label: 'Story card', kind: 'image', width: 1080, height: 1920, safe: { top: 270, right: 65, bottom: 380, left: 65 } },
  { id: 'github-banner', label: 'GitHub social preview', kind: 'image', width: 1280, height: 640, safe: box(40) },
  { id: 'linkedin-banner', label: 'LinkedIn banner', kind: 'image', width: 1584, height: 396, maxBytes: 8 * MB, safe: { top: 20, right: 20, bottom: 20, left: 420 }, notes: 'Profile photo covers the bottom-left.' },
  { id: 'x-header', label: 'X header', kind: 'image', width: 1500, height: 500, maxBytes: 2 * MB, safe: { top: 20, right: 20, bottom: 20, left: 360 } },
  { id: 'youtube-banner', label: 'YouTube channel art', kind: 'image', width: 2560, height: 1440, maxBytes: 6 * MB, safe: { top: 508, right: 507, bottom: 509, left: 507 }, notes: 'Only the centre 1546×423 shows on every device.' },
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
