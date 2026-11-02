import { createServer, type Server } from 'node:http';
import { existsSync, createWriteStream, realpathSync } from 'node:fs';
import { readdir, readFile, writeFile as writeFileP } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import {
  appendEvent,
  blockedReason,
  CATEGORIES,
  collectIncidents,
  readEvals,
  rankCards,
  readTrends,
  readLessons,
  setLessonStatus,
  claudeRunsToday,
  readJobs,
  readRuns,
  updateJob,
  campaignDir,
  claudeAuth,
  createCampaign,
  defaultOptions,
  deleteCampaign,
  doctor,
  getPack,
  githubStatus,
  installSkill,
  isSkillInstalled,
  listCampaigns,
  listPulls,
  listRepos,
  loadPacks,
  newId,
  parseRepo,
  readCampaign,
  variantSource,
  readEvents,
  readSettings,
  SETUPS,
  SPEC_FILE,
  callService,
  serviceHealth,
  SERVICE_PORTS,
  updateCampaign,
  appStatus,
  campaignSize,
  tidyCampaign,
  campaignIdle,
  startApp,
  stopApp,
  walk,
  writeSettings,
  WEB_DIST,
  type Campaign,
  type Pack,
  type Source,
  type Step,
  elevenVoices,
  readCampaignEnv,
  writeCampaignEnv,
  parseEnvText,
  boardFor,
  loadRegistry,
  hubState,
  installPackage,
  addCustomPackage,
  removeCustomPackage,
  setPackage,
  setRole,
  isEnabled,
  isInstalled,
  isPermissive,
  chatterboxReady,
  brainstorm,
  pexelsCheck,
  pixabayCheck,
  unsplashCheck,
  getSecret,
  setSecret,
  listTones,
  getTone,
  saveTone,
  deleteTone,
  learnTone,
  rewriteInVoice,
  scoreText,
  DEFAULT_TONE,
  CHANNELS,
  type Channel,
} from '@shipcast/engine';
import { HttpError, json, readJson, Router, sendFile } from './http.ts';
import { loginState, startClaudeLogin, startGithubLogin } from './connect.ts';

const router = new Router();

const packView = (p: Pack) => ({
  id: p.id,
  spec: p.spec ?? null,
  pipeline: p.pipeline ?? null,
  order: p.order ?? 99,
  name: p.name,
  tagline: p.tagline,
  category: p.category,
  estimate: p.estimate,
  accent: p.accent,
  sources: p.sources ?? [],
  options: p.options,
  tools: p.tools,
  skills: p.skills.map((s) => ({ ...s, installed: isSkillInstalled(s.name) })),
});

function makeStep(kind: Step['kind'], pack?: string, options: Record<string, string> = {}): Step {
  return { id: kind === 'brief' ? 'brief' : newId('d'), kind, pack, options, status: 'queued', outputs: [], revisions: [] };
}

async function mustCampaign(id: string): Promise<Campaign> {
  const c = await readCampaign(id);
  if (!c) throw new HttpError(404, 'campaign not found');
  return c;
}

async function packOptions(packId: string, given: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const pack = await getPack(packId);
  if (!pack) throw new HttpError(400, `unknown pack ${packId}`);
  const opts = defaultOptions(pack);
  // Per-piece creative direction (title, angle, brief) rides along with the options.
  for (const k of ['_title', '_angle', '_brief']) if (typeof given[k] === 'string' && given[k]) opts[k] = String(given[k]).slice(0, 2000);
  for (const o of pack.options) {
    const v = given[o.key];
    if (v === undefined || v === null) continue;
    const s = String(v).slice(0, 2000);
    if (o.type === 'select' && !o.choices.includes(s)) throw new HttpError(400, `${packId}.${o.key} must be one of ${o.choices.join(', ')}`);
    opts[o.key] = s;
  }
  return opts;
}

function validateSource(s: Partial<Source> | undefined): Source {
  if (!s?.type || !s.value?.trim()) throw new HttpError(400, 'source.type and source.value are required');
  const value = s.value.trim();
  switch (s.type) {
    case 'url': {
      const v = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      try {
        const u = new URL(v);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
      } catch {
        throw new HttpError(400, 'source.value is not a valid URL');
      }
      return { type: 'url', value: v };
    }
    case 'github': {
      const repo = parseRepo(value);
      if (!repo) throw new HttpError(400, 'GitHub source must be owner/repo or a github.com URL');
      return { type: 'github', value: repo, ref: s.ref?.trim() || undefined };
    }
    case 'local': {
      const abs = resolve(value.replace(/^~(?=$|[\\/])/, homedir()));
      if (!existsSync(abs)) throw new HttpError(400, `folder not found: ${abs}`);
      return { type: 'local', value: abs };
    }
    case 'text':
      return { type: 'text', value: value.slice(0, 20_000) };
    default:
      throw new HttpError(400, 'unknown source type');
  }
}

// ── connection + health ────────────────────────────────────────────────
router.get('/api/status', async () => {
  const [claude, github] = await Promise.all([claudeAuth(), githubStatus()]);
  return { claude, github, logins: { claude: loginState('claude'), github: loginState('github') } };
});
router.get('/api/doctor', () => doctor());
const setupRuns = new Map<string, Promise<{ ok: boolean; log: string }>>();
router.post('/api/setup/:id', async (_q, _r, p) => {
  if (!Object.hasOwn(SETUPS, p.id)) throw new HttpError(404, 'unknown setup');
  // One install at a time per engine; a second click waits for the first.
  let job = setupRuns.get(p.id);
  if (!job) {
    job = SETUPS[p.id as keyof typeof SETUPS].run().finally(() => setupRuns.delete(p.id));
    setupRuns.set(p.id, job);
  }
  return job;
});
router.post('/api/connect/claude', () => startClaudeLogin());
router.post('/api/connect/github', () => startGithubLogin());
router.get('/api/github/repos', () => listRepos());
router.get('/api/github/pulls', (_q, _r, _p, url) => listPulls(url.searchParams.get('repo') ?? ''));

