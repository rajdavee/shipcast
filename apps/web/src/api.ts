// Types mirror services/engine/src/types.ts; the web app talks to it only over HTTP.
export type SourceType = 'url' | 'github' | 'local' | 'text';
export type StepStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'blocked';

export interface Step {
  id: string;
  kind: 'brief' | 'pack';
  pack?: string;
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
  provider: 'kokoro' | 'elevenlabs';
  connected: boolean;
  voice?: string;
  model?: string;
  voices?: { id: string; name: string; category?: string; labels?: Record<string, string>; preview?: string }[];
  error?: string;
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
  voice: () => call<VoiceState>('GET', '/api/voice'),
  saveVoice: (b: { apiKey?: string; provider?: 'kokoro' | 'elevenlabs'; voice?: string; model?: string }) => call<VoiceState>('PUT', '/api/voice', b),
  disconnectVoice: () => call<VoiceState>('DELETE', '/api/voice/elevenlabs'),
  broll: () => call<{ connected: boolean }>('GET', '/api/broll'),
  saveBroll: (apiKey: string) => call<{ connected: boolean }>('PUT', '/api/broll', { apiKey }),
  disconnectBroll: () => call<{ connected: boolean }>('DELETE', '/api/broll'),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/api/settings', s),
  campaigns: () => call<Campaign[]>('GET', '/api/campaigns'),
  campaign: (id: string) => call<Campaign>('GET', `/api/campaigns/${id}`),
  createCampaign: (body: unknown) => call<Campaign>('POST', '/api/campaigns', body),
  deleteCampaign: (id: string) => call<{ ok: true }>('DELETE', `/api/campaigns/${id}`),
  addStep: (id: string, pack: string, options: Record<string, string>) => call<Campaign>('POST', `/api/campaigns/${id}/steps`, { pack, options }),
  removeStep: (id: string, step: string) => call<Campaign>('DELETE', `/api/campaigns/${id}/steps/${step}`),
  revise: (id: string, step: string, note: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/revise`, { note }),
  retry: (id: string, step: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/retry`),
  cancel: (id: string, step: string) => call<Campaign>('POST', `/api/campaigns/${id}/steps/${step}/cancel`),
  services: () => call<{ name: string; ok: boolean; queued?: number; running?: number; voice?: string }[]>('GET', '/api/services'),
  catalog: (kind: string) => call<any>('GET', `/api/catalog/${kind}`),
  getSpec: (id: string, step: string) => call<{ kind: string; spec: any }>('GET', `/api/campaigns/${id}/steps/${step}/spec`),
  saveSpec: (id: string, step: string, spec: unknown) => call<Campaign>('PUT', `/api/campaigns/${id}/steps/${step}/spec`, { spec }),
  tree: (id: string) => call<{ brief: string[]; deliverables: string[]; uploads: string[] }>('GET', `/api/campaigns/${id}/tree`),
  preview: (id: string, step: string, spec: unknown) => call<{ frames: string[]; scenes: { id: string; start: number; duration: number }[]; duration: number }>('POST', `/api/campaigns/${id}/steps/${step}/preview`, { spec }),
  reveal: (id: string) => call<{ ok: true }>('POST', `/api/campaigns/${id}/reveal`),
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
