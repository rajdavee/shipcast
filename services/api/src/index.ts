import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, createWriteStream, realpathSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile as writeFileP } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import {
  appendEvent,
  sessionUser,
  can,
  roleIn,
  isInstallOwnerSync,
  rootHome,
  claudeConnection,
  currentContext,
  runAs,
  type WorkContext,
  CALENDAR_CHANNELS,
  criticCalibration,
  moreLikeThis,
  rankForYou,
  remix,
  suggestedSlots,
  addSnapshot,
  collectNow,
  home,
  MAX_SCREENSHOT_BYTES,
  pendingNumbers,
  readMetricsFromImage,
  computePerformance,
  deleteSnapshot,
  importMetricsCsv,
  postPerformance,
  readSnapshots,
  forecastCalibration,
  forecastPost,
  publicPlaybook,
  readPlaybook,
  recordForecast,
  refreshPlaybook,
  heldByPostiz,
  postizWithdraw,
  planMonth,
  planProject,
  syncMadePosts,
  channelProblems,
  deletePost,
  getPost,
  importCsv,
  listPosts,
  readPlan,
  savePlan,
  savePost,
  scheduleProblems,
  toCsv,
  toIcs,
  type ChannelId,
  type Post,
  type PostStatus,
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
  campaignTone,
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
  connections,
  disconnect,
  kitTexts,
  mediaFiles,
  oauthFinish,
  oauthStart,
  OAUTH_PROVIDERS,
  PROVIDER_NAMES,
  tagChannel,
  ga4Properties,
  saveSiteSettings,
  searchSites,
  siteStatus,
  syncSite,
  countView,
  createShare,
  listShares,
  listWorkspaces,
  reportCardPng,
  reportCsv,
  reportHtml,
  reportMarkdown,
  reportPdf,
  reportPptx,
  resolveShare,
  revokeShare,
  revokeSharesFor,
  topPostImage,
  publicSchedule,
  publicSmtp,
  readSchedule,
  saveSchedule,
  saveSmtp,
  sendReport,
  testEmail,
  askReport,
  workspacesFor,
  type Report,
  postizIntegrations,
  PublishError,
  queueSendNow,
  redactSecrets,
  saveClientKeys,
  savePostiz,
  updateChannel,
  type OAuthProvider,
} from '@shipcast/engine';
import { addNote, createReport, deleteNote, deleteReport, editReport, getReport, listReports, readGoals, readNotes, reportVersions, restoreVersion, rewriteReport, runRecommendation, saveGoals } from '@shipcast/engine';
import { HttpError, json, readBody, readJson, Router, sendFile } from './http.ts';
import { cookieToken, gate, registerAuthRoutes, type Caller } from './gate.ts';
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
  const by = currentContext()?.user;
  return { id: kind === 'brief' ? 'brief' : newId('d'), kind, pack, options, status: 'queued', outputs: [], revisions: [], ...(by ? { by } : {}) };
}

async function mustCampaign(id: string): Promise<Campaign> {
  const c = await readCampaign(id);
  if (!c) throw new HttpError(404, 'campaign not found');
  return c;
}

async function packOptions(packId: string, given: Record<string, unknown> = {}): Promise<Record<string, string>> {
  if (APP_PACKS.has(packId) && !callerIsInstallOwner()) throw new HttpError(403, "Running an app on this machine is for the person who set up this Shipcast.");
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

/** Whether the signed-in caller set this install up (no caller: a single-user install, which is its owner). */
function callerIsInstallOwner(): boolean {
  const uid = currentContext()?.user;
  return !uid || isInstallOwnerSync(uid);
}
/** Packs that run the user's own app on this machine. */
const APP_PACKS = new Set(['app-run', 'app-capture']);

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
      // A folder on this machine: only the person who set the install up, and never Shipcast's own data.
      if (!callerIsInstallOwner()) throw new HttpError(403, "Only the person who set up this Shipcast can use a folder on this machine as a source — use a URL, a public GitHub repo or a description.");
      const abs = resolve(value.replace(/^~(?=$|[\\/])/, homedir()));
      if (!existsSync(abs)) throw new HttpError(400, `folder not found: ${abs}`);
      const real = realpathSync(abs);
      const root = realpathSync(rootHome());
      if (real === root || real.startsWith(root + sep) || root.startsWith(real + sep)) throw new HttpError(400, "Shipcast's own data folder can't be a source.");
      return { type: 'local', value: real };
    }
    case 'text':
      return { type: 'text', value: value.slice(0, 20_000) };
    default:
      throw new HttpError(400, 'unknown source type');
  }
}

