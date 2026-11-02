/**
 * Model registry: what each generator can do, what it costs, whether its
 * licence allows commercial use, and how it wants its prompt. Endpoint ids and
 * prices were read from fal.ai's public model catalog (Nov 2026); prices are
 * estimates the router uses to plan and to enforce budgets, not invoices.
 */

export type Capability = 't2i' | 'edit' | 'i2v' | 't2v' | 's2v' | 'lipsync' | 'upscale' | 'upscale-video' | 'cutout';
export type Provider = 'fal' | 'replicate' | 'fake';

export interface ModelInfo {
  id: string;
  provider: Provider;
  /** Provider endpoint (fal model id, Replicate owner/name). */
  endpoint: string;
  label: string;
  capability: Capability;
  /** Open weights (could be self-hosted) vs a closed API model. */
  open: boolean;
  license: string;
  commercialOK: boolean;
  /** Price per unit in USD, and the unit. */
  price: { usd: number; per: 'image' | 'second' | 'megapixel' | 'run' | 'video' };
  /** 1–5: how real and polished the output looks. */
  quality: number;
  /** 1–5: how fast a result comes back. */
  speed: number;
  /** What it accepts. */
  inputs: { refs?: number; firstFrame?: boolean; lastFrame?: boolean; audio?: boolean; video?: boolean };
  /** Durations (s) a video model accepts; the router picks the nearest. */
  durations?: number[];
  aspects?: string[];
  /** Prompt word budget the model handles well. */
  promptWords: number;
  /** Turn a generic request into this endpoint's payload. */
  build: (r: GenRequest) => Record<string, unknown>;
  /** Pull result file URLs out of the provider's response. */
  parse: (out: any) => string[];
  notes?: string;
}

export interface GenRequest {
  capability: Capability;
  prompt?: string;
  negative?: string;
  /** Uploaded/hosted URLs (the adapter uploads local files first). */
  image?: string;
  images?: string[];
  endImage?: string;
  audio?: string;
  video?: string;
  aspect?: string;
  seconds?: number;
  resolution?: string;
  seed?: number;
  scale?: number;
}

