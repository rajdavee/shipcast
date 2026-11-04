// Types mirror services/engine/src/types.ts; the web app talks to it only over HTTP.
import { useSyncExternalStore } from 'react';
import { decideError, type ErrorDecision, type Role } from './auth-model.ts';
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
  metricsPaused?: boolean;
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
  /** × your usual for this recipe's format on its channel, from the playbook. */
  fit?: number;
  fitWhy?: string;
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

// ── session plumbing: every request carries the anti-forgery header and the workspace it is for ──

const WS_KEY = 'shipcast.workspace';
let workspaceNow: string | null = (() => {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
})();
const wsListeners = new Set<() => void>();
export const currentWorkspace = () => workspaceNow;
/** Remember the workspace this tab works in; every later request names it. */
export function setCurrentWorkspace(id: string | null) {
  if (id === workspaceNow) return;
  workspaceNow = id;
  try {
    if (id) localStorage.setItem(WS_KEY, id);
    else localStorage.removeItem(WS_KEY);
  } catch {}
  wsListeners.forEach((l) => l());
}
export function useWorkspaceId(): string | null {
  return useSyncExternalStore((cb) => (wsListeners.add(cb), () => void wsListeners.delete(cb)), () => workspaceNow);
}

/** Headers for any request to the api (also for raw fetches like uploads). */
export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-shipcast': '1', ...(workspaceNow ? { 'x-shipcast-workspace': workspaceNow } : {}), ...extra };
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ProblemHandler = (d: ErrorDecision, path: string) => void;
let onProblem: ProblemHandler = () => {};
/** The app decides what a 401 or a lost workspace means for the screen; everything else is thrown to the caller. */
export const setProblemHandler = (fn: ProblemHandler) => void (onProblem = fn);

