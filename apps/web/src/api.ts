// Types mirror services/engine/src/types.ts; the web app talks to it only over HTTP.
export type SourceType = 'url' | 'github' | 'local' | 'text';
export type Source = { type: SourceType; value: string };
export interface HubPackage { id: string; name: string; repo: string; ref: string; paths: string[]; licence: string; area: string; roles: Record<string, string>; summary: string; verdict: number; needs?: string[]; stars?: number; custom?: boolean }
export interface SkillsView { packages: (HubPackage & { installed: boolean; enabled: boolean; permissive: boolean; accepted: boolean })[]; roles: Record<string, { candidates: { id: string; skill: string; name: string }[]; chosen?: string; effective?: string }> }
export interface BrainQuestion { id: string; question: string; why?: string; options: string[] }
export interface BrainDirection { id: string; title: string; hook: string; angle: string; tone: string }
export interface BrainTurn { understood: string; questions: BrainQuestion[]; directions: BrainDirection[]; formats?: string[] }
export interface BoardBeat { scene: string; title: string; line: string; note: string; seconds: number }
export type StepStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'blocked' | 'needs-input';
export interface StepQuestion { text: string; why?: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[] }

export interface Step {
  id: string;
  brandScore?: { score: number; voice: string; issues: string[] };
  kind: 'brief' | 'pack';
  pack?: string;
  question?: StepQuestion;
  notBefore?: string;
  options: Record<string, string>;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  outputs: string[];
  costUsd?: number;
  durationMs?: number;
  revisions: { note: string; at: string }[];
  pendingNote?: string;
  cancelRequested?: boolean;
  phase?: string;
  renderOnly?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: { type: SourceType; value: string; ref?: string };
  goal: string;
  audience: string;
  tone: string;
  notes: string;
  steps: Step[];
}

export interface CampaignEvent {
  t: string;
  step: string;
  type: 'status' | 'text' | 'tool' | 'tool_result' | 'result' | 'log' | 'error';
  text?: string;
  tool?: string;
  status?: StepStatus;
}

export type OptionField =
  | { key: string; label: string; type: 'select'; choices: string[]; default: string; help?: string }
  | { key: string; label: string; type: 'text'; default: string; placeholder?: string; help?: string }
  | { key: string; label: string; type: 'number'; default: string; min?: number; max?: number; help?: string };

export interface Pack {
  id: string;
  spec: 'deck' | 'graphics' | 'storyboard' | 'infographic' | null;
  pipeline: string | null;
  order: number;
  name: string;
  tagline: string;
  category: 'video' | 'motion' | 'design' | 'copy';
  estimate: string;
  accent: string;
  sources: SourceType[];
  options: OptionField[];
  tools: string[];
  skills: { name: string; source: string; installed: boolean }[];
}

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  hint?: string;
  fix?: string;
}

export interface LoginState {
  running: boolean;
  url?: string;
  code?: string;
  output: string;
  exitCode?: number | null;
}

export interface Status {
  claude: { installed: boolean; loggedIn: boolean; version?: string; method?: string; account?: string };
  github: { installed: boolean; loggedIn: boolean; login?: string };
  logins: { claude: LoginState | null; github: LoginState | null };
}

export interface Settings {
  model: string;
  allowedTools: string[];
  stepTimeoutMinutes: number;
  subagents: 'pack' | 'never';
  directorReview: boolean;
  criticReview?: boolean;
  genCapPerProject?: number;
  genCapPerMonth?: number;
  agentsPaused?: boolean;
  agentsQuietStart?: string;
  agentsQuietEnd?: string;
  agentsMaxClaudeRunsPerDay?: number;
  publishingPaused?: boolean;
}