// ── packs + engine skills ──────────────────────────────────────────────
router.get('/api/packs', async () => (await loadPacks()).map(packView));
router.post('/api/packs/:id/install', async (req, _res, p) => {
  const pack = await getPack(p.id);
  if (!pack) throw new HttpError(404, 'unknown pack');
  const results = [];
  for (const dep of pack.skills) {
    if (isSkillInstalled(dep.name)) continue;
    results.push({ skill: dep.name, ...(await installSkill(dep)) });
  }
  return { pack: packView(pack), results };
});

// ── capability services ────────────────────────────────────────────────
router.get('/api/services', async () => {
  const names = Object.keys(SERVICE_PORTS) as (keyof typeof SERVICE_PORTS)[];
  const health = await Promise.all(names.map((n) => serviceHealth(n)));
  return names.map((n, i) => ({ name: n, ok: !!health[i], ...(health[i] ?? {}) }));
});

const catalogs = new Map<string, { at: number; data: unknown }>();
router.get('/api/catalog/:kind', async (_q, _r, p) => {
  const svc = p.kind === 'storyboard' ? 'render' : p.kind === 'deck' || p.kind === 'graphics' ? 'stills' : null;
  if (!svc) throw new HttpError(404, 'unknown catalog');
  const hit = catalogs.get(svc);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  try {
    const data = await callService(svc, 'catalog', {}, { timeoutMs: 15_000 });
    catalogs.set(svc, { at: Date.now(), data });
    return data;
  } catch (e) {
    throw new HttpError(503, (e as Error).message);
  }
});

router.get('/api/settings', () => readSettings());
router.put('/api/settings', async (req) => {
  const body = await readJson(req);
  const patch: Record<string, unknown> = {};
  if (typeof body.model === 'string') patch.model = body.model.trim();
  if (Array.isArray(body.allowedTools)) patch.allowedTools = body.allowedTools.map(String).filter((t: string) => /^[\w():*, .-]+$/.test(t));
  if (body.subagents === 'pack' || body.subagents === 'never') patch.subagents = body.subagents;
  if (typeof body.directorReview === 'boolean') patch.directorReview = body.directorReview;
  if (typeof body.criticReview === 'boolean') patch.criticReview = body.criticReview;
  if (Number.isFinite(body.stepTimeoutMinutes)) patch.stepTimeoutMinutes = Math.min(240, Math.max(5, Number(body.stepTimeoutMinutes)));
  if (Number.isFinite(body.genCapPerProject)) patch.genCapPerProject = Math.min(1000, Math.max(0, Number(body.genCapPerProject)));
  if (Number.isFinite(body.genCapPerMonth)) patch.genCapPerMonth = Math.min(10000, Math.max(0, Number(body.genCapPerMonth)));
  if (typeof body.agentsPaused === 'boolean') patch.agentsPaused = body.agentsPaused;
  for (const k of ['agentsQuietStart', 'agentsQuietEnd'] as const) if (typeof body[k] === 'string' && /^\d{1,2}:\d{2}$/.test(body[k])) patch[k] = body[k];
  if (Number.isFinite(body.agentsMaxClaudeRunsPerDay)) patch.agentsMaxClaudeRunsPerDay = Math.min(50, Math.max(0, Math.round(Number(body.agentsMaxClaudeRunsPerDay))));
  return writeSettings(patch);
});

