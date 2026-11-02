import type { ModelInfo } from './registry.ts';

/**
 * Shot compiler: packs describe shots, not prompts. A shot has five slots
 * (subject, motion, scene, framing, camera) plus light and look; the compiler
 * turns it into the wording each model responds to, within its word budget,
 * with camera language kept literal ("static" means no movement at all).
 */

export interface Shot {
  /** Who or what, specific: "a woman in her 40s, finance officer, navy blazer, reading a document". */
  subject: string;
  /** What moves and how (video): "looks up from the page and smiles slightly". */
  motion?: string;
  /** Where: "a quiet family-office meeting room, oak table, late afternoon". */
  scene?: string;
  /** Framing and placement: "medium close-up, subject left third, product on table right". */
  framing?: string;
  camera?: { move?: keyof typeof MOVES; lens?: keyof typeof LENSES; aperture?: keyof typeof APERTURES; angle?: keyof typeof ANGLES };
  light?: keyof typeof LIGHTS | string;
  look?: keyof typeof LOOKS | string;
  /** Things that must not appear. */
  avoid?: string[];
  /** Text that must be legible in the image, verbatim. */
  text?: string;
}

export const MOVES = {
  static: 'locked-off static camera, no camera movement at all',
  'slow-push': 'slow dolly push-in toward the subject',
  'pull-back': 'slow dolly pull-back revealing the room',
  'pan-left': 'slow pan left',
  'pan-right': 'slow pan right',
  orbit: 'slow half-orbit around the subject',
  handheld: 'subtle handheld camera, natural micro-movement, like a phone in a person\'s hand',
  'crane-up': 'crane up and over',
  tracking: 'tracking shot following the subject at walking pace',
} as const;

export const LENSES = {
  '24mm': '24mm wide lens, environmental perspective',
  '35mm': '35mm lens, natural documentary perspective',
  '50mm': '50mm lens, true-to-eye perspective',
  '85mm': '85mm portrait lens, flattering compression',
  '100mm-macro': '100mm macro lens, product detail',
  phone: 'smartphone front camera, slightly wide, vertical',
} as const;

export const APERTURES = {
  'f/1.4': 'f/1.4 shallow depth of field, creamy background blur',
  'f/2.8': 'f/2.8 soft background separation',
  'f/5.6': 'f/5.6 most of the scene in focus',
  'f/11': 'f/11 deep focus, everything sharp',
} as const;

export const ANGLES = {
  eye: 'eye-level',
  low: 'low angle looking up',
  high: 'high angle looking down',
  overhead: 'top-down overhead',
  'over-shoulder': 'over-the-shoulder',
} as const;

export const LIGHTS = {
  window: 'soft natural window light from the side',
  'golden-hour': 'warm golden-hour sunlight, long soft shadows',
  studio: 'clean three-point studio lighting, soft key light',
  office: 'bright even office daylight',
  night: 'moody evening interior light, warm practical lamps',
  overcast: 'diffused overcast daylight, no harsh shadows',
} as const;

export const LOOKS = {
  photoreal: 'photorealistic, natural skin texture, true-to-life colour, shot on a full-frame camera',
  ugc: 'authentic smartphone footage, unpolished, natural, like a real customer filmed it',
  editorial: 'editorial magazine photography, refined composition, subtle colour grade',
  cinematic: 'cinematic film still, anamorphic feel, gentle film grain, graded colour',
  product: 'premium commercial product photography, crisp detail, controlled reflections',
} as const;

const DEFAULT_AVOID = ['distorted hands', 'extra fingers', 'warped text', 'watermark', 'logo artifacts', 'plastic skin', 'uncanny face'];

const pick = (table: Record<string, string>, k?: string) => (k ? table[k] ?? k : '');

/** Turn a shot into the prompt (and negative prompt) for one model. */
export function compileShot(s: Shot, m: Pick<ModelInfo, 'promptWords' | 'capability'>): { prompt: string; negative: string } {
  const isVideo = m.capability === 'i2v' || m.capability === 't2v' || m.capability === 's2v';
  const cam = s.camera ?? {};
  const parts = [
    s.subject,
    isVideo && s.motion ? s.motion : '',
    s.scene ? `in ${s.scene.replace(/^in\s+/i, '')}` : '',
    s.framing ?? '',
    [pick(ANGLES, cam.angle), pick(LENSES, cam.lens), pick(APERTURES, cam.aperture)].filter(Boolean).join(', '),
    isVideo ? pick(MOVES, cam.move ?? 'static') : '',
    pick(LIGHTS, s.light),
    pick(LOOKS, s.look ?? 'photoreal'),
    s.text ? `the text "${s.text}" clearly legible` : '',
  ].filter((x) => x && x.trim());
  let prompt = parts.join('. ').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
  // Respect the model's word budget: drop the least important slots from the end first.
  const words = () => prompt.split(/\s+/).length;
  for (let n = parts.length; words() > m.promptWords && n > 2; n--) prompt = parts.slice(0, n - 1).join('. ');
  if (words() > m.promptWords) prompt = prompt.split(/\s+/).slice(0, m.promptWords).join(' ');
  const negative = [...DEFAULT_AVOID, ...(s.avoid ?? [])].join(', ');
  return { prompt, negative };
}