// ── connection + health ────────────────────────────────────────────────
router.get('/api/status', async () => {
  const [machine, github] = await Promise.all([claudeAuth(), githubStatus()]);
  // What matters is the Claude this person's runs will use: their own, or (install owner only) the machine's.
  const uid = currentContext()?.user;
  const mine = uid ? await claudeConnection(uid) : null;
  const claude = !mine || mine.method === 'machine' ? machine : { ...machine, loggedIn: mine.connected, method: mine.method === 'token' ? 'Claude token' : 'Anthropic API key', account: undefined };
  // The machine's own sign-ins (and their in-progress login links) are the install owner's business.
  if (!callerIsInstallOwner()) return { claude: { ...claude, ...(mine?.method === 'none' ? { account: undefined } : {}) }, github: { installed: github.installed, loggedIn: false }, logins: {} };
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
  // Up/down only: a service's own report can describe whichever workspace it last worked for.
  return names.map((n, i) => ({ name: n, ok: !!health[i], ...(health[i] ? { version: (health[i] as { version?: string }).version } : {}) }));
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
  if (typeof body.publishingPaused === 'boolean') patch.publishingPaused = body.publishingPaused;
  if (typeof body.metricsPaused === 'boolean') patch.metricsPaused = body.metricsPaused;
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
// ── content calendar: posts across channels, the plan, ICS and CSV ──────
const calendarQuery = (req: { url?: string }) => new URL(req.url ?? '/', 'http://x').searchParams;
router.get('/api/calendar/channels', () => CALENDAR_CHANNELS);
router.get('/api/calendar/posts', async (req) => {
  const q = calendarQuery(req);
  // Finished deliverables attach their files to the posts that asked for them.
  await syncMadePosts().catch(() => 0);
  return listPosts({ from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, channel: q.get('channel') ?? undefined, unscheduled: q.get('unscheduled') === '1', status: (q.get('status') ?? '').split(',').filter(Boolean) as PostStatus[] });
});
/** Moving, unscheduling or deleting a post Postiz already holds: withdraw it there and arm the channel again. */
async function withdrawFromPostiz(old: Post, why: string) {
  for (const c of heldByPostiz(old)) {
    try {
      await postizWithdraw(c.remoteId!);
    } catch (e) {
      throw new HttpError(502, `Couldn't take the post back from Postiz (${(e as Error).message}) — change it there or try again.`);
    }
    await updateChannel(old.id, c.channel, { state: 'pending', remoteId: undefined, sentAt: undefined, url: undefined, note: why });
  }
}

async function checkedSave(body: Partial<Post>, id?: string) {
  const old = id ? await getPost(id) : undefined;
  if (id && !old) throw new HttpError(404, 'post not found');
  if (old && heldByPostiz(old).length && ((body.at !== undefined && body.at !== old.at) || (body.status && body.status !== old.status))) await withdrawFromPostiz(old, 'Withdrawn from Postiz after a change; it goes again at the new time.');
  const merged = { ...(id ? await getPost(id) : {}), ...body } as Post;
  if (body.status === 'scheduled') {
    const problems = scheduleProblems(merged);
    if (problems.length) throw new HttpError(400, problems.join(' '));
    // Scheduling is what arms the publisher: only `pending` channels ever go out.
    merged.channels = merged.channels.map((c) => (c.state === 'sent' || c.state === 'sending' ? c : { ...c, state: 'pending', error: undefined, attempts: undefined, retryAt: undefined }));
  }
  const saved = await savePost({ ...merged, ...(id ? { id } : { id: undefined }) });
  // What the model expected at scheduling time, so it can be scored once the numbers are in. Never blocks the save.
  if (body.status === 'scheduled') await recordForecast(saved).catch(() => {});
  return saved;
}
router.post('/api/calendar/posts', async (req) => checkedSave(await readJson(req)));
router.put('/api/calendar/posts/:id', async (req, _r, p) => checkedSave(await readJson(req), p.id));
router.delete('/api/calendar/posts/:id', async (_q, _r, p) => {
  const old = await getPost(p.id);
  if (old) await withdrawFromPostiz(old, 'Withdrawn from Postiz before deleting.');
  if (!(await deletePost(p.id))) throw new HttpError(404, 'post not found');
  return { ok: true };
});
router.get('/api/calendar/posts/:id/check', async (_q, _r, p) => {
  const post = await getPost(p.id);
  if (!post) throw new HttpError(404, 'post not found');
  return { problems: scheduleProblems(post), channels: Object.fromEntries(post.channels.map((c) => [c.channel, channelProblems(c)])) };
});
router.get('/api/calendar/plan', () => readPlan());
// A trend card becomes an idea in the backlog, carrying its recipe.
router.post('/api/calendar/from-trend', async (req) => {
  const { key, channel: ch } = await readJson(req);
  const card = (await readTrends()).cards.find((c) => c.key === key);
  if (!card) throw new HttpError(404, 'trend not found');
  const target = ([ch, card.platform, 'linkedin'] as string[]).find((x) => CALENDAR_CHANNELS.some((c) => c.id === x))!;
  return savePost({
    title: card.title.slice(0, 120),
    status: 'idea',
    format: card.recipe.pack,
    trend: card.key,
    notes: [card.what, card.recipe.angle && `Angle: ${card.recipe.angle}`, card.recipe.hookPattern && `Hook pattern: ${card.recipe.hookPattern}`, card.recipe.structure.length ? `Structure: ${card.recipe.structure.join(' → ')}` : ''].filter(Boolean).join('\n'),
    channels: [{ channel: target as any, caption: '', hashtags: [], media: [], via: 'manual' }],
  });
});

router.post('/api/calendar/plan-month', async (req) => {
  const b = await readJson(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.to ?? '')) throw new HttpError(400, 'from and to must be YYYY-MM-DD');
  try {
    return await planMonth({ from: b.from, to: b.to, project: typeof b.project === 'string' ? b.project : undefined });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
// Make it: the post becomes a deliverable in its project; its files attach when it renders.
router.post('/api/calendar/posts/:id/make', async (req, _r, p) => {
  const post = await getPost(p.id);
  if (!post) throw new HttpError(404, 'post not found');
  const b = await readJson(req);
  const project = await planProject(typeof b.project === 'string' ? b.project : post.campaign);
  if (!project) throw new HttpError(400, 'Make a project for your product first (Create) — the post is made from its research.');
  const format = String(b.format ?? post.format ?? '');
  if (!(await getPack(format))) throw new HttpError(400, `pick a format for this post (unknown "${format}")`);
  const brief = [post.notes, ...post.channels.map((c) => `${c.channel} caption: ${c.caption}`)].filter(Boolean).join('\n').slice(0, 1800);
  const step = makeStep('pack', format, await packOptions(format, { _title: post.title, _brief: `Content calendar post${post.at ? ` for ${post.at.slice(0, 10)}` : ''}. ${brief}` }));
  await updateCampaign(project.id, (c) => void c.steps.push(step));
  await appendEvent(project.id, { step: step.id, type: 'log', text: `Added ${format} from the content calendar: ${post.title}` });
  return savePost({ id: post.id, campaign: project.id, step: step.id, format, status: post.status === 'idea' ? 'idea' : 'draft' });
});

router.put('/api/calendar/plan', async (req) => savePlan(await readJson(req)));
router.get('/api/calendar.ics', async (_q, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' });
  res.end(toIcs(await listPosts()));
  return undefined;
});
router.get('/api/calendar/export.csv', async (_q, res) => {
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="shipcast-calendar.csv"' });
  res.end(toCsv(await listPosts()));
  return undefined;
});
router.post('/api/calendar/import', async (req) => {
  const { csv } = await readJson(req);
  if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'send { csv: "<file contents>" }');
  const r = await importCsv(csv.slice(0, 2_000_000), (await readPlan()).tz);
  return { created: r.created.length, problems: r.problems };
});

// ── publishing: manual kits, direct LinkedIn/YouTube, the Postiz bridge ──
async function mustPost(id: string): Promise<Post> {
  const post = await getPost(id);
  if (!post) throw new HttpError(404, 'post not found');
  return post;
}
/** Provider and publishing errors reach the UI only after every stored secret is masked. */
async function publishCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(e instanceof PublishError ? 400 : 502, await redactSecrets((e as Error).message));
  }
}
const oauthProvider = (p: string): OAuthProvider => {
  if (!OAUTH_PROVIDERS.includes(p as OAuthProvider)) throw new HttpError(404, 'unknown provider');
  return p as OAuthProvider;
};
router.get('/api/publish/connections', () => connections());
for (const provider of OAUTH_PROVIDERS)
  router.put(`/api/publish/${provider}`, async (req) => {
    const b = await readJson(req);
    await publishCall(() => saveClientKeys(provider, String(b.clientId ?? '').trim(), String(b.clientSecret ?? '').trim()));
    return connections();
  });
router.put('/api/publish/postiz', async (req) => {
  const b = await readJson(req);
  const list = await publishCall(() => savePostiz(String(b.url ?? ''), String(b.apiKey ?? '')));
  return { ...(await connections()), integrations: list };
});
router.get('/api/publish/postiz/integrations', () => publishCall(() => postizIntegrations()));
// OAuth state → the workspace and person who started it, so the connection lands in that workspace (10 minutes).
const oauthOwners = new Map<string, { ctx: WorkContext; at: number }>();
router.get('/api/publish/:provider/connect', async (req, _r, p) => {
  const provider = oauthProvider(p.provider);
  // The redirect goes to this very server, on the port the browser reached it on.
  const r = await publishCall(() => oauthStart(provider, req.socket.localPort ?? 4317));
  const state = new URL(r.url).searchParams.get('state');
  const ctx = currentContext();
  if (state && ctx) oauthOwners.set(state, { ctx, at: Date.now() });
  for (const [k, v] of oauthOwners) if (Date.now() - v.at > 10 * 60_000) oauthOwners.delete(k);
  return r;
});
router.delete('/api/publish/:provider', async (_q, _r, p, url) => {
  const provider = p.provider === 'postiz' ? 'postiz' : oauthProvider(p.provider);
  await disconnect(provider, url.searchParams.get('keys') === '1');
  return connections();
});

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const callbackPage = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;margin:15vh auto;max-width:28rem;text-align:center;color:#222"><h1 style="font-size:22px">${esc(title)}</h1><p>${esc(text)}</p></body>`;
router.get('/oauth/:provider/callback', async (_q, res, p, url) => {
  const q = url.searchParams;
  let status = 200;
  let page: string;
  try {
    const provider = oauthProvider(p.provider);
    if (q.get('error')) throw new PublishError(`Sign-in was cancelled (${(q.get('error_description') || q.get('error') || '').slice(0, 120)}).`);
    const { account } = await oauthFinish(provider, q.get('state') ?? '', q.get('code') ?? '');
    page = callbackPage('Connected — you can close this tab', `${PROVIDER_NAMES[provider]}${account ? ` (${account})` : ''} ${provider === 'google' ? 'are' : 'is'} connected to Shipcast.`);
  } catch (e) {
    status = 400;
    page = callbackPage('Not connected', await redactSecrets((e as Error).message));
  }
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' });
  res.end(page);
  return undefined;
});

function findChannel(post: Post, ch: string) {
  const c = post.channels.find((x) => x.channel === ch);
  if (!c) throw new HttpError(404, `post has no ${ch} channel`);
  return c;
}
router.post('/api/calendar/posts/:id/channels/:channel/sent', async (req, _r, p) => {
  const post = await mustPost(p.id);
  const c = findChannel(post, p.channel);
  if (c.state === 'sending') throw new HttpError(409, 'It is being sent right now.');
  const b = await readJson(req);
  const link = typeof b.url === 'string' ? b.url.trim() : '';
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new HttpError(400, 'url must be an http(s) link');
  return updateChannel(post.id, c.channel, { state: 'sent', sentAt: new Date().toISOString(), error: undefined, retryAt: undefined, ...(link ? { url: link.slice(0, 1000) } : {}) }, c.account);
});
router.post('/api/calendar/posts/:id/send-now', async (_q, _r, p) => {
  const post = await mustPost(p.id);
  const next = await publishCall(() => queueSendNow(post));
  return { post: next, note: 'Queued — the publisher picks it up within about 20 seconds.' };
});

// Post kit: the media plus ready-to-paste copy, one zip.
router.get('/api/calendar/posts/:id/kit/:channel', async (_q, res, p) => {
  const post = await mustPost(p.id);
  const c = findChannel(post, p.channel);
  const files = await publishCall(async () => mediaFiles(c));
  const dir = await mkdtemp(join(tmpdir(), 'shipcast-kit-'));
  try {
    for (const [name, text] of Object.entries(kitTexts(post, await tagChannel(post.id, c)))) await writeFileP(join(dir, name), text);
    // Numbered links keep the posting order and stop two files with the same name colliding.
    for (const [i, f] of files.entries()) await symlink(f, join(dir, `${String(i + 1).padStart(2, '0')}-${basename(f)}`));
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  const slug = `${post.title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'post'}-${c.channel}`;
  const child = spawn('zip', ['-q', '-r', '-', '.'], { cwd: dir });
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${slug}-kit.zip"` });
  child.stdout.pipe(res);
  const clean = () => void rm(dir, { recursive: true, force: true });
  child.on('close', clean);
  child.on('error', () => (res.end(), clean()));
  return undefined;
});

// ── pulse: numbers after a post went out ──────────────────────────────
router.get('/api/metrics/posts/:id', async (_q, _r, p) => {
  if (!(await getPost(p.id))) throw new HttpError(404, 'post not found');
  return postPerformance(p.id);
});
router.post('/api/metrics/snapshots', async (req) => {
  const b = await readJson(req);
  if (typeof b.post !== 'string' || typeof b.channel !== 'string') throw new HttpError(400, 'post and channel are required');
  try {
    return await addSnapshot({ ...b, source: ['manual', 'screenshot'].includes(b.source) ? b.source : 'manual' });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
router.delete('/api/metrics/snapshots/:id', async (_q, _r, p) => {
  if (!(await deleteSnapshot(p.id))) throw new HttpError(404, 'snapshot not found');
  return { ok: true };
});
router.post('/api/metrics/import', async (req) => {
  const { csv, channel: ch } = await readJson(req);
  if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'send { csv: "<file contents>" }');
  return importMetricsCsv(csv.slice(0, 5_000_000), CALENDAR_CHANNELS.some((c) => c.id === ch) ? ch : undefined);
});
router.get('/api/metrics/performance', async () => computePerformance(await readSnapshots()));
router.get('/api/metrics/pending', () => pendingNumbers());
router.post('/api/metrics/collect-now/:postId', async (_q, _r, p) => {
  const post = await mustPost(p.postId);
  const r = await publishCall(() => collectNow(post));
  if (!r.queued.length && !r.manual.length) throw new HttpError(400, 'Nothing on this post has gone out yet.');
  return { ...r, note: r.queued.length ? 'Queued — numbers arrive within a minute or so (Postiz reads wait their turn).' : 'No connection can read these channels — add their numbers by hand or from a screenshot.' };
});
// A stats screenshot: the image itself as the body (?channel=&name=), or { path, channel } for a file already under the Shipcast home.
// Only a proposal comes back; the confirmed numbers are saved through /api/metrics/snapshots.
router.post('/api/metrics/read-screenshot', async (req, _r, _p, url) => {
  const isJson = /json/.test(req.headers['content-type'] ?? '');
  const b = isJson ? await readJson(req) : {};
  const ch = String((isJson ? b.channel : url.searchParams.get('channel')) ?? '');
  if (!CALENDAR_CHANNELS.some((c) => c.id === ch)) throw new HttpError(400, 'channel is required');
  let file: string;
  let temp: string | undefined;
  if (isJson) {
    if (typeof b.path !== 'string' || !b.path) throw new HttpError(400, 'send the image, or { path, channel }');
    file = resolve(home(), b.path);
    if (!insideReal(home(), file)) throw new HttpError(403, 'the screenshot must be a file under the Shipcast home');
  } else {
    const ext = (/\.(png|jpe?g|webp|gif)$/i.exec(url.searchParams.get('name') ?? '')?.[0] ?? `.${(req.headers['content-type'] ?? '').replace(/^image\/(jpeg|png|webp|gif).*$/, '$1')}`).toLowerCase();
    if (!/^\.(png|jpe?g|webp|gif)$/.test(ext)) throw new HttpError(400, 'send a PNG, JPEG, WebP or GIF screenshot');
    const dir = join(home(), 'metrics', 'screenshots');
    await mkdir(dir, { recursive: true });
    temp = file = join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext.replace('.jpeg', '.jpg')}`);
    await writeFileP(file, await readBody(req, MAX_SCREENSHOT_BYTES));
  }
  try {
    return await readMetricsFromImage(file, { channel: ch as ChannelId });
  } catch (e) {
    throw new HttpError(422, (e as Error).message.slice(0, 200));
  } finally {
    if (temp) await rm(temp, { force: true });
  }
});
router.get('/api/metrics/playbook', async () => publicPlaybook(await readPlaybook()));
router.post('/api/metrics/playbook/refresh', async (req) => {
  const b = await readJson(req);
  return publicPlaybook(await refreshPlaybook({ narrative: b?.narrative !== false }));
});
router.get('/api/metrics/forecast/:postId', async (_q, _r, p) => {
  const post = await getPost(p.postId);
  if (!post) throw new HttpError(404, 'post not found');
  const pb = await readPlaybook();
  return { post: post.id, forecasts: await Promise.all(post.channels.map(async (c) => ({ channel: c.channel, forecast: await forecastPost(post, c.channel, pb) }))) };
});
router.get('/api/metrics/calibration', async () => ({ ...(await forecastCalibration()), critic: await criticCalibration() }));
router.get('/api/metrics/suggested-slots', async () => suggestedSlots(await readPlaybook()));
router.post('/api/calendar/posts/:id/more', async (_q, _r, p) => {
  try {
    return await moreLikeThis(p.id);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
});
router.post('/api/calendar/posts/:id/remix', async (req, _r, p) => {
  const { channels } = await readJson(req);
  try {
    return await remix(p.id, Array.isArray(channels) ? channels : undefined);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
});

// ── reports: the weekly (or monthly) report that writes itself ─────────
const reportError = (e: unknown): never => {
  const st = (e as { status?: number }).status;
  throw new HttpError(st && st >= 400 && st < 500 ? st : 500, (e as Error).message);
};
router.get('/api/reports', () => listReports());
router.get('/api/reports/goals', () => readGoals());
router.put('/api/reports/goals', async (req) => saveGoals((await readJson(req))?.goals));
router.get('/api/reports/notes', () => readNotes());
router.post('/api/reports/notes', async (req) => addNote(await readJson(req), callerOf(req).user.id).catch(reportError));
router.delete('/api/reports/notes/:id', async (_q, _r, p) => {
  if (!(await deleteNote(p.id))) throw new HttpError(404, 'note not found');
  return { ok: true };
});
// Delivery: schedule, email and webhooks (admins), sending (admins).
router.get('/api/reports/schedule', async () => publicSchedule(await readSchedule()));
router.put('/api/reports/schedule', async (req) => {
  const b = (await readJson(req)) ?? {};
  const cur = await readSchedule();
  // Webhooks come back from the UI as host-only entries; ones without a URL keep the saved address.
  const hooks = Array.isArray(b.webhooks) ? b.webhooks.map((w: any) => (w?.url ? w : cur.webhooks.find((c) => c.kind === w?.kind && new URL(c.url).hostname === w?.host))).filter(Boolean) : undefined;
  return publicSchedule(await saveSchedule({ ...b, ...(hooks ? { webhooks: hooks } : {}) }).catch(reportError));
});
router.get('/api/reports/email', () => publicSmtp());
router.put('/api/reports/email', async (req) => {
  const b = await readJson(req);
  await saveSmtp(b === null || b?.remove ? null : b).catch(reportError);
  return publicSmtp();
});
router.post('/api/reports/email/test', async (req) => {
  await testEmail(String((await readJson(req))?.to ?? '')).catch((e) => reportError(Object.assign(new Error(String((e as Error).message).slice(0, 200)), { status: (e as { status?: number }).status ?? 502 })));
  return { ok: true };
});
router.post('/api/reports/:id/send', async (_q, _r, p) => {
  await mustReport(p.id);
  return sendReport(p.id).catch(reportError);
});

router.post('/api/reports', async (req) => {
  const b = (await readJson(req)) ?? {};
  const kind = ['last7', 'last30', 'lastMonth', 'lastQuarter', 'custom'].includes(b.kind) ? b.kind : 'last7';
  const custom = kind === 'custom' ? { start: String(b.start ?? ''), end: String(b.end ?? '') } : undefined;
  if (custom && !(Date.parse(custom.start) < Date.parse(custom.end))) throw new HttpError(400, 'A custom report needs a start before its end.');
  return createReport({ kind, audience: b.audience, custom, by: callerOf(req).user.id, ...(b.writer === 'template' ? { ask: null } : {}) }).catch(reportError);
});
const mustReport = async (id: string) => (await getReport(id)) ?? reportError(Object.assign(new Error('report not found'), { status: 404 }));
router.get('/api/reports/:id', (_q, _r, p) => mustReport(p.id));
router.put('/api/reports/:id', async (req, _r, p) => {
  await mustReport(p.id);
  return editReport(p.id, (await readJson(req)) ?? {}).catch(reportError);
});
router.post('/api/reports/:id/rewrite', async (req, _r, p) => {
  await mustReport(p.id);
  const b = (await readJson(req)) ?? {};
  return rewriteReport(p.id, { audience: b.audience, ...(b.writer === 'template' ? { ask: null } : {}) }).catch(reportError);
});
router.get('/api/reports/:id/versions', async (_q, _r, p) => {
  await mustReport(p.id);
  return reportVersions(p.id);
});
router.post('/api/reports/:id/restore', async (req, _r, p) => {
  await mustReport(p.id);
  return restoreVersion(p.id, Number((await readJson(req))?.version)).catch(reportError);
});
router.post('/api/reports/:id/actions/:rec', async (_q, _r, p) => {
  await mustReport(p.id);
  return runRecommendation(p.id, p.rec).catch(reportError);
});
router.delete('/api/reports/:id', async (_q, _r, p) => {
  if (!(await deleteReport(p.id))) throw new HttpError(404, 'report not found');
  await revokeSharesFor(currentContext()?.workspace ?? '', p.id);
  return { ok: true };
});

// Ask the report: anyone who can read it may ask; the model only runs for people who can make things (it spends Claude).
router.post('/api/reports/:id/ask', async (req, _r, p) => {
  await mustReport(p.id);
  const q = String((await readJson(req))?.question ?? '');
  return askReport(p.id, q, can(currentContext()?.role, 'write') ? undefined : null).catch(reportError);
});

// Every workspace the person is in, latest report first-hand: the agency view. Each workspace is read in its own context.
router.get('/api/workspaces/reports-rollup', async (req) => {
  const me = callerOf(req).user.id;
  const out = [];
  for (const w of await workspacesFor(me)) {
    const latest = await runAs({ workspace: w.id, user: me, role: w.role }, async () => {
      const [summary] = await listReports();
      return summary ? { summary, full: await getReport(summary.id) } : undefined;
    });
    const why: string[] = [];
    const age = latest ? Date.now() - Date.parse(latest.summary.createdAt) : Infinity;
    if (!latest) why.push('No report yet');
    else if (age > 8 * 86_400_000) why.push(`Last report ${Math.round(age / 86_400_000)} days ago`);
    const reach = latest?.summary.kpis.find((k) => k.key === 'audience');
    if (reach?.change !== undefined && reach.change <= -0.15) why.push(`Reach down ${Math.round(-reach.change * 100)}%`);
    if (latest?.full?.facts.goals.some((g) => g.onTrack === false)) why.push('A goal is behind');
    if (latest?.full?.facts.coverage.missing.length) why.push(`${latest.full.facts.coverage.missing.length} posts without numbers`);
    out.push({ workspace: { id: w.id, name: w.name, personal: !!w.personalOf }, role: w.role, ...(latest ? { report: latest.summary } : {}), needsAttention: why.length > 0, ...(why.length ? { why: why.join(' · ') } : {}) });
  }
  return out.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention));
});

// Share links, exports and the week card.
const wsOf = () => currentContext()?.workspace ?? '';
router.post('/api/reports/:id/shares', async (req, _r, p) => {
  await mustReport(p.id);
  const b = (await readJson(req)) ?? {};
  const { share, token } = await createShare(wsOf(), p.id, { expiresDays: Number(b.expiresDays) || undefined, by: callerOf(req).user.id }).catch(reportError);
  return { ...share, url: `/r/${token}` };
});
router.get('/api/reports/:id/shares', async (_q, _r, p) => {
  await mustReport(p.id);
  return listShares(wsOf(), p.id);
});
router.delete('/api/reports/:id/shares/:share', async (_q, _r, p) => {
  if (!(await revokeShare(wsOf(), p.share))) throw new HttpError(404, 'link not found');
  return { ok: true };
});
const download = (res: ServerResponse, body: Buffer | string, type: string, name: string) => {
  res.writeHead(200, { 'content-type': type, 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '-')}"`, 'cache-control': 'no-store' });
  res.end(body);
  return undefined;
};
const fileBase = (r: Report) => `${r.title.replace(/ · /, '-').replace(/\s+/g, '-').toLowerCase()}`;
router.get('/api/reports/:id/export/:format', async (_q, res, p) => {
  const r = await mustReport(p.id);
  switch (p.format) {
    case 'csv':
      return download(res, reportCsv(r), 'text/csv; charset=utf-8', `${fileBase(r)}.csv`);
    case 'md':
      return download(res, reportMarkdown(r), 'text/markdown; charset=utf-8', `${fileBase(r)}.md`);
    case 'html':
      return download(res, reportHtml(r), 'text/html; charset=utf-8', `${fileBase(r)}.html`);
    case 'pdf':
      return download(res, await reportPdf(r).catch((e) => reportError(Object.assign(new Error(`Couldn't make the PDF: ${(e as Error).message.slice(0, 160)}`), { status: 503 }))), 'application/pdf', `${fileBase(r)}.pdf`);
    case 'pptx': {
      const dir = await mkdtemp(join(tmpdir(), 'shipcast-report-'));
      try {
        await reportPptx(r, join(dir, 'r.pptx'));
        return download(res, await readFile(join(dir, 'r.pptx')), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', `${fileBase(r)}.pptx`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    default:
      throw new HttpError(404, 'unknown format');
  }
});
router.get('/api/reports/:id/card.png', async (_q, res, p) => {
  const r = await mustReport(p.id);
  const png = await reportCardPng(r).catch((e) => reportError(Object.assign(new Error(`Couldn't draw the card: ${(e as Error).message.slice(0, 160)}`), { status: 503 })));
  res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': `inline; filename="${fileBase(r)}-card.png"`, 'cache-control': 'no-store' });
  res.end(png);
  return undefined;
});

// ── website numbers: Google Analytics and Search Console (read-only) ──
router.get('/api/site', () => siteStatus());
router.put('/api/site', async (req) => {
  const b = (await readJson(req)) ?? {};
  await publishCall(() => saveSiteSettings({ ...(b.ga4Property !== undefined ? { ga4Property: String(b.ga4Property), ga4Name: String(b.ga4Name ?? '') } : {}), ...(b.gscSite !== undefined ? { gscSite: String(b.gscSite) } : {}), ...(Array.isArray(b.domains) ? { domains: b.domains } : {}), ...(typeof b.utm === 'boolean' ? { utm: b.utm } : {}) }));
  return siteStatus();
});
router.get('/api/site/choices', async () => {
  const [properties, sites] = await Promise.all([publishCall(() => ga4Properties()).catch((e) => ({ error: (e as Error).message })), publishCall(() => searchSites()).catch((e) => ({ error: (e as Error).message }))]);
  return { properties, sites };
});
router.post('/api/site/sync', async (req) => {
  const b = (await readJson(req)) ?? {};
  const days = Number(b.days);
  return publishCall(() => syncSite(Number.isFinite(days) && days > 0 ? { days: Math.min(400, Math.round(days)) } : {}));
});

// ── trend radar: cards the trends agent keeps fresh ────────────────────
router.get('/api/trends', async (req) => {
  const all = new URL(req.url ?? '/', 'http://x').searchParams.get('archived') === '1';
  const feed = await readTrends();
  // Cards whose recipe you already win with come first, each with why.
  return { refreshedAt: feed.refreshedAt ?? null, sources: feed.sources ?? {}, cards: rankForYou(rankCards(feed.cards.filter((c) => all || !c.archived)), await readPlaybook().catch(() => null)) };
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
// Per workspace: each has its own ElevenLabs account (and cloned voices).
const voiceLists = new Map<string, { at: number; voices: unknown[] }>();
const wsKey = () => currentContext()?.workspace ?? '';
router.get('/api/voice', async () => {
  const s = await readSettings();
  const connected = !!(await getSecret('elevenlabs'));
  let voices: unknown[] = [];
  let error: string | undefined;
  if (connected) {
    try {
      const cached = voiceLists.get(wsKey());
      if (!cached || Date.now() - cached.at > 10 * 60_000) voiceLists.set(wsKey(), { at: Date.now(), voices: await elevenVoices() });
      voices = voiceLists.get(wsKey())!.voices;
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
    voiceLists.set(wsKey(), { at: Date.now(), voices });
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
  voiceLists.delete(wsKey());
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
  // A calendar post scores against its project's own voice (the one its pieces were written in).
  const camp = !b.toneId && typeof b.campaign === 'string' ? await readCampaign(b.campaign) : null;
  const tone = camp ? await campaignTone(camp) : ((await getTone(String(b.toneId ?? 'default'))) ?? DEFAULT_TONE);
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
  const b = await readJson(req);
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
  // Secrets go into the project's env, which only admins manage.
  if (Object.keys(env).length && !can(currentContext()?.role, 'manage')) throw new HttpError(403, 'This answer includes secrets — ask a workspace admin to provide them.');
  if (Object.keys(env).length) await writeCampaignEnv(p.id, env);
  return mutateStep(p.id, p.step, (s) => {
    s.status = 'queued';
    s.pendingNote = `[answer] Question: ${st.question!.text}\n${said.join('\n')}`;
    s.question = undefined;
    s.error = undefined;
    s.by = currentContext()?.user ?? s.by;
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
    // A revision runs on the Claude of whoever asked for it, not of whoever made the piece first.
    s.by = currentContext()?.user ?? s.by;
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
    s.by = currentContext()?.user ?? s.by;
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
  const b = await readJson(req);
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
  if (!(await mustCampaign(p.id)).steps.some((s) => s.id === p.step)) throw new HttpError(404, 'step not found');
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
  const who = currentContext();
  let checked = Date.now();
  while (!closed) {
    // Someone removed from the workspace stops receiving its live log within seconds.
    if (who?.user && who.workspace && Date.now() - checked > 5000) {
      checked = Date.now();
      if (!(await roleIn(who.user, who.workspace))) break;
    }
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
  // The source checkout, locks, and anything holding secrets (the app's env, dotfiles) are never served.
  if (/(^|\/)(source|\.lock)(\/|$)/.test(rel) || /(^|\/)(secrets\.env|\.[^/]*)$/.test(rel) || /(^|\/)\.env/.test(rel)) throw new HttpError(403, 'not served');
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
  // A project this workspace doesn't have is simply not found, whatever the path asks for.
  if (!existsSync(campaignDir(p.id))) throw new HttpError(404, 'campaign not found');
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
// A team server reached by name: SHIPCAST_ALLOWED_HOSTS=shipcast.example.com,10.0.0.5:4317
const EXTRA_HOSTS = new Set((process.env.SHIPCAST_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
const allowedHost = (h: string) => LOCAL_HOSTS.test(h) || EXTRA_HOSTS.has(h.toLowerCase()) || EXTRA_HOSTS.has(h.toLowerCase().replace(/:\d+$/, ''));

const callers = new WeakMap<IncomingMessage, Caller>();
const callerOf = (req: IncomingMessage): Caller => {
  const c = callers.get(req);
  if (!c) throw new HttpError(401, 'Sign in to continue.');
  return c;
};
registerAuthRoutes(router, callerOf);

const shareHits = new Map<string, number[]>();
/** /r/<token> (the page) and /r/<token>/img/<n> (a top post's image). Rate-limited per address; the same answer for every bad link. */
async function serveShare(req: IncomingMessage, res: ServerResponse, url: URL) {
  // Behind a proxy you control (SHIPCAST_TRUST_PROXY=1) the visitor's address is the forwarded one.
  const ip = String((process.env.SHIPCAST_TRUST_PROXY === '1' && req.headers['x-forwarded-for']) || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const hits = (shareHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  shareHits.delete(ip);
  shareHits.set(ip, hits);
  // Forget the quietest (oldest-touched) addresses rather than everyone's counts.
  for (const k of shareHits.keys()) {
    if (shareHits.size <= 5000) break;
    shareHits.delete(k);
  }
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
  const gone = () => {
    res.writeHead(404, { ...headers, 'content-type': 'text/html; charset=utf-8' });
    res.end(callbackPage('This link doesn’t work', 'It may have expired or been turned off. Ask the person who sent it for a new one.'));
  };
  if (hits.length > 60) {
    res.writeHead(429, { ...headers, 'content-type': 'text/plain' });
    return res.end('Too many requests — try again in a minute.');
  }
  const m = /^\/r\/([\w-]{40,50})(?:\/img\/(\d))?$/.exec(url.pathname);
  const share = m ? await resolveShare(m[1]) : null;
  if (!m || !share || !(await listWorkspaces()).some((w) => w.id === share.workspace)) return gone();
  await runAs({ workspace: share.workspace }, async () => {
    const r = await getReport(share.report);
    if (!r) return gone();
    if (m[2] !== undefined) {
      const img = topPostImage(r, Number(m[2]));
      if (!img) return gone();
      return sendFile(req, res, img, { 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
    }
    countView(share.id);
    res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
    res.end(reportHtml(r, { media: (_p, i) => (topPostImage(r, i) ? `/r/${m[1]}/img/${i}` : undefined), note: share.expiresAt ? `Link expires ${new Date(share.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Shared link' }));
  });
}

export function createApp({ serveWeb = true } = {}): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      // The api can make Claude run tools, so only local pages may call it:
      // reject foreign Host headers (DNS rebinding) and cross-site writes.
      if (!allowedHost(req.headers.host ?? '')) throw new HttpError(403, 'forbidden host');
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD' && origin) {
        const host = new URL(origin).host;
        if (!allowedHost(host)) throw new HttpError(403, 'forbidden origin');
      }
      // /oauth/* is only the providers' redirect back to this local server.
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/')) {
        const method = req.method === 'HEAD' ? 'GET' : req.method!;
        const m = router.match(method, url.pathname);
        if (!m) throw new HttpError(404, 'no such route');
        let ctx: WorkContext | undefined;
        if (url.pathname.startsWith('/oauth/')) {
          // The state we issued says which workspace and person started this; the browser finishing it must be
          // that same person's session, so a link forwarded to someone else can't plant their account in yours.
          const st = url.searchParams.get('state') ?? '';
          const owner = oauthOwners.get(st)?.ctx;
          const s = await sessionUser(cookieToken(req));
          if (!owner || !s || s.user.id !== owner.user) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(callbackPage('Not connected', 'This sign-in link is not valid here — start Connect again from Shipcast in this browser.'));
            return;
          }
          oauthOwners.delete(st);
          ctx = owner;
        } else {
          const caller = await gate(req, method, url.pathname);
          if (caller) {
            callers.set(req, caller);
            if (caller.workspace) ctx = { workspace: caller.workspace, user: caller.user.id, role: caller.role };
          }
        }
        const out = await (ctx ? runAs(ctx, () => m.handler(req, res, m.params, url)) : m.handler(req, res, m.params, url));
        if (out !== undefined && !res.headersSent) json(res, 200, out);
        return;
      }
      // A report someone was sent a link to: no session, only that report.
      if (url.pathname.startsWith('/r/')) return await serveShare(req, res, url);
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
      // Engine errors may carry a client status (e.g. a malformed id is simply not found).
      const own = (e as { status?: unknown })?.status;
      const status = e instanceof HttpError ? e.status : typeof own === 'number' && own >= 400 && own < 500 ? own : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  });
}
