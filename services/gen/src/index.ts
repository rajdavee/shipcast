import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { assertInHome, createService, getSecret, readSettings, run } from '@shipcast/engine';
import { fakeAdapter, falAdapter, fetchTo, fileHash, replicateAdapter, type Adapter } from './adapters.ts';
import { guard } from './guard.ts';
import { estimate, isVideo, MODELS, type Capability, type GenRequest, type ModelInfo, type Provider } from './registry.ts';
import { cacheDir, cacheKey, cached, checkBudget, record, route, spent, type Tier } from './router.ts';
import { compileShot, type Shot } from './shot.ts';

export { MODELS, compileShot, guard, route, estimate };
export type { Shot, Capability, ModelInfo, Tier };

export const GEN_PORT = 4324;

export interface GenerateInput {
  capability: Capability;
  /** A structured shot (preferred) or a raw prompt. */
  shot?: Shot;
  prompt?: string;
  /** Local files (inside the Shipcast home) used as inputs. */
  image?: string;
  images?: string[];
  endImage?: string;
  audio?: string;
  video?: string;
  aspect?: string;
  seconds?: number;
  resolution?: string;
  scale?: number;
  seed?: number;
  tier?: Tier;
  model?: string;
  /** Force a provider ("fake" = free placeholder). */
  provider?: Provider;
  /** Spend is tracked and capped per key (the campaign id). */
  budgetKey?: string;
  /** Where to write the result (inside the Shipcast home); extension is added. */
  out: string;
  realPerson?: boolean;
  consent?: string;
  /** Allow models whose licence forbids commercial use (default false). */
  nonCommercial?: boolean;
  /** Alternatives of the same shot (different seeds) to pick from; 1–3. */
  takes?: number;
  /** Internal: the budget for this request was already held by the caller. */
  preApproved?: boolean;
}

async function providers(force?: Provider): Promise<Provider[]> {
  if (force) return [force];
  if (process.env.SHIPCAST_GEN_FAKE === '1') return ['fake'];
  const p: Provider[] = [];
  if (await getSecret('fal')) p.push('fal');
  if (await getSecret('replicate')) p.push('replicate');
  return p.length ? p : ['fake'];
}

async function adapter(p: Provider, workDir: string): Promise<Adapter> {
  if (p === 'fal') return falAdapter((await getSecret('fal'))!);
  if (p === 'replicate') return replicateAdapter((await getSecret('replicate'))!);
  return fakeAdapter(workDir);
}

const caps = async () => {
  const s = (await readSettings()) as any;
  return { perKey: Number(s.genCapPerProject ?? 5), perMonth: Number(s.genCapPerMonth ?? 25) };
};

/** Plan without spending: the model the router would use, its prompt and the estimated cost. */
export async function planGeneration(i: Omit<GenerateInput, 'out'>) {
  const ps = await providers(i.provider);
  const ranked = route({ capability: i.capability, model: i.model, tier: i.tier, refs: i.images?.length, lastFrame: !!i.endImage, audio: !!i.audio, seconds: i.seconds, commercial: !i.nonCommercial, providers: ps });
  if (!ranked.length) throw new Error(`No connected model can do ${i.capability}${i.endImage ? ' with a pinned last frame' : ''}. Connect fal.ai in Setup → Media engines.`);
  const m = ranked[0];
  const compiled = i.shot ? compileShot(i.shot, m) : { prompt: i.prompt ?? '', negative: '' };
  return {
    model: m.id,
    label: m.label,
    provider: m.provider,
    prompt: compiled.prompt,
    negative: compiled.negative,
    usd: estimate(m, { seconds: i.seconds }),
    alternatives: ranked.slice(1, 4).map((x) => ({ model: x.id, label: x.label, usd: estimate(x, { seconds: i.seconds }), quality: x.quality })),
  };
}