// ── background agents: list, switch on/off, change cadence, run now ─────
router.get('/api/agents', async () => {
  const s = await readSettings();
  const jobs = await readJobs();
  return {
    paused: s.agentsPaused,
    quiet: { start: s.agentsQuietStart, end: s.agentsQuietEnd },
    cap: s.agentsMaxClaudeRunsPerDay,
    usedToday: await claudeRunsToday(),
    jobs: await Promise.all(jobs.map(async (j) => ({ ...j, waiting: j.running ? '' : await blockedReason({ ...j, runNow: false }, s) }))),
    runs: (await readRuns()).slice(-30).reverse(),
  };
});
router.put('/api/agents/:id', async (req, _r, p) => {
  const body = await readJson(req);
  const patch: { enabled?: boolean; every?: number } = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (Number.isFinite(body.every)) patch.every = Number(body.every);
  try {
    return await updateJob(p.id, patch);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
});
// ── trend radar: cards the trends agent keeps fresh ────────────────────
router.get('/api/trends', async (req) => {
  const all = new URL(req.url ?? '/', 'http://x').searchParams.get('archived') === '1';
  const feed = await readTrends();
  return { refreshedAt: feed.refreshedAt ?? null, sources: feed.sources ?? {}, cards: rankCards(feed.cards.filter((c) => all || !c.archived)) };
});
router.post('/api/trends/refresh', async () => updateJob('trends', { runNow: true }));

// ── quality over time: eval and nightly-check scores per format ─────────
router.get('/api/quality', async () => {
  const evals = await readEvals(new Date(Date.now() - 120 * 86_400_000));
  const formats: Record<string, { at: string; avg: number; golden: boolean; low: string }[]> = {};
  for (const e of evals)
    for (const p of e.pieces) {
      const low = Object.entries(p.scores ?? {}).sort((a, b) => Number(a[1]) - Number(b[1]))[0];
      (formats[p.pack] ??= []).push({ at: e.at, avg: p.avg, golden: !!e.golden, low: low ? `${low[0]} ${low[1]}` : '' });
    }
  return { formats, runs: evals.length };
});

// ── learning loop: lessons per format, with the incidents behind them ──
router.get('/api/lessons', async () => {
  const lessons = await readLessons();
  const { incidents, runs } = await collectIncidents();
  const packs: Record<string, { runs: number; categories: Record<string, number> }> = {};
  for (const [p, r] of Object.entries(runs)) packs[p] = { runs: r.length, categories: {} };
  for (const i of incidents) {
    if (i.category === 'infra') continue;
    const p = (packs[i.pack] ??= { runs: 0, categories: {} });
    p.categories[i.category] = (p.categories[i.category] ?? 0) + 1;
  }
  const byId = new Map(incidents.map((i) => [i.id, i]));
  return {
    categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
    packs,
    lessons: lessons.map((l) => ({ ...l, examples: l.evidence.map((id) => byId.get(id)?.text).filter(Boolean).slice(0, 3) })),
  };
});
router.put('/api/lessons/:id', async (req, _r, p) => {
  const { status } = await readJson(req);
  if (status !== 'off' && status !== 'trial') throw new HttpError(400, 'status must be "off" or "trial"');
  try {
    return await setLessonStatus(p.id, status);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
});
router.post('/api/agents/:id/run', async (_q, _r, p) => {
  try {
    return await updateJob(p.id, { runNow: true });
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
});

// ── voice (optional: your own ElevenLabs key; Kokoro is the free default) ─
let voiceList: { at: number; voices: unknown[] } | null = null;
router.get('/api/voice', async () => {
  const s = await readSettings();
  const connected = !!(await getSecret('elevenlabs'));
  let voices: unknown[] = [];
  let error: string | undefined;
  if (connected) {
    try {
      if (!voiceList || Date.now() - voiceList.at > 10 * 60_000) voiceList = { at: Date.now(), voices: await elevenVoices() };
      voices = voiceList.voices;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const provider = s.voiceProvider === 'chatterbox' ? (chatterboxReady() ? 'chatterbox' : 'kokoro') : connected ? s.voiceProvider : 'kokoro';
  return { provider, connected, chatterbox: chatterboxReady(), voice: s.elevenVoice, model: s.elevenModel, voices, error };
});
router.put('/api/voice', async (req) => {
  const b = await readJson(req);
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    const key = b.apiKey.trim();
    let voices;
    try {
      voices = await elevenVoices(key);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    await setSecret('elevenlabs', key);
    voiceList = { at: Date.now(), voices };
    const s = await readSettings();
    await writeSettings({ voiceProvider: 'elevenlabs', elevenVoice: s.elevenVoice || voices[0]?.id || '' });
  }
  const patch: Record<string, unknown> = {};
  if (b.provider === 'kokoro' || b.provider === 'elevenlabs' || b.provider === 'chatterbox') patch.voiceProvider = b.provider;
  if (typeof b.voice === 'string' && /^[\w-]{0,64}$/.test(b.voice)) patch.elevenVoice = b.voice;
  if (typeof b.model === 'string' && /^[\w.-]{1,64}$/.test(b.model)) patch.elevenModel = b.model;
  if (Object.keys(patch).length) await writeSettings(patch);
  const s = await readSettings();
  return { provider: s.voiceProvider, connected: !!(await getSecret('elevenlabs')), voice: s.elevenVoice, model: s.elevenModel };
});
router.delete('/api/voice/elevenlabs', async () => {
  await setSecret('elevenlabs', null);
  voiceList = null;
  await writeSettings({ voiceProvider: 'kokoro' });
  return { provider: 'kokoro', connected: false };
});

// ── stock footage and photos (optional: your own free keys; Pixabay first) ──
const STOCK_CHECKS: Record<string, (key: string) => Promise<void>> = { pixabay: pixabayCheck, unsplash: unsplashCheck, pexels: pexelsCheck };
const stockState = async () => {
  const providers: Record<string, boolean> = {};
  for (const id of Object.keys(STOCK_CHECKS)) providers[id] = !!(await getSecret(id));
  return { connected: providers.pixabay || providers.pexels, photos: Object.values(providers).some(Boolean), providers };
};
router.get('/api/broll', () => stockState());
router.put('/api/broll', async (req) => {
  const b = await readJson(req);
  const provider = typeof b.provider === 'string' ? b.provider : 'pixabay';
  const check = STOCK_CHECKS[provider];
  if (!check) throw new HttpError(400, 'provider must be pixabay, unsplash or pexels');
  const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
  if (!key) throw new HttpError(400, 'apiKey is required');
  try {
    await check(key);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  await setSecret(provider, key);
  return stockState();
});
router.delete('/api/broll/:provider', async (_q, _r, p) => {
  if (!STOCK_CHECKS[p.provider]) throw new HttpError(404, 'unknown provider');
  await setSecret(p.provider, null);
  return stockState();
});
router.delete('/api/broll', async () => {
  await setSecret('pexels', null);
  return stockState();
});

// ── Tone & Voice: brand voice profiles, scoring and rewrites ──────────
router.get('/api/tones', () => listTones());
router.get('/api/tones/:id', async (_q, _r, p) => (await getTone(p.id)) ?? Promise.reject(new HttpError(404, 'no such voice')));
router.put('/api/tones', async (req) => saveTone(await readJson(req)));
router.delete('/api/tones/:id', async (_q, _r, p) => {
  if (p.id === 'default') throw new HttpError(400, 'the default voice stays');
  await deleteTone(p.id);
  return { ok: true };
});
router.post('/api/tones/learn', async (req) => {
  const b = await readJson(req);
  const samples = Array.isArray(b.samples) ? b.samples.map(String) : typeof b.samples === 'string' ? String(b.samples).split(/\n{2,}|\n(?=https?:)/) : [];
  const base = typeof b.id === 'string' ? ((await getTone(b.id)) ?? undefined) : undefined;
  try {
    const learned = await learnTone({ name: typeof b.name === 'string' ? b.name : undefined, samples, base });
    return b.save === false ? learned : saveTone(learned);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
const channelOf = (v: unknown) => (typeof v === 'string' && (CHANNELS as string[]).includes(v) ? (v as Channel) : undefined);
router.post('/api/tones/score', async (req) => {
  const b = await readJson(req);
  const tone = (await getTone(String(b.toneId ?? 'default'))) ?? DEFAULT_TONE;
  return scoreText(String(b.text ?? '').slice(0, 50_000), tone, channelOf(b.channel));
});
router.post('/api/tones/rewrite', async (req) => {
  const b = await readJson(req);
  const tone = (await getTone(String(b.toneId ?? 'default'))) ?? DEFAULT_TONE;
  const text = String(b.text ?? '').slice(0, 8000);
  if (!text.trim()) throw new HttpError(400, 'text is required');
  try {
    return await rewriteInVoice(text, tone, channelOf(b.channel));
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
});

// ── media engines for "Anything": stock, generative, sound effects (all optional, your own keys) ──
const PROVIDERS: Record<string, { label: string; check?: (key: string) => Promise<void> }> = {
  pixabay: { label: 'Pixabay', check: pixabayCheck },
  unsplash: { label: 'Unsplash', check: unsplashCheck },
  pexels: { label: 'Pexels', check: pexelsCheck },
  fal: { label: 'fal.ai' },
  replicate: {
    label: 'Replicate',
    check: async (key) => {
      const r = await fetch('https://api.replicate.com/v1/account', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 401 || r.status === 403) throw new Error('Replicate rejected that token');
      if (!r.ok) throw new Error(`Replicate check failed (${r.status})`);
    },
  },
  youtube: {
    label: 'YouTube Data API',
    check: async (key) => {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&chart=mostPopular&maxResults=1&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 400 || r.status === 403) throw new Error('YouTube rejected that API key');
      if (!r.ok) throw new Error(`YouTube check failed (${r.status})`);
    },
  },
  freesound: {
    label: 'Freesound',
    check: async (key) => {
      const r = await fetch(`https://freesound.org/apiv2/search/text/?query=whoosh&page_size=1&token=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 401 || r.status === 403) throw new Error('Freesound rejected that key');
      if (!r.ok) throw new Error(`Freesound check failed (${r.status})`);
    },
  },
};
router.get('/api/providers', async () => {
  const out: Record<string, { label: string; connected: boolean }> = {};
  for (const [id, p] of Object.entries(PROVIDERS)) out[id] = { label: p.label, connected: !!(await getSecret(id)) };
  return out;
});
router.put('/api/providers/:id', async (req, _r, p) => {
  const prov = PROVIDERS[p.id];
  if (!prov) throw new HttpError(404, 'unknown provider');
  const b = await readJson(req);
  const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
  if (!key) throw new HttpError(400, 'apiKey is required');
  try {
    await prov.check?.(key);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  await setSecret(p.id, key);
  return { connected: true };
});
router.delete('/api/providers/:id', async (_q, _r, p) => {
  if (!PROVIDERS[p.id]) throw new HttpError(404, 'unknown provider');
  await setSecret(p.id, null);
  return { connected: false };
});

// ── brainstorm: a short conversation before a campaign ─────────────────
router.post('/api/brainstorm', async (req) => {
  const b = await readJson(req);
  const source = validateSource(b.source);
  const formats = Array.isArray(b.formats) ? b.formats.map(String).slice(0, 12) : [];
  const answers = b.answers && typeof b.answers === 'object' ? Object.fromEntries(Object.entries(b.answers).map(([k, v]) => [String(k).slice(0, 32), String(v).slice(0, 400)])) : undefined;
  const asked = Array.isArray(b.asked) ? b.asked.slice(0, 4) : undefined;
  const s = await readSettings();
  try {
    const catalogue = (await loadPacks()).filter((p) => p.spec || p.pipeline === 'shorts' || p.category === 'copy').map((p) => p.id);
    const turn = await brainstorm({ source, formats, notes: typeof b.notes === 'string' ? b.notes.slice(0, 2000) : '', answers, asked, reply: typeof b.reply === 'string' ? b.reply.slice(0, 600) : undefined, catalogue, model: undefined });
    return { ...turn, formats: (turn.formats ?? []).filter((f) => catalogue.includes(f)) };
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
});

// ── Skill Hub: upstream skills, installed pinned and isolated, mixed per role ─
async function skillsView() {
  const [reg, s] = await Promise.all([loadRegistry(), hubState()]);
  const roles: Record<string, { candidates: { id: string; skill: string; name: string }[]; chosen?: string; effective?: string }> = {};
  for (const p of reg) for (const [role, skill] of Object.entries(p.roles)) (roles[role] ??= { candidates: [] }).candidates.push({ id: p.id, skill, name: p.name });
  for (const r of Object.keys(roles)) {
    roles[r].chosen = s.roles[r];
    const live = reg.filter((p) => p.roles[r] && isEnabled(p, s) && (isPermissive(p.licence) || s.accepted[p.id]));
    roles[r].effective = (live.find((p) => p.id === s.roles[r]) ?? live.sort((a, b) => b.verdict - a.verdict)[0])?.name;
  }
  return {
    packages: reg.map((p) => ({ ...p, installed: isInstalled(p, s), enabled: isEnabled(p, s), permissive: isPermissive(p.licence), accepted: !!s.accepted[p.id] })),
    roles,
  };
}
router.get('/api/skills', () => skillsView());
router.post('/api/skills/:id/install', async (req, _r, p) => {
  const b = await readJson(req).catch(() => ({}));
  const r = await installPackage(p.id, { acceptLicence: b?.acceptLicence === true });
  if (!r.ok) throw new HttpError(400, r.log);
  return { ...(await skillsView()), log: r.log };
});
router.post('/api/skills/custom', async (req) => {
  const b = await readJson(req);
  try {
    const pkg = await addCustomPackage(String(b.url ?? ''));
    return { ...(await skillsView()), added: pkg.id };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
router.delete('/api/skills/custom/:id', async (_q, _r, p) => {
  await removeCustomPackage(p.id);
  return skillsView();
});
router.put('/api/skills/roles', async (req) => {
  const b = await readJson(req);
  if (typeof b.role !== 'string' || !/^[\w-]{1,40}$/.test(b.role)) throw new HttpError(400, 'role is required');
  await setRole(b.role, typeof b.id === 'string' && b.id ? b.id : null);
  return skillsView();
});
router.put('/api/skills/:id', async (req, _r, p) => {
  const b = await readJson(req);
  await setPackage(p.id, { enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined });
  return skillsView();
});

router.post('/api/brainstorm/board', async (req) => {
  const b = await readJson(req);
  const source = validateSource(b.source);
  try {
    return { beats: await boardFor({ source, formats: Array.isArray(b.formats) ? b.formats.map(String).slice(0, 12) : [], notes: typeof b.notes === 'string' ? b.notes.slice(0, 3000) : '', direction: b.direction && typeof b.direction === 'object' ? b.direction : undefined, length: typeof b.length === 'string' ? b.length.slice(0, 20) : undefined }) };
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
});

// ── campaigns ──────────────────────────────────────────────────────────
router.get('/api/campaigns', () => listCampaigns());

router.post('/api/campaigns', async (req) => {
  const b = await readJson(req);
  const source = validateSource(b.source);
  const deliverables: { pack: string; options?: Record<string, unknown> }[] = Array.isArray(b.deliverables) ? b.deliverables : [];
  if (!deliverables.length) throw new HttpError(400, 'pick at least one deliverable');
  const steps = [makeStep('brief')];
  for (const d of deliverables.slice(0, 20)) steps.push(makeStep('pack', d.pack, await packOptions(d.pack, d.options)));
  const fallbackName = source.type === 'url' ? new URL(source.value).hostname.replace(/^www\./, '') : source.type === 'github' ? source.value.split('/')[1] : source.type === 'local' ? basename(source.value) : 'Untitled campaign';
  const created = await createCampaign({
    name: String(b.name || fallbackName).slice(0, 120),
    source,
    goal: String(b.goal ?? '').slice(0, 500),
    audience: String(b.audience ?? '').slice(0, 500),
    tone: String(b.tone ?? '').slice(0, 200),
    notes: String(b.notes ?? '').slice(0, 4000),
    ...(typeof b.toneId === 'string' && (await getTone(b.toneId)) ? { toneId: b.toneId } : {}),
    steps,
  });
  // Env vars and a test login for running the app (stored with the campaign, never returned).
  const env: Record<string, string> = typeof b.env === 'string' ? parseEnvText(b.env) : {};
  if (b.login && typeof b.login === 'object') {
    if (b.login.email) env.SHIPCAST_LOGIN_EMAIL = String(b.login.email).slice(0, 200);
    if (b.login.password) env.SHIPCAST_LOGIN_PASSWORD = String(b.login.password).slice(0, 200);
    if (b.login.url) env.SHIPCAST_APP_URL = String(b.login.url).slice(0, 300);
  }
  if (Object.keys(env).length) await writeCampaignEnv(created.id, env);
  return created;
});

router.get('/api/campaigns/:id', (_q, _r, p) => mustCampaign(p.id));

router.delete('/api/campaigns/:id', async (_q, _r, p) => {
  const c = await mustCampaign(p.id);
  if (c.steps.some((s) => s.status === 'running')) throw new HttpError(409, 'stop the running step first');
  // Don't leave the user's app (dev servers, Docker services) running for a campaign that's gone.
  await stopApp(c).catch(() => []);
  await deleteCampaign(p.id);
  return { ok: true };
});

router.post('/api/campaigns/:id/steps', async (req, _r, p) => {
  const b = await readJson(req);
  const step = makeStep('pack', b.pack, await packOptions(b.pack, b.options));
  const { campaign } = await updateCampaign(p.id, (c) => void c.steps.push(step));
  await appendEvent(p.id, { step: step.id, type: 'log', text: `Added ${b.pack}` });
  return campaign;
});

async function mutateStep(id: string, stepId: string, fn: (s: Step, c: Campaign) => void) {
  await mustCampaign(id);
  const { campaign } = await updateCampaign(id, (c) => {
    const s = c.steps.find((x) => x.id === stepId);
    if (!s) throw new HttpError(404, 'step not found');
    fn(s, c);
  });
  return campaign;
}

// A step paused with a question: store secret answers as env vars, resume the same session with the rest.
router.post('/api/campaigns/:id/steps/:step/answer', async (req, _r, p) => {
  const b = await readJson(req);
  const values: Record<string, string> = b.values && typeof b.values === 'object' ? b.values : {};
  const c = await mustCampaign(p.id);
  const st = c.steps.find((x) => x.id === p.step);
  if (!st || st.status !== 'needs-input' || !st.question) throw new HttpError(409, 'this step is not waiting for an answer');
  const env: Record<string, string> = {};
  const said: string[] = [];
  for (const f of st.question.fields) {
    const v = String(values[f.key] ?? '').slice(0, 4000);
    if (!v.trim()) continue;
    if (f.secret || /^[A-Z][A-Z0-9_]+$/.test(f.key)) {
      env[f.key] = v;
      said.push(`${f.label}: provided — it's now in your shell environment as ${f.key}`);
    } else said.push(`${f.label}: ${v}`);
  }
  if (typeof b.note === 'string' && b.note.trim()) said.push(`Note from the user: ${b.note.trim().slice(0, 2000)}`);
  if (!said.length) throw new HttpError(400, 'answer at least one field');
  if (Object.keys(env).length) await writeCampaignEnv(p.id, env);
  return mutateStep(p.id, p.step, (s) => {
    s.status = 'queued';
    s.pendingNote = `[answer] Question: ${st.question!.text}\n${said.join('\n')}`;
    s.question = undefined;
    s.error = undefined;
  });
});
router.get('/api/campaigns/:id/env', async (_q, _r, p) => {
  await mustCampaign(p.id);
  return { keys: Object.keys(await readCampaignEnv(p.id)) };
});
router.put('/api/campaigns/:id/env', async (req, _r, p) => {
  await mustCampaign(p.id);
  const b = await readJson(req);
  const patch: Record<string, string | null> = typeof b.text === 'string' ? parseEnvText(b.text) : {};
  for (const k of Array.isArray(b.remove) ? b.remove : []) patch[String(k)] = null;
  return { keys: await writeCampaignEnv(p.id, patch) };
});

router.post('/api/campaigns/:id/steps/:step/revise', async (req, _r, p) => {
  const { note } = await readJson(req);
  if (!note?.trim()) throw new HttpError(400, 'note is required');
  const c = await mutateStep(p.id, p.step, (s) => {
    if (s.status === 'running' || s.status === 'queued') throw new HttpError(409, 'step is already queued or running');
    s.pendingNote = String(note).slice(0, 4000);
    s.status = 'queued';
    s.error = undefined;
  });
  await appendEvent(p.id, { step: p.step, type: 'log', text: `Revision queued: ${note}` });
  return c;
});

/** Hook variants: a new step that rewrites only the opening of a finished piece, N ways, and renders each. */
router.post('/api/campaigns/:id/steps/:step/variants', async (req, _r, p) => {
  const b = await readJson(req);
  const c = await mustCampaign(p.id);
  try {
    await variantSource(c, p.step);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const src = c.steps.find((s) => s.id === p.step)!;
  const count = String(Math.min(8, Math.max(2, Number(b.count) || 4)));
  const title = `Hook variants · ${src.options._title ?? (await getPack(src.pack!))?.name ?? src.pack}`;
  const step = makeStep('pack', 'hook-variants', { of: p.step, count, _title: title });
  const { campaign } = await updateCampaign(p.id, (x) => {
    x.steps.push(step);
  });
  await appendEvent(p.id, { step: step.id, type: 'log', text: `${count} hook variants queued for ${title.replace('Hook variants · ', '')}` });
  return campaign;
});

router.post('/api/campaigns/:id/steps/:step/retry', async (_q, _r, p) =>
  mutateStep(p.id, p.step, (s, c) => {
    if (s.status === 'running') throw new HttpError(409, 'step is running');
    s.status = 'queued';
    s.error = undefined;
    s.pendingNote = undefined;
    s.sessionId = undefined;
    s.autoRetries = undefined;
    s.notBefore = undefined;
    // Retrying the brief unblocks everything that was waiting on it.
    if (s.kind === 'brief') for (const x of c.steps) if (x.status === 'blocked') x.status = 'queued';
  }),
);

router.post('/api/campaigns/:id/steps/:step/cancel', async (_q, _r, p) => {
  const c = await mutateStep(p.id, p.step, (s) => {
    if (s.status === 'running') s.cancelRequested = true;
    else if (s.status === 'queued' || s.status === 'blocked' || s.status === 'needs-input') {
      s.status = 'canceled';
      s.pendingNote = undefined;
      s.question = undefined;
    }
  });
  if (campaignIdle(c)) await stopApp(c).catch(() => []);
  return c;
});

router.get('/api/campaigns/:id/size', async (_q, _r, p) => campaignSize(await mustCampaign(p.id)));
router.post('/api/campaigns/:id/cleanup', async (req, _r, p) => {
  const c = await mustCampaign(p.id);
  if (c.steps.some((s) => s.status === 'running')) throw new HttpError(409, 'wait for the running step to finish');
  const b = await readJson(req).catch(() => ({}));
  const r = await tidyCampaign(c, { app: !!b.app });
  await appendEvent(p.id, { step: 'brief', type: 'log', text: `Freed ${(r.freed / 1e9).toFixed(1)} GB` });
  return { ...r, ...(await campaignSize(c)) };
});

// The user's app, as app-run left it.
router.get('/api/campaigns/:id/app', async (_q, _r, p) => appStatus(await mustCampaign(p.id)));
router.post('/api/campaigns/:id/app/start', async (_q, _r, p) => {
  const c = await mustCampaign(p.id);
  const r = await startApp(c);
  await appendEvent(p.id, { step: 'brief', type: 'log', text: r.up ? 'App started' : `App didn't start: ${r.log.slice(-1)[0] ?? ''}` });
  return { ...(await appStatus(c)), log: r.log };
});
/** Add keys the app step couldn't get: resume that step to wire them in, then capture the screens again. */
router.post('/api/campaigns/:id/app/unlock', async (req, _r, p) => {
  const c = await mustCampaign(p.id);
  const b = await readJson(req);
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries((b.values ?? {}) as Record<string, unknown>)) if (/^[A-Z][A-Z0-9_]*$/.test(k) && String(v ?? '').trim()) values[k] = String(v).trim().slice(0, 4000);
  if (!Object.keys(values).length) throw new HttpError(400, 'add at least one value');
  if (c.steps.some((s) => s.status === 'running')) throw new HttpError(409, 'wait for the running step to finish');
  await writeCampaignEnv(p.id, values);
  const names = Object.keys(values).join(', ');
  const { campaign } = await updateCampaign(p.id, (x) => {
    const run = [...x.steps].reverse().find((s) => s.pack === 'app-run' && s.status === 'done');
    if (!run) throw new HttpError(400, 'run the app first');
    Object.assign(run, { status: 'queued', error: undefined, pendingNote: run.sessionId ? `[answer] The user added these environment variables (already in your shell): ${names}. Replace the placeholders in the app's config with them, restart the app (update work/pids), check the features they unlock now work, and update out/app.json (drop them from optional) and out/setup.md.` : undefined });
    for (const s of x.steps) if (s.pack === 'app-capture' && s.status !== 'running') Object.assign(s, { status: 'queued', error: undefined, sessionId: undefined, pendingNote: undefined });
  });
  await appendEvent(p.id, { step: 'brief', type: 'log', text: `Added ${names} — reconfiguring the app, then capturing again` });
  return campaign;
});

router.post('/api/campaigns/:id/app/stop', async (_q, _r, p) => {
  const c = await mustCampaign(p.id);
  if (c.steps.some((s) => s.status === 'running' && s.pack && s.pack !== 'campaign-hub')) throw new HttpError(409, 'a step is using the app right now');
  const log = await stopApp(c);
  await appendEvent(p.id, { step: 'brief', type: 'log', text: `App stopped${log.length ? ` (${log.length} command(s))` : ''}` });
  return { ...(await appStatus(c)), log };
});

router.delete('/api/campaigns/:id/steps/:step', async (_q, _r, p) =>
  mutateStep(p.id, p.step, (s, c) => {
    if (s.kind === 'brief') throw new HttpError(400, 'the brief cannot be removed');
    if (s.status === 'running') throw new HttpError(409, 'stop it first');
    c.steps = c.steps.filter((x) => x.id !== s.id);
  }),
);

// Spec formats: read and edit the JSON the render services consume.
async function specPath(id: string, stepId: string) {
  const c = await mustCampaign(id);
  const step = c.steps.find((s) => s.id === stepId);
  if (!step?.pack) throw new HttpError(404, 'step not found');
  const pack = await getPack(step.pack);
  if (!pack?.spec) throw new HttpError(400, 'this format has no editable spec');
  return { file: join(campaignDir(id), 'deliverables', stepId, 'out', SPEC_FILE[pack.spec]), kind: pack.spec, step };
}

/** Re-render every finished spec-based asset with the current engine (no new Claude run), then rebuild the hub. */
router.post('/api/campaigns/:id/rerender', async (_q, _r, p) => {
  const c = await mustCampaign(p.id);
  const ids: string[] = [];
  for (const s of c.steps) {
    if (s.kind !== 'pack' || s.status !== 'done' || !s.pack) continue;
    const pack = await getPack(s.pack);
    if (pack?.spec && existsSync(join(campaignDir(p.id), 'deliverables', s.id, 'out', SPEC_FILE[pack.spec]))) ids.push(s.id);
  }
  if (!ids.length) throw new HttpError(400, 'nothing to re-render yet');
  const { campaign } = await updateCampaign(p.id, (x) => {
    for (const s of x.steps) {
      if (ids.includes(s.id)) Object.assign(s, { status: 'queued', renderOnly: true, error: undefined });
      else if (s.pack === 'campaign-hub' && s.status !== 'running') Object.assign(s, { status: 'queued', error: undefined });
    }
  });
  await appendEvent(p.id, { step: 'brief', type: 'log', text: `Re-rendering ${ids.length} asset(s) with the latest engine` });
  return campaign;
});

router.get('/api/campaigns/:id/steps/:step/spec', async (_q, _r, p) => {
  const { file, kind } = await specPath(p.id, p.step);
  if (!existsSync(file)) throw new HttpError(404, 'no spec yet — the format has not run');
  return { kind, spec: JSON.parse(await readFile(file, 'utf8')) };
});

router.put('/api/campaigns/:id/steps/:step/spec', async (req, _r, p) => {
  const { file, step } = await specPath(p.id, p.step);
  if (step.status === 'running' || step.status === 'queued') throw new HttpError(409, 'wait for the current run to finish');
  const body = await readJson(req);
  if (!body.spec || typeof body.spec !== 'object') throw new HttpError(400, 'spec is required');
  await writeFileP(file, JSON.stringify(body.spec, null, 2));
  const c = await mutateStep(p.id, p.step, (s) => {
    s.status = 'queued';
    s.renderOnly = true;
    s.error = undefined;
  });
  await appendEvent(p.id, { step: p.step, type: 'log', text: 'Edits saved — re-rendering' });
  return c;
});

// ── takes: alternative generated shots; pick one and the piece re-renders without Claude ──
interface Take { id: string; label: string; kind: string; files: string[]; posters: string[]; chosen: number }
const takesFile = (id: string, step: string) => join(campaignDir(id), 'deliverables', step, 'out', 'takes.json');
const takesDir = (id: string, step: string) => join(campaignDir(id), 'deliverables', step, 'out', 'takes');
/** All takes for a step: one file per shot under out/takes/ (plus a legacy takes.json). */
async function readTakes(id: string, step: string): Promise<{ all: Take[]; save: (t: Take) => Promise<void> }> {
  const all: Take[] = [];
  const where = new Map<string, string>();
  try {
    for (const t of JSON.parse(await readFile(takesFile(id, step), 'utf8')) as Take[]) {
      all.push(t);
      where.set(t.id, takesFile(id, step));
    }
  } catch {}
  for (const f of await readdir(takesDir(id, step)).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    try {
      const t = JSON.parse(await readFile(join(takesDir(id, step), f), 'utf8')) as Take;
      all.push(t);
      where.set(t.id, join(takesDir(id, step), f));
    } catch {}
  }
  const save = async (t: Take) => {
    const file = where.get(t.id)!;
    if (file === takesFile(id, step)) await writeFileP(file, JSON.stringify(all.filter((x) => where.get(x.id) === file), null, 2));
    else await writeFileP(file, JSON.stringify(t, null, 2));
  };
  return { all, save };
}
const rel = (id: string, f: string) => (f.startsWith(campaignDir(id)) ? f.slice(campaignDir(id).length + 1) : f);
router.get('/api/campaigns/:id/steps/:step/takes', async (_q, _r, p) => {
  await mustCampaign(p.id);
  const { all } = await readTakes(p.id, p.step);
  return all.map((t) => ({ ...t, files: t.files.map((f) => rel(p.id, f)), posters: t.posters.map((f) => rel(p.id, f)) }));
});
router.post('/api/campaigns/:id/steps/:step/takes', async (req, _r, p) => {
  const b = await readJson(req);
  const { file, step } = await specPath(p.id, p.step);
  if (step.status === 'running' || step.status === 'queued') throw new HttpError(409, 'wait for the current run to finish');
  const { all, save } = await readTakes(p.id, p.step);
  const t = all.find((x) => x.id === b.id);
  const k = Number(b.choose);
  if (!t || !Number.isInteger(k) || k < 0 || k >= t.files.length) throw new HttpError(400, 'unknown take');
  if (k === t.chosen) return mustCampaign(p.id);
  // Swap every reference to the current take (absolute or relative) for the chosen one.
  const from = t.files[t.chosen];
  const to = t.files[k];
  let spec = await readFile(file, 'utf8');
  const variants = [from, rel(p.id, from), from.split('/out/').pop()!].filter(Boolean);
  let hit = false;
  for (const v of variants) if (spec.includes(JSON.stringify(v).slice(1, -1))) {
    spec = spec.split(JSON.stringify(v).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
    hit = true;
    break;
  }
  if (!hit) throw new HttpError(409, 'that take is no longer used in the piece — edit it in the spec instead');
  await writeFileP(file, spec);
  t.chosen = k;
  await save(t);
  const c = await mutateStep(p.id, p.step, (s) => {
    s.status = 'queued';
    s.renderOnly = true;
    s.error = undefined;
  });
  await appendEvent(p.id, { step: p.step, type: 'log', text: `Take ${k + 1} chosen for “${t.label}” — re-rendering` });
  return c;
});

// Quick look: compile an edited storyboard and snapshot each scene (no full render).
router.post('/api/campaigns/:id/steps/:step/preview', async (req, _r, p) => {
  const { kind } = await specPath(p.id, p.step);
  if (kind !== 'storyboard') throw new HttpError(400, 'previews are for video formats');
  const body = await readJson(req);
  const outDir = join(campaignDir(p.id), 'deliverables', p.step, 'work', 'preview');
  try {
    const r = await callService('render', 'preview', { storyboard: body.spec, outDir, brandDir: join(campaignDir(p.id), 'brief') }, { timeoutMs: 600_000 });
    const root = campaignDir(p.id) + '/';
    return { frames: (r.frames as string[]).map((f) => f.replace(root, '')), scenes: r.scenes, duration: r.duration };
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
});

// Server-sent events: replays the log, then tails it.
router.get('/api/campaigns/:id/events', async (req, res, p) => {
  await mustCampaign(p.id);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  let offset = 0;
  let lastUpdated = '';
  let closed = false;
  req.on('close', () => (closed = true));
  while (!closed) {
    const r = await readEvents(p.id, offset);
    offset = r.offset;
    for (const e of r.events) res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`);
    const c = await readCampaign(p.id);
    if (!c) break;
    if (c.updatedAt !== lastUpdated) {
      lastUpdated = c.updatedAt;
      res.write(`event: campaign\ndata: ${JSON.stringify(c)}\n\n`);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  res.end();
  return undefined;
});

/** Resolve a path inside a campaign folder, refusing anything that escapes it. */
function safePath(id: string, rel: string): string {
  const root = campaignDir(id);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new HttpError(403, 'outside campaign');
  if (/(^|\/)(source|\.lock)(\/|$)/.test(rel)) throw new HttpError(403, 'not served');
  if (!insideReal(root, abs)) throw new HttpError(403, 'outside campaign');
  return abs;
}

/** True if `file` exists and, with symlinks resolved, still lives under `root`. */
function insideReal(root: string, file: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(file);
    return real === realRoot || real.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

router.get('/api/campaigns/:id/files/*', (req, res, p) => {
  const file = safePath(p.id, p.rest);
  // Generated files are untrusted: HTML/SVG get an opaque sandboxed origin so
  // they can never script the studio or call this api.
  const headers: Record<string, string> = { 'content-security-policy': 'sandbox allow-scripts' };
  if (new URL(req.url!, 'http://x').searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${basename(file)}"`;
  sendFile(req, res, file, headers);
  return undefined;
});

router.get('/api/campaigns/:id/tree', async (_q, _r, p) => {
  await mustCampaign(p.id);
  const root = campaignDir(p.id);
  const [brief, deliverables, uploads] = await Promise.all([walk(join(root, 'brief')), walk(join(root, 'deliverables')), walk(join(root, 'uploads'))]);
  return { brief, deliverables, uploads };
});

router.post('/api/campaigns/:id/uploads', async (req, _r, p) => {
  await mustCampaign(p.id);
  const name = basename(new URL(req.url!, 'http://x').searchParams.get('name') ?? '').replace(/[^\w.\- ]/g, '_');
  if (!name || name.startsWith('.')) throw new HttpError(400, 'name is required');
  const dir = join(campaignDir(p.id), 'uploads');
  await mkdir(dir, { recursive: true });
  let size = 0;
  const limit = 2 * 1024 ** 3;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) req.destroy(new Error('too large'));
  });
  await pipeline(req, createWriteStream(join(dir, name)));
  await appendEvent(p.id, { step: '-', type: 'log', text: `Uploaded ${name}` });
  return { name, size };
});

// Zip every deliverable (system `zip`, falling back to tar.gz).
router.get('/api/campaigns/:id/export', async (req, res, p) => {
  const c = await mustCampaign(p.id);
  const root = campaignDir(p.id);
  const paths = ['brief/brief.md', 'brief/brand.json', ...c.steps.flatMap((s) => (s.kind === 'pack' ? s.outputs.map((o) => `deliverables/${s.id}/${o}`) : []))].filter((f) => insideReal(root, join(root, f)));
  const useZip = process.platform !== 'win32';
  const child = useZip ? spawn('zip', ['-q', '-', ...paths], { cwd: root }) : spawn('tar', ['-czf', '-', ...paths], { cwd: root });
  res.writeHead(200, {
    'content-type': useZip ? 'application/zip' : 'application/gzip',
    'content-disposition': `attachment; filename="${c.name.replace(/[^\w-]+/g, '-')}-shipcast.${useZip ? 'zip' : 'tar.gz'}"`,
  });
  child.stdout.pipe(res);
  return undefined;
});

router.post('/api/campaigns/:id/reveal', async (_q, _r, p) => {
  await mustCampaign(p.id);
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(opener, [campaignDir(p.id)], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
});

// ── server ─────────────────────────────────────────────────────────────
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp({ serveWeb = true } = {}): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      // The api can make Claude run tools, so only local pages may call it:
      // reject foreign Host headers (DNS rebinding) and cross-site writes.
      if (!LOCAL_HOSTS.test(req.headers.host ?? '')) throw new HttpError(403, 'forbidden host');
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin) {
        const host = new URL(origin).host;
        if (!LOCAL_HOSTS.test(host)) throw new HttpError(403, 'forbidden origin');
      }
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method === 'HEAD' ? 'GET' : req.method!, url.pathname);
        if (!m) throw new HttpError(404, 'no such route');
        const out = await m.handler(req, res, m.params, url);
        if (out !== undefined && !res.headersSent) json(res, 200, out);
        return;
      }
      if (!serveWeb) throw new HttpError(404, 'not found');
      if (!existsSync(WEB_DIST)) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('Shipcast UI is not built yet. Run `npm run build`, or use `npm run dev`.');
      }
      const file = resolve(WEB_DIST, '.' + url.pathname);
      const inside = file.startsWith(WEB_DIST + sep);
      const asset = inside && existsSync(file) && !url.pathname.endsWith('/');
      // Hashed build assets are immutable; the HTML shell must always revalidate.
      const cache = asset && url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      sendFile(req, res, asset ? file : join(WEB_DIST, 'index.html'), { 'cache-control': cache });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  });
}