export interface AgentJob {
  id: string;
  title: string;
  about: string;
  every: number;
  enabled: boolean;
  nextRun: string;
  lastRun?: string;
  lastResult?: { ok: boolean; summary: string; ms: number };
  runNow?: boolean;
  running?: boolean;
  waiting: string;
}
export interface TrendCard {
  key: string;
  kind: 'format' | 'hook' | 'topic' | 'tactic' | 'platform-change';
  platform: string;
  title: string;
  what: string;
  evidence: { url: string; metric?: string; date?: string }[];
  strength: 'rising' | 'steady' | 'fading';
  recipe: { pack: string; angle: string; hookPattern: string; structure: string[] };
  firstSeen: string;
  lastSeen: string;
  seen: number;
  archived?: boolean;
}
export interface TrendFeed {
  refreshedAt: string | null;
  sources: Record<string, number>;
  cards: TrendCard[];
}
export interface Lesson {
  id: string;
  pack: string;
  category: string;
  rule: string;
  createdAt: string;
  status: 'trial' | 'kept' | 'retired' | 'off';
  baseline: { rate: number; runs: number };
  after?: { rate: number; runs: number };
  examples: string[];
}
export interface LessonsState {
  categories: { id: string; label: string }[];
  packs: Record<string, { runs: number; categories: Record<string, number> }>;
  lessons: Lesson[];
}
export interface AgentsState {
  paused: boolean;
  quiet: { start: string; end: string };
  cap: number;
  usedToday: number;
  jobs: AgentJob[];
  runs: { job: string; at: string; ok: boolean; summary: string; ms: number }[];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export interface VoiceState {
  provider: 'kokoro' | 'elevenlabs' | 'chatterbox';
  connected: boolean;
  chatterbox?: boolean;
  voice?: string;
  model?: string;
  voices?: { id: string; name: string; category?: string; labels?: Record<string, string>; preview?: string }[];
  error?: string;
}

export interface ToneSliders { formalCasual: number; seriousPlayful: number; reservedBold: number; technicalSimple: number; humor: number }
export interface ToneProfile {
  id: string;
  name: string;
  description: string;
  personality: string[];
  sliders: ToneSliders;
  readingLevel: 'grade6' | 'grade8' | 'grade10' | 'expert';
  person: 'we' | 'I' | 'you';
  audience: { role: string; pains: string[]; desires: string[]; objections: string[] };
  do: string[];
  dont: string[];
  lexicon: { preferred: Record<string, string>; banned: string[] };
  emoji: 'none' | 'sparing' | 'native';
  hashtags: { max: number; style: 'none' | 'niche' | 'broad' | 'branded' };
  cta: 'soft' | 'direct' | 'urgent';
  claims: { allowedStats: string[]; forbidden: string[]; requireSource: boolean };
  locale: string;
  channels: Record<string, unknown>;
  aiDisclosure: boolean;
  samples: string[];
  updatedAt?: string;
}
export interface BrandScore {
  score: number;
  issues: { rule: string; severity: 'error' | 'warn'; detail: string; match?: string; fix?: string }[];
  stats: { words: number; sentences: number; grade: number; emojis: number; hashtags: number; exclamations: number };
}

export type { ChannelInfo, ContentPlan, Post, PostChannel, PostStatus } from './calendar-model.ts';
import type { ChannelInfo, ContentPlan, Post, PostStatus } from './calendar-model.ts';
export interface PublishConnections {
  linkedin: { configured: boolean; connected: boolean; expired: boolean; account: string | null; expiresAt: string | null };
  youtube: { configured: boolean; connected: boolean; note: string };
  postiz: { configured: boolean; url: string | null; note: string };
}
export interface PostizIntegration { id: string; name: string; identifier: string; profile?: string; disabled?: boolean; picture?: string }

export type StockProvider = 'pixabay' | 'unsplash' | 'pexels';
export interface StockState {
  connected: boolean;
  photos: boolean;
  providers: Record<StockProvider, boolean>;
}

export const api = {
  status: () => call<Status>('GET', '/api/status'),
  doctor: () => call<Check[]>('GET', '/api/doctor'),
  setup: (id: string) => call<{ ok: boolean; log: string }>('POST', `/api/setup/${id}`),
  connectClaude: () => call<LoginState>('POST', '/api/connect/claude'),
  connectGithub: () => call<LoginState>('POST', '/api/connect/github'),
  repos: () => call<{ nameWithOwner: string; description: string; isPrivate: boolean; updatedAt: string }[]>('GET', '/api/github/repos'),
  pulls: (repo: string) => call<{ number: number; title: string; state: string }[]>('GET', `/api/github/pulls?repo=${encodeURIComponent(repo)}`),
  packs: () => call<Pack[]>('GET', '/api/packs'),
  installPack: (id: string) => call<{ pack: Pack; results: { skill: string; ok: boolean; log: string }[] }>('POST', `/api/packs/${id}/install`),
  settings: () => call<Settings>('GET', '/api/settings'),
  brainstorm: (b: { source: Source; formats: string[]; notes?: string; asked?: BrainQuestion[]; answers?: Record<string, string>; reply?: string }) => call<BrainTurn>('POST', '/api/brainstorm', b),
  board: (b: { source: Source; formats: string[]; notes?: string; direction?: BrainDirection; length?: string }) => call<{ beats: BoardBeat[] }>('POST', '/api/brainstorm/board', b),
  skills: () => call<SkillsView>('GET', '/api/skills'),
  installSkill: (id: string, acceptLicence = false) => call<SkillsView>('POST', `/api/skills/${id}/install`, { acceptLicence }),
  addSkillUrl: (url: string) => call<SkillsView & { added: string }>('POST', '/api/skills/custom', { url }),
  removeSkill: (id: string) => call<SkillsView>('DELETE', `/api/skills/custom/${id}`),
  setSkill: (id: string, enabled: boolean) => call<SkillsView>('PUT', `/api/skills/${id}`, { enabled }),
  setSkillRole: (role: string, id: string | null) => call<SkillsView>('PUT', '/api/skills/roles', { role, id }),
  voice: () => call<VoiceState>('GET', '/api/voice'),
  saveVoice: (b: { apiKey?: string; provider?: 'kokoro' | 'elevenlabs' | 'chatterbox'; voice?: string; model?: string }) => call<VoiceState>('PUT', '/api/voice', b),
  disconnectVoice: () => call<VoiceState>('DELETE', '/api/voice/elevenlabs'),
  providers: () => call<Record<string, { label: string; connected: boolean }>>('GET', '/api/providers'),
  saveProvider: (id: string, apiKey: string) => call<{ connected: boolean }>('PUT', `/api/providers/${id}`, { apiKey }),
  removeProvider: (id: string) => call<{ connected: boolean }>('DELETE', `/api/providers/${id}`),
  broll: () => call<StockState>('GET', '/api/broll'),
  saveBroll: (provider: StockProvider, apiKey: string) => call<StockState>('PUT', '/api/broll', { provider, apiKey }),
  disconnectBroll: (provider: StockProvider) => call<StockState>('DELETE', `/api/broll/${provider}`),
  tones: () => call<ToneProfile[]>('GET', '/api/tones'),
  saveTone: (t: Partial<ToneProfile>) => call<ToneProfile>('PUT', '/api/tones', t),
  deleteTone: (id: string) => call<{ ok: boolean }>('DELETE', `/api/tones/${id}`),
  learnTone: (b: { samples: string[]; name?: string; id?: string }) => call<ToneProfile>('POST', '/api/tones/learn', b),
  scoreCopy: (b: { text: string; toneId: string; channel?: string }) => call<BrandScore>('POST', '/api/tones/score', b),
  rewriteCopy: (b: { text: string; toneId: string; channel?: string }) => call<{ text: string; score: BrandScore }>('POST', '/api/tones/rewrite', b),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/api/settings', s),
  agents: () => call<AgentsState>('GET', '/api/agents'),
  setAgent: (id: string, patch: { enabled?: boolean; every?: number }) => call<AgentJob[]>('PUT', `/api/agents/${id}`, patch),
  runAgent: (id: string) => call<AgentJob[]>('POST', `/api/agents/${id}/run`),
  lessons: () => call<LessonsState>('GET', '/api/lessons'),
  trends: () => call<TrendFeed>('GET', '/api/trends'),
  quality: () => call<{ runs: number; formats: Record<string, { at: string; avg: number; golden: boolean; low: string }[]> }>('GET', '/api/quality'),
  refreshTrends: () => call<unknown>('POST', '/api/trends/refresh'),
  setLesson: (id: string, status: 'off' | 'trial') => call<unknown>('PUT', `/api/lessons/${id}`, { status }),
  campaigns: () => call<Campaign[]>('GET', '/api/campaigns'),
  campaign: (id: string) => call<Campaign>('GET', `/api/campaigns/${id}`),
  createCampaign: (body: unknown) => call<Campaign>('POST', '/api/campaigns', body),
  deleteCampaign: (id: string) => call<{ ok: true }>('DELETE', `/api/campaigns/${id}`),
  addStep: (id: string, pack: string, options: Record<string, string>) => call<Campaign>('POST', `/api/campaigns/${id}/steps`, { pack, options }),
  removeStep: (id: string, step: string) => call<Campaign>('DELETE', `/api/campaigns/${id}/steps/${step}`),
  answer: (id: string, step: string, values: Record<string, string>, note?: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/answer`, { values, note }),
  envKeys: (id: string) => call<{ keys: string[] }>('GET', `/api/campaigns/${id}/env`),
  saveEnv: (id: string, text: string) => call<{ keys: string[] }>('PUT', `/api/campaigns/${id}/env`, { text }),
  takes: (id: string, step: string) => call<{ id: string; label: string; kind: string; files: string[]; posters: string[]; chosen: number }[]>('GET', `/api/campaigns/${id}/steps/${step}/takes`),
  chooseTake: (id: string, step: string, take: string, choose: number) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/takes`, { id: take, choose }),
  variants: (id: string, step: string, count = 4) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/variants`, { count }),
  revise: (id: string, step: string, note: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/revise`, { note }),
  app: (id: string) => call<AppState>('GET', `/api/campaigns/${id}/app`),
  appStart: (id: string) => call<AppState & { log: string[] }>('POST', `/api/campaigns/${id}/app/start`),
  appUnlock: (id: string, values: Record<string, string>) => call<Campaign>('POST', `/api/campaigns/${id}/app/unlock`, { values }),
  appStop: (id: string) => call<AppState & { log: string[] }>('POST', `/api/campaigns/${id}/app/stop`),
  size: (id: string) => call<{ bytes: number; appBytes: number }>('GET', `/api/campaigns/${id}/size`),
  cleanup: (id: string, app: boolean) => call<{ freed: number; bytes: number; appBytes: number }>('POST', `/api/campaigns/${id}/cleanup`, { app }),
  rerender: (id: string) => call<Campaign>('POST', `/api/campaigns/${id}/rerender`),
  retry: (id: string, step: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/retry`),
  cancel: (id: string, step: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/cancel`),
  services: () => call<{ name: string; ok: boolean; queued?: number; running?: number; voice?: string }[]>('GET', '/api/services'),
  catalog: (kind: string) => call<any>('GET', `/api/catalog/${kind}`),
  getSpec: (id: string, step: string) => call<{ kind: string; spec: any }>('GET', `/api/campaigns/${id}/steps/${step}/spec`),
  saveSpec: (id: string, step: string, spec: unknown) => call<Campaign>('PUT', `/api/campaigns/${id}/steps/${step}/spec`, { spec }),
  tree: (id: string) => call<{ brief: string[]; deliverables: string[]; uploads: string[] }>('GET', `/api/campaigns/${id}/tree`),
  preview: (id: string, step: string, spec: unknown) => call<{ frames: string[]; scenes: { id: string; start: number; duration: number }[]; duration: number }>('POST', `/api/campaigns/${id}/steps/${step}/preview`, { spec }),
  reveal: (id: string) => call<{ ok: true }>('POST', `/api/campaigns/${id}/reveal`),
  calendar: {
    channels: () => call<ChannelInfo[]>('GET', '/api/calendar/channels'),
    posts: (q: { from?: string; to?: string; channel?: string; status?: PostStatus[]; unscheduled?: boolean } = {}) => {
      const p = new URLSearchParams();
      if (q.from) p.set('from', q.from);
      if (q.to) p.set('to', q.to);
      if (q.channel) p.set('channel', q.channel);
      if (q.status?.length) p.set('status', q.status.join(','));
      if (q.unscheduled) p.set('unscheduled', '1');
      return call<Post[]>('GET', `/api/calendar/posts${p.size ? `?${p}` : ''}`);
    },
    create: (post: Partial<Post>) => call<Post>('POST', '/api/calendar/posts', post),
    save: (id: string, patch: Partial<Post>) => call<Post>('PUT', `/api/calendar/posts/${id}`, patch),
    remove: (id: string) => call<{ ok: true }>('DELETE', `/api/calendar/posts/${id}`),
    check: (id: string) => call<{ problems: string[]; channels: Record<string, string[]> }>('GET', `/api/calendar/posts/${id}/check`),
    plan: () => call<ContentPlan>('GET', '/api/calendar/plan'),
    savePlan: (plan: Partial<ContentPlan>) => call<ContentPlan>('PUT', '/api/calendar/plan', plan),
    planMonth: (b: { from: string; to: string; project?: string }) => call<{ created: Post[]; skipped: number; slots: number }>('POST', '/api/calendar/plan-month', b),
    make: (id: string, b: { project?: string; format?: string } = {}) => call<Post>('POST', `/api/calendar/posts/${id}/make`, b),
    fromTrend: (key: string, channel?: string) => call<Post>('POST', '/api/calendar/from-trend', { key, channel }),
    importCsv: (csv: string) => call<{ created: number; problems: string[] }>('POST', '/api/calendar/import', { csv }),
    markSent: (id: string, channel: string, url?: string) => call<Post>('POST', `/api/calendar/posts/${id}/channels/${channel}/sent`, url ? { url } : {}),
    sendNow: (id: string) => call<{ post: Post; note: string }>('POST', `/api/calendar/posts/${id}/send-now`),
    kitUrl: (id: string, channel: string) => `/api/calendar/posts/${id}/kit/${channel}`,
    icsUrl: () => `${location.origin}/api/calendar.ics`,
    csvUrl: () => '/api/calendar/export.csv',
  },
  publish: {
    connections: () => call<PublishConnections>('GET', '/api/publish/connections'),
    saveKeys: (provider: 'linkedin' | 'youtube', clientId: string, clientSecret: string) => call<PublishConnections>('PUT', `/api/publish/${provider}`, { clientId, clientSecret }),
    savePostiz: (url: string, apiKey: string) => call<PublishConnections & { integrations: PostizIntegration[] }>('PUT', '/api/publish/postiz', { url, apiKey }),
    postizIntegrations: () => call<PostizIntegration[]>('GET', '/api/publish/postiz/integrations'),
    connect: (provider: 'linkedin' | 'youtube') => call<{ url: string; redirect: string }>('GET', `/api/publish/${provider}/connect`),
    disconnect: (provider: 'linkedin' | 'youtube' | 'postiz', keys = false) => call<PublishConnections>('DELETE', `/api/publish/${provider}${keys ? '?keys=1' : ''}`),
  },
  upload: async (id: string, file: File) => {
    const res = await fetch(`/api/campaigns/${id}/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'upload failed');
  },
};

export const fileUrl = (campaign: string, path: string) => `/api/campaigns/${campaign}/files/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Classify what the user pasted into the single source box. */
export function detectSource(input: string): { type: SourceType; value: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (/^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s)) return { type: 'github', value: s };
  if (/^(\/|~\/|[A-Za-z]:\\)/.test(s)) return { type: 'local', value: s };
  if (/^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return { type: 'url', value: s };
  if (s.split(/\s+/).length >= 6) return { type: 'text', value: s };
  return null;
}

export function fmtDuration(ms?: number): string {
  if (!ms || ms < 0) return '00:00';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export interface AppState {
  optional: { key: string; label: string; unlocks?: string; set: boolean }[];
  hasApp: boolean;
  url?: string;
  up: boolean;
  external: boolean;
  canStart: boolean;
}