export async function generate(i: GenerateInput, progress: (f: number, m: string) => void = () => {}) {
  const out = assertInHome(i.out, 'out');
  for (const f of [i.image, i.endImage, i.audio, i.video, ...(i.images ?? [])]) if (f) assertInHome(f, 'input');
  const plan = await planGeneration(i);
  const verdict = guard({ prompt: `${plan.prompt} ${i.prompt ?? ''}`, realPerson: i.realPerson, consent: i.consent });
  if (!verdict.ok) throw new Error(verdict.reason);
  const m = MODELS.find((x) => x.id === plan.model)!;
  const req: GenRequest = { capability: i.capability, prompt: plan.prompt || undefined, negative: plan.negative || undefined, aspect: i.aspect, seconds: i.seconds, resolution: i.resolution, seed: i.seed, scale: i.scale };
  const inputHashes = await Promise.all([i.image, i.endImage, i.audio, i.video, ...(i.images ?? [])].filter(Boolean).map((f) => fileHash(f!)));
  const ext = isVideo(m.capability) ? '.mp4' : m.capability === 'cutout' ? '.png' : '.png';
  const key = cacheKey(m.id, { ...req }, inputHashes);
  const target = extname(out) ? out : `${out}${ext}`;
  await mkdir(dirname(target), { recursive: true });
  const meta = { model: m.id, label: m.label, provider: m.provider, license: m.license, prompt: plan.prompt, negative: plan.negative, disclosure: verdict.disclose, createdAt: new Date().toISOString() };
  // Placeholders are cheap to redraw and change with the code; only paid results are cached.
  const hit = m.provider === 'fake' ? null : cached(key, ext);
  if (hit) {
    await copyFile(hit, target);
    await writeFile(`${target}.json`, JSON.stringify({ ...meta, usd: 0, cached: true }, null, 2));
    return { file: target, model: m.id, usd: 0, cached: true, prompt: plan.prompt, disclosure: verdict.disclose };
  }
  const budgetKey = i.budgetKey ?? 'adhoc';
  const release = i.preApproved ? () => {} : await checkBudget(budgetKey, plan.usd, await caps());
  try {
  const a = await adapter(m.provider, join(dirname(target), '.gen-work'));
  progress(0.1, `uploading inputs for ${m.label}`);
  const up = async (f?: string) => (f ? a.upload(f) : undefined);
  Object.assign(req, { image: await up(i.image), endImage: await up(i.endImage), audio: await up(i.audio), video: await up(i.video), images: i.images ? await Promise.all(i.images.map((f) => a.upload(f))) : undefined });
  progress(0.2, `${m.label}: submitted`);
  const res = await a.run(m, m.provider === 'fake' ? { ...req } : m.build(req), (s) => progress(0.5, `${m.label}: ${s}`));
  const urls = m.provider === 'fake' ? res.files : m.provider === 'replicate' ? [res.output].flat().filter((x: unknown) => typeof x === 'string') : m.parse(res);
  if (!urls?.length) throw new Error(`${m.label} returned no file`);
  progress(0.9, 'downloading');
  await fetchTo(urls[0], target);
  await record(budgetKey, m.id, plan.usd);
  } finally {
    release();
  }
  if (m.provider !== 'fake') {
    await mkdir(cacheDir(), { recursive: true });
    await copyFile(target, join(cacheDir(), `${key}${ext}`)).catch(() => {});
  }
  await writeFile(`${target}.json`, JSON.stringify({ ...meta, usd: plan.usd, cached: false }, null, 2));
  return { file: target, model: m.id, usd: plan.usd, cached: false, prompt: plan.prompt, disclosure: verdict.disclose };
}

/** Several takes of one shot: same prompt and inputs, different seeds; video takes get a poster frame. */
export async function generateTakes(i: GenerateInput, progress: (f: number, m: string) => void = () => {}) {
  const n = Math.min(3, Math.max(1, Math.round(i.takes ?? 1)));
  const plan = await planGeneration(i);
  // Budget the whole set up front so a cap never leaves you with one and a half takes.
  const release = await checkBudget(i.budgetKey ?? 'adhoc', plan.usd * n, await caps());
  const base = i.seed ?? 1000 + Math.floor(Math.random() * 9000);
  const out = [];
  for (let k = 0; k < n; k++) {
    progress(k / n, `take ${k + 1} of ${n}`);
    // The set's budget is already held, so each take skips its own check.
    const r = await generate({ ...i, takes: 1, preApproved: true, seed: base + k * 7919, out: n === 1 ? i.out : `${i.out}-t${k + 1}` }, (f, m) => progress((k + f) / n, m)).catch((e) => {
      release();
      throw e;
    });
    let poster: string | undefined;
    if (r.file.endsWith('.mp4')) {
      poster = r.file.replace(/\.mp4$/, '.jpg');
      await run('ffmpeg', ['-y', '-v', 'error', '-ss', '0.4', '-i', r.file, '-frames:v', '1', '-q:v', '3', poster]).catch(() => null);
    }
    out.push({ ...r, poster });
  }
  release();
  return { takes: out, usd: out.reduce((a, t) => a + t.usd, 0) };
}

export function createGenService() {
  return createService({
    name: 'gen',
    port: GEN_PORT,
    version: '0.1.0',
    concurrency: 2,
    health: async () => ({ providers: await providers(), spentThisMonth: (await spent()).month, caps: await caps() }),
    handlers: {
      models: async () => ({
        providers: await providers(),
        models: MODELS.filter((m) => m.provider !== 'fake').map(({ build, parse, ...m }) => m),
      }),
      plan: async (input: Omit<GenerateInput, 'out'>) => planGeneration(input),
      generate: async (input: GenerateInput, ctx) => ((input.takes ?? 1) > 1 ? generateTakes(input, ctx.progress) : generate(input, ctx.progress)),
      spend: async ({ key }: { key?: string }) => ({ ...(await spent(key)), caps: await caps() }),
    },
  });
}