const FAL_SIZE: Record<string, string> = { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3', '4:5': 'portrait_4_3' };
const imgs = (o: any): string[] => (o?.images ?? (o?.image ? [o.image] : [])).map((x: any) => x?.url).filter(Boolean);
const vid = (o: any): string[] => [o?.video?.url].filter(Boolean);
const near = (want: number | undefined, opts: number[]) => opts.reduce((a, b) => (Math.abs(b - (want ?? opts[0])) < Math.abs(a - (want ?? opts[0])) ? b : a), opts[0]);

export const MODELS: ModelInfo[] = [
  // ── images ──────────────────────────────────────────────────────────────
  {
    id: 'flux2-klein-4b', provider: 'fal', endpoint: 'fal-ai/flux-2/klein/4b', label: 'FLUX.2 klein 4B', capability: 't2i', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.009, per: 'image' }, quality: 3, speed: 5, inputs: {}, promptWords: 120,
    build: (r) => ({ prompt: r.prompt, image_size: FAL_SIZE[r.aspect ?? '16:9'] ?? 'landscape_16_9', num_images: 1, enable_safety_checker: true, output_format: 'png', ...(r.seed ? { seed: r.seed } : {}) }),
    parse: imgs, notes: 'Fast, cheap, open weights — drafts and storyboard frames.',
  },
  {
    id: 'flux2-pro', provider: 'fal', endpoint: 'fal-ai/flux-2-pro', label: 'FLUX.2 Pro', capability: 't2i', open: false, license: 'BFL API terms', commercialOK: true,
    price: { usd: 0.03, per: 'megapixel' }, quality: 5, speed: 4, inputs: {}, promptWords: 200,
    build: (r) => ({ prompt: r.prompt, image_size: FAL_SIZE[r.aspect ?? '16:9'] ?? 'landscape_16_9', enable_safety_checker: true, safety_tolerance: '2', output_format: 'jpeg', ...(r.seed ? { seed: r.seed } : {}) }),
    parse: imgs, notes: 'Photoreal hero images: people, products, lifestyle.',
  },
  {
    id: 'qwen-image', provider: 'fal', endpoint: 'fal-ai/qwen-image-2512', label: 'Qwen-Image', capability: 't2i', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.02, per: 'megapixel' }, quality: 4, speed: 4, inputs: {}, promptWords: 200,
    build: (r) => ({ prompt: r.prompt, image_size: FAL_SIZE[r.aspect ?? '16:9'] ?? 'landscape_16_9', enable_safety_checker: true, ...(r.seed ? { seed: r.seed } : {}) }),
    parse: imgs, notes: 'Strong at legible text inside images (signage, packaging).',
  },
  {
    id: 'qwen-edit', provider: 'fal', endpoint: 'fal-ai/qwen-image-edit-2511', label: 'Qwen-Image-Edit 2511', capability: 'edit', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.03, per: 'image' }, quality: 4, speed: 3, inputs: { refs: 3 }, promptWords: 120,
    build: (r) => ({ prompt: r.prompt, image_urls: r.images ?? (r.image ? [r.image] : []), enable_safety_checker: true, output_format: 'png', ...(r.aspect ? { image_size: FAL_SIZE[r.aspect] } : {}), ...(r.seed ? { seed: r.seed } : {}) }),
    parse: imgs, notes: 'Product in hand, same character in a new scene, multi-reference composites.',
  },
  {
    id: 'flux2-pro-edit', provider: 'fal', endpoint: 'fal-ai/flux-2-pro/edit', label: 'FLUX.2 Pro edit', capability: 'edit', open: false, license: 'BFL API terms', commercialOK: true,
    price: { usd: 0.03, per: 'megapixel' }, quality: 5, speed: 3, inputs: { refs: 4 }, promptWords: 160,
    build: (r) => ({ prompt: r.prompt, image_urls: r.images ?? (r.image ? [r.image] : []), enable_safety_checker: true, ...(r.aspect ? { image_size: FAL_SIZE[r.aspect] } : {}) }),
    parse: imgs, notes: 'Highest-fidelity edits and reference-based composites.',
  },
  // ── video ───────────────────────────────────────────────────────────────
  {
    id: 'wan22-i2v', provider: 'fal', endpoint: 'fal-ai/wan/v2.2-a14b/image-to-video', label: 'Wan 2.2 A14B (image→video)', capability: 'i2v', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.08, per: 'second' }, quality: 4, speed: 3, inputs: { firstFrame: true, lastFrame: true }, durations: [5], aspects: ['16:9', '9:16', '1:1'], promptWords: 200,
    build: (r) => ({ prompt: r.prompt, image_url: r.image, ...(r.endImage ? { end_image_url: r.endImage } : {}), aspect_ratio: r.aspect ?? 'auto', resolution: r.resolution ?? '720p', negative_prompt: r.negative ?? '', enable_safety_checker: true, ...(r.seed ? { seed: r.seed } : {}) }),
    parse: vid, notes: 'Best open-weights motion; pins first and last frame.',
  },
  {
    id: 'ltx23-i2v', provider: 'fal', endpoint: 'fal-ai/ltx-2.3/image-to-video/fast', label: 'LTX-2.3 fast (image→video)', capability: 'i2v', open: true, license: 'LTX community (free under $10M revenue)', commercialOK: true,
    price: { usd: 0.06, per: 'second' }, quality: 3, speed: 5, inputs: { firstFrame: true, lastFrame: true }, durations: [6, 8, 10], aspects: ['16:9', '9:16'], promptWords: 80,
    build: (r) => ({ prompt: r.prompt, image_url: r.image, ...(r.endImage ? { end_image_url: r.endImage } : {}), aspect_ratio: r.aspect === '1:1' ? 'auto' : r.aspect ?? 'auto', duration: near(r.seconds, [6, 8, 10]), resolution: '1080p', generate_audio: false, enable_safety_checker: true }),
    parse: vid, notes: 'Cheap and quick B-roll; keep prompts short.',
  },
  {
    id: 'kling3-i2v', provider: 'fal', endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling 3 Pro (image→video)', capability: 'i2v', open: false, license: 'Kling API terms', commercialOK: true,
    price: { usd: 0.112, per: 'second' }, quality: 5, speed: 2, inputs: { firstFrame: true, lastFrame: true }, durations: [3, 4, 5, 6, 7, 8, 9, 10, 12, 15], promptWords: 120,
    build: (r) => ({ prompt: r.prompt, start_image_url: r.image, ...(r.endImage ? { end_image_url: r.endImage } : {}), duration: String(near(r.seconds, [3, 4, 5, 6, 7, 8, 9, 10, 12, 15])), negative_prompt: r.negative ?? 'blur, distort, and low quality', generate_audio: false, enable_safety_checker: true }),
    parse: vid, notes: 'Most convincing people and hands; premium tier.',
  },
  {
    id: 'seedance2-i2v', provider: 'fal', endpoint: 'bytedance/seedance-2.0/fast/image-to-video', label: 'Seedance 2.0 fast (image→video)', capability: 'i2v', open: false, license: 'ByteDance API terms', commercialOK: true,
    price: { usd: 0.24, per: 'second' }, quality: 5, speed: 3, inputs: { firstFrame: true, lastFrame: true }, durations: [4, 5, 6, 7, 8, 9, 10, 12, 15], aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], promptWords: 300,
    build: (r) => ({ prompt: r.prompt, image_url: r.image, ...(r.endImage ? { end_image_url: r.endImage } : {}), aspect_ratio: r.aspect ?? 'auto', duration: String(near(r.seconds, [4, 5, 6, 7, 8, 9, 10, 12, 15])), resolution: '720p', generate_audio: false }),
    parse: vid, notes: 'Cinematic multi-shot motion, UGC-style clips.',
  },
  {
    id: 'wan22-t2v', provider: 'fal', endpoint: 'fal-ai/wan/v2.2-a14b/text-to-video', label: 'Wan 2.2 A14B (text→video)', capability: 't2v', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.08, per: 'second' }, quality: 4, speed: 3, inputs: {}, durations: [5], aspects: ['16:9', '9:16', '1:1'], promptWords: 200,
    build: (r) => ({ prompt: r.prompt, aspect_ratio: r.aspect ?? '16:9', resolution: '720p', negative_prompt: r.negative ?? '', enable_safety_checker: true }),
    parse: vid,
  },
  // ── talking people ──────────────────────────────────────────────────────
  {
    id: 'infinitetalk', provider: 'fal', endpoint: 'fal-ai/infinitalk', label: 'InfiniteTalk (portrait + voice → talking video)', capability: 's2v', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.4, per: 'second' }, quality: 4, speed: 2, inputs: { firstFrame: true, audio: true }, promptWords: 60,
    build: (r) => ({ prompt: r.prompt ?? 'A person talking naturally to camera.', image_url: r.image, audio_url: r.audio, resolution: r.resolution ?? '720p', enable_safety_checker: true }),
    parse: vid, notes: 'UGC presenters from a synthetic portrait and a script voiceover.',
  },
  {
    id: 'wan22-s2v', provider: 'fal', endpoint: 'fal-ai/wan/v2.2-14b/speech-to-video', label: 'Wan 2.2 S2V (speech→video)', capability: 's2v', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.2, per: 'second' }, quality: 3, speed: 3, inputs: { firstFrame: true, audio: true }, promptWords: 80,
    build: (r) => ({ prompt: r.prompt ?? 'A person talking to camera.', image_url: r.image, audio_url: r.audio, resolution: '720p', enable_safety_checker: true }),
    parse: vid, notes: 'Budget talking head.',
  },
  {
    id: 'kling-avatar', provider: 'fal', endpoint: 'fal-ai/kling-video/ai-avatar/v2/pro', label: 'Kling AI Avatar v2 Pro', capability: 's2v', open: false, license: 'Kling API terms', commercialOK: true,
    price: { usd: 0.3, per: 'second' }, quality: 5, speed: 2, inputs: { firstFrame: true, audio: true }, promptWords: 40,
    build: (r) => ({ image_url: r.image, audio_url: r.audio, prompt: r.prompt ?? '.', enable_safety_checker: true }),
    parse: vid, notes: 'Premium presenter realism.',
  },
  {
    id: 'latentsync', provider: 'fal', endpoint: 'fal-ai/latentsync', label: 'LatentSync (re-sync lips to new audio)', capability: 'lipsync', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.2, per: 'run' }, quality: 4, speed: 3, inputs: { video: true, audio: true }, promptWords: 0,
    build: (r) => ({ video_url: r.video, audio_url: r.audio, enable_safety_checker: true }),
    parse: vid, notes: 'Dub an existing clip of a consenting person or a synthetic actor.',
  },
  // ── finishing ───────────────────────────────────────────────────────────
  {
    id: 'seedvr-image', provider: 'fal', endpoint: 'fal-ai/seedvr/upscale/image', label: 'SeedVR2 image upscale', capability: 'upscale', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.01, per: 'image' }, quality: 5, speed: 4, inputs: { firstFrame: true }, promptWords: 0,
    build: (r) => ({ image_url: r.image, upscale_mode: 'factor', upscale_factor: r.scale ?? 2, output_format: 'png', enable_safety_checker: true }),
    parse: imgs,
  },
  {
    id: 'seedvr-video', provider: 'fal', endpoint: 'fal-ai/seedvr/upscale/video', label: 'SeedVR2 video upscale', capability: 'upscale-video', open: true, license: 'Apache-2.0', commercialOK: true,
    price: { usd: 0.05, per: 'second' }, quality: 5, speed: 2, inputs: { video: true }, promptWords: 0,
    build: (r) => ({ video_url: r.video, upscale_mode: 'target', target_resolution: r.resolution ?? '1080p', enable_safety_checker: true }),
    parse: vid,
  },
  {
    id: 'birefnet', provider: 'fal', endpoint: 'fal-ai/birefnet/v2', label: 'BiRefNet v2 (background removal)', capability: 'cutout', open: true, license: 'MIT', commercialOK: true,
    price: { usd: 0.002, per: 'image' }, quality: 4, speed: 5, inputs: { firstFrame: true }, promptWords: 0,
    build: (r) => ({ image_url: r.image, model: 'General Use (Heavy)', output_format: 'png', refine_foreground: true }),
    parse: imgs,
  },
  // ── offline stand-in: lets every pipeline run (and be tested) with no key and no spend ──
  ...(['t2i', 'edit', 'i2v', 't2v', 's2v', 'lipsync', 'upscale', 'upscale-video', 'cutout'] as Capability[]).map(
    (cap): ModelInfo => ({
      id: `fake-${cap}`, provider: 'fake', endpoint: `fake/${cap}`, label: `Offline placeholder (${cap})`, capability: cap, open: true, license: 'n/a', commercialOK: true,
      price: { usd: 0, per: 'run' }, quality: 1, speed: 5, inputs: { refs: 4, firstFrame: true, lastFrame: true, audio: true, video: true }, promptWords: 400,
      build: (r) => ({ ...r }), parse: (o) => o.files ?? [], notes: 'Draws a labelled placeholder so layouts and timings can be reviewed before paying for generation.',
    }),
  ),
];

export const isVideo = (c: Capability) => c === 'i2v' || c === 't2v' || c === 's2v' || c === 'lipsync' || c === 'upscale-video';

/** Estimated cost of one request on a model. */
export function estimate(m: ModelInfo, r: { seconds?: number; megapixels?: number }): number {
  const secs = r.seconds ?? (m.durations ? m.durations[0] : 5);
  switch (m.price.per) {
    case 'second':
      return +(m.price.usd * secs).toFixed(4);
    case 'megapixel':
      return +(m.price.usd * Math.max(1, Math.ceil(r.megapixels ?? 1))).toFixed(4);
    default:
      return m.price.usd;
  }
}