async function check(res: Response, path: string): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const message = data.error ?? `${res.status} ${res.statusText}`;
  const d = decideError(res.status, message, path);
  if (d.kind === 'signin' || d.kind === 'setup' || d.kind === 'workspace-gone') onProblem(d, path);
  throw new ApiError(res.status, d.kind === 'forbidden' || d.kind === 'error' ? d.message : message);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: apiHeaders(body === undefined ? {} : { 'content-type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return check(res, path.split('?')[0]) as Promise<T>;
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
import type { ChannelId, ChannelInfo, ContentPlan, Post, PostStatus } from './calendar-model.ts';
export interface PublishConnections {
  google?: { configured: boolean; connected: boolean; note: string };
  linkedin: { configured: boolean; connected: boolean; expired: boolean; account: string | null; expiresAt: string | null };
  youtube: { configured: boolean; connected: boolean; note: string; stats?: { stats: boolean; analytics: boolean; needsReconnect: boolean } };
  postiz: { configured: boolean; url: string | null; note: string };
}
export interface PostizIntegration { id: string; name: string; identifier: string; profile?: string; disabled?: boolean; picture?: string }

export type { AgeBucket, MetricKey, MetricSource, Snapshot, Performance, Effect, PlaybookFinding, HeatCell, ChannelModel, ChannelPlaybook, Playbook, Forecast, Calibration, CriticCalibration, PendingNumbers, ScreenshotReading } from './pulse-model.ts';
import type { Snapshot, Performance, Playbook, Forecast, Calibration, CriticCalibration, PendingNumbers, ScreenshotReading, MetricKey } from './pulse-model.ts';

export type { Report, ReportSummary, Facts, Kpi, Section, Recommendation, GoalInput, Goal, Note, ShareInfo, AskAnswer, AskChart, ReportSchedule, EmailSettings, RollupItem, SiteState, SiteChoices, ReportVersion, Audience, PeriodKind } from './reports-model.ts';
import type { Report, ReportSummary, Goal, GoalInput, Note, ShareInfo, AskAnswer, ReportSchedule, EmailSettings, RollupItem, SiteState, SiteChoices, ReportVersion, Audience, PeriodKind, SectionId } from './reports-model.ts';

export type StockProvider = 'pixabay' | 'unsplash' | 'pexels';
export interface StockState {
  connected: boolean;
  photos: boolean;
  providers: Record<StockProvider, boolean>;
}

export interface PublicUser { id: string; email: string; name: string; createdAt: string; installOwner: boolean }
export interface AuthStatus { setUp: boolean; signedIn: boolean; openSignup: boolean; user?: PublicUser }
export interface WorkspaceSummary { id: string; name: string; role: Role; personal: boolean; members: number }
export interface SessionInfo { id: string; createdAt: string; lastSeen: string; agent?: string; current: boolean }
export interface Account { user: PublicUser; workspaces: WorkspaceSummary[]; current?: string; sessions: SessionInfo[] }
export interface ClaudeConnection { connected: boolean; method: 'token' | 'apiKey' | 'machine' | 'none'; savedAt?: string; machineAllowed: boolean }
export interface InviteInfo { valid: boolean; problem?: string; workspace?: string; role?: Role; email?: string }
export interface MemberView { id: string; email: string; name: string; role: Role; addedAt: string }
export interface PendingInvite { id: string; workspace: string; role: Exclude<Role, 'owner'>; email?: string; by: string; createdAt: string; expiresAt: string }

export const auth = {
  status: () => call<AuthStatus>('GET', '/api/auth/status'),
  signUp: (b: { email: string; password: string; name?: string; invite?: string }) => call<{ user: PublicUser; workspace: string; migrated?: string[] }>('POST', '/api/auth/signup', b),
  signIn: (email: string, password: string) => call<{ user: PublicUser }>('POST', '/api/auth/signin', { email, password }),
  signOut: (everywhere = false) => call<{ ok: true }>('POST', '/api/auth/signout', { everywhere }),
  inviteInfo: (token: string) => call<InviteInfo>('GET', `/api/auth/invite/${encodeURIComponent(token)}`),
  setOpenSignup: (open: boolean) => call<{ openSignup: boolean }>('PUT', '/api/auth/open-signup', { open }),
  account: () => call<Account>('GET', '/api/account'),
  claude: () => call<ClaudeConnection>('GET', '/api/account/claude'),
  saveClaude: (credential: string) => call<ClaudeConnection>('PUT', '/api/account/claude', { credential }),
  forgetClaude: () => call<ClaudeConnection>('DELETE', '/api/account/claude'),
  changePassword: (current: string, next: string) => call<{ ok: true }>('PUT', '/api/account/password', { current, next }),
  createWorkspace: (name: string) => call<{ id: string; name: string }>('POST', '/api/workspaces', { name }),
  switchTo: (id: string) => call<{ ok: true; workspace: string }>('POST', `/api/workspaces/${id}/switch`),
  join: (token: string) => call<{ workspace: string; name: string }>('POST', `/api/workspaces/join/${encodeURIComponent(token)}`),
  members: (id: string) => call<{ members: MemberView[]; invites: PendingInvite[] }>('GET', `/api/workspaces/${id}/members`),
  invite: (id: string, role: Role, email?: string) => call<{ link: string; invite: PendingInvite }>('POST', `/api/workspaces/${id}/invites`, { role, ...(email ? { email } : {}) }),
  revokeInvite: (id: string, invite: string) => call<{ ok: true }>('DELETE', `/api/workspaces/${id}/invites/${invite}`),
  rename: (id: string, name: string) => call<{ id: string; name: string }>('PUT', `/api/workspaces/${id}`, { name }),
  setRole: (id: string, user: string, role: Role) => call<unknown>('PUT', `/api/workspaces/${id}/members/${user}`, { role }),
  removeMember: (id: string, user: string) => call<unknown>('DELETE', `/api/workspaces/${id}/members/${user}`),
  deleteWorkspace: (id: string) => call<{ ok: true }>('DELETE', `/api/workspaces/${id}`),
};

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
  scoreCopy: (b: { text: string; toneId?: string; campaign?: string; channel?: string }) => call<BrandScore>('POST', '/api/tones/score', b),
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
    connect: (provider: 'linkedin' | 'youtube' | 'google') => call<{ url: string; redirect: string }>('GET', `/api/publish/${provider}/connect`),
    disconnect: (provider: 'linkedin' | 'youtube' | 'google' | 'postiz', keys = false) => call<PublishConnections>('DELETE', `/api/publish/${provider}${keys ? '?keys=1' : ''}`),
  },
  metrics: {
    post: (id: string) => call<{ snapshots: Snapshot[]; performance: Performance[] }>('GET', `/api/metrics/posts/${id}`),
    add: (b: { post: string; channel: ChannelId; source: 'manual' | 'screenshot' } & Partial<Record<MetricKey, number>>) => call<Snapshot>('POST', '/api/metrics/snapshots', b),
    remove: (id: string) => call<{ ok: true }>('DELETE', `/api/metrics/snapshots/${id}`),
    importCsv: (csv: string, channel?: ChannelId) => call<{ saved: number; unmatched: string[] }>('POST', '/api/metrics/import', { csv, channel }),
    performance: () => call<Performance[]>('GET', '/api/metrics/performance'),
    pending: () => call<PendingNumbers[]>('GET', '/api/metrics/pending'),
    collectNow: (postId: string) => call<{ queued: ChannelId[]; manual: ChannelId[]; note: string }>('POST', `/api/metrics/collect-now/${postId}`),
    readScreenshot: async (file: Blob & { name?: string }, channel: ChannelId): Promise<ScreenshotReading> => {
      const res = await fetch(`/api/metrics/read-screenshot?channel=${channel}&name=${encodeURIComponent(file.name ?? 'screenshot.png')}`, { method: 'POST', headers: apiHeaders({ 'content-type': file.type || 'application/octet-stream' }), body: file });
      return check(res, '/api/metrics/read-screenshot') as Promise<ScreenshotReading>;
    },
    playbook: () => call<Playbook | { computedAt: null; channels: [] }>('GET', '/api/metrics/playbook'),
    refreshPlaybook: (narrative = true) => call<Playbook>('POST', '/api/metrics/playbook/refresh', { narrative }),
    forecast: (postId: string) => call<{ post: string; forecasts: { channel: ChannelId; forecast: Forecast | null }[] }>('GET', `/api/metrics/forecast/${postId}`),
    calibration: () => call<Calibration & { critic: CriticCalibration }>('GET', '/api/metrics/calibration'),
    suggestedSlots: () => call<Partial<Record<ChannelId, { slots: string[]; why: string[] }>>>('GET', '/api/metrics/suggested-slots'),
    more: (postId: string) => call<Post>('POST', `/api/calendar/posts/${postId}/more`),
    remix: (postId: string, channels?: ChannelId[]) => call<Post[]>('POST', `/api/calendar/posts/${postId}/remix`, channels ? { channels } : {}),
  },
  reports: {
    list: () => call<ReportSummary[]>('GET', '/api/reports'),
    create: (b: { kind: PeriodKind; audience: Audience; start?: string; end?: string }) => call<Report>('POST', '/api/reports', b),
    get: (id: string) => call<Report>('GET', `/api/reports/${id}`),
    edit: (id: string, b: { title?: string; headline?: string; intro?: string; sections?: { id: SectionId; lines?: string[]; hidden?: boolean }[]; status?: Report['status'] }) => call<Report>('PUT', `/api/reports/${id}`, b),
    rewrite: (id: string, audience?: Audience) => call<Report>('POST', `/api/reports/${id}/rewrite`, audience ? { audience } : {}),
    versions: (id: string) => call<ReportVersion[]>('GET', `/api/reports/${id}/versions`),
    restore: (id: string, version: number) => call<Report>('POST', `/api/reports/${id}/restore`, { version }),
    act: (id: string, rec: string) => call<{ report: Report; created?: Post[]; navigate?: string; result: string }>('POST', `/api/reports/${id}/actions/${rec}`),
    remove: (id: string) => call<{ ok: true }>('DELETE', `/api/reports/${id}`),
    goals: () => call<{ goals: Goal[] } | Goal[]>('GET', '/api/reports/goals').then((r) => (Array.isArray(r) ? r : r.goals ?? [])),
    saveGoals: (goals: GoalInput[]) => call<{ goals: Goal[] } | Goal[]>('PUT', '/api/reports/goals', { goals }).then((r) => (Array.isArray(r) ? r : r.goals ?? [])),
    notes: () => call<Note[] | { notes: Note[] }>('GET', '/api/reports/notes').then((r) => (Array.isArray(r) ? r : r.notes ?? [])),
    addNote: (date: string, text: string) => call<Note>('POST', '/api/reports/notes', { date, text }),
    removeNote: (id: string) => call<unknown>('DELETE', `/api/reports/notes/${id}`),
    shares: (id: string) => call<ShareInfo[]>('GET', `/api/reports/${id}/shares`),
    share: (id: string, expiresDays?: number) => call<{ id: string; url: string; expiresAt?: string }>('POST', `/api/reports/${id}/shares`, expiresDays ? { expiresDays } : {}),
    revokeShare: (id: string, share: string) => call<unknown>('DELETE', `/api/reports/${id}/shares/${share}`),
    ask: (id: string, question: string) => call<AskAnswer>('POST', `/api/reports/${id}/ask`, { question }),
    send: (id: string) => call<{ sent: string[]; failed: string[] }>('POST', `/api/reports/${id}/send`),
    schedule: () => call<ReportSchedule>('GET', '/api/reports/schedule'),
    saveSchedule: (s: ReportSchedule) => call<ReportSchedule>('PUT', '/api/reports/schedule', s),
    email: () => call<EmailSettings>('GET', '/api/reports/email'),
    saveEmail: (e: Partial<EmailSettings>) => call<EmailSettings>('PUT', '/api/reports/email', e),
    testEmail: (to: string) => call<unknown>('POST', '/api/reports/email/test', { to }),
    rollup: () => call<RollupItem[]>('GET', '/api/workspaces/reports-rollup'),
  },
  site: {
    status: () => call<SiteState>('GET', '/api/site'),
    save: (b: { ga4Property?: string; ga4Name?: string; gscSite?: string; domains?: string[]; utm?: boolean }) => call<SiteState>('PUT', '/api/site', b),
    choices: () => call<SiteChoices>('GET', '/api/site/choices'),
    sync: () => call<{ days: number; from: string; to: string; ga4: boolean; search: boolean }>('POST', '/api/site/sync'),
  },
  upload: async (id: string, file: File) => {
    const res = await fetch(`/api/campaigns/${id}/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: apiHeaders(), body: file });
    await check(res, `/api/campaigns/${id}/uploads`);
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
