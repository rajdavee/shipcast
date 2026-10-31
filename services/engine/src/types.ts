export type SourceType = 'url' | 'github' | 'local' | 'text';

export interface Source {
  type: SourceType;
  /** URL, owner/repo, absolute folder path, or free text. */
  value: string;
  /** Optional branch, tag or PR number for GitHub sources. */
  ref?: string;
}

export type StepStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'blocked';

export interface Revision {
  note: string;
  at: string;
}

export interface Step {
  id: string;
  kind: 'brief' | 'pack';
  /** Pack id for kind === 'pack'. */
  pack?: string;
  options: Record<string, string>;
  status: StepStatus;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  outputs: string[];
  costUsd?: number;
  durationMs?: number;
  revisions: Revision[];
  /** Set when a revision is queued; consumed by the worker. */
  pendingNote?: string;
  cancelRequested?: boolean;
  /** Re-render the edited spec without running Claude. */
  renderOnly?: boolean;
  worker?: string;
}

export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: Source;
  /** What the campaign is for: launch, feature, milestone, hiring ... */
  goal: string;
  audience: string;
  tone: string;
  notes: string;
  steps: Step[];
}

export type EventType = 'status' | 'text' | 'tool' | 'tool_result' | 'result' | 'log' | 'error';

export interface CampaignEvent {
  t: string;
  step: string;
  type: EventType;
  text?: string;
  tool?: string;
  status?: StepStatus;
  costUsd?: number;
}

export type OptionField =
  | { key: string; label: string; type: 'select'; choices: string[]; default: string; help?: string }
  | { key: string; label: string; type: 'text'; default: string; placeholder?: string; help?: string }
  | { key: string; label: string; type: 'number'; default: string; min?: number; max?: number; help?: string };

export interface SkillDep {
  /** Skill name as Claude Code sees it. */
  name: string;
  /** Upstream repo the skill is installed from (owner/repo). */
  source: string;
  /** Optional `--skill` filter for the skills CLI. */
  skill?: string;
}

export interface Pack {
  id: string;
  name: string;
  tagline: string;
  category: 'video' | 'motion' | 'design' | 'copy';
  /** Rough wall-clock time, shown in the UI. */
  estimate: string;
  /** Accent color used by the UI card. */
  accent: string;
  /** Source types this pack can work from. Empty = all. */
  sources?: SourceType[];
  options: OptionField[];
  /** Globs (relative to the deliverable's out/ folder) that count as results. */
  outputs: string[];
  skills: SkillDep[];
  /** Binaries the pack needs on PATH (checked by doctor). */
  tools: string[];
  /** Spec formats: Claude writes this JSON spec and a service renders it. */
  spec?: 'deck' | 'graphics' | 'storyboard';
  /** The workflow dispatches sub-agents (HyperFrames does, per frame). */
  subagents?: boolean;
  /** Sort order in the UI (lower first). */
  order?: number;
  prompt: string;
  dir: string;
}

export interface Settings {
  /** Claude model alias or id; empty = your Claude Code default. */
  model: string;
  /** Tools the headless Claude run may use without asking. */
  allowedTools: string[];
  /** Max wall-clock minutes per step before it is stopped. */
  stepTimeoutMinutes: number;
  /** 'pack' lets packs that need sub-agents use them; 'never' blocks them everywhere (saves usage, may slow big videos). */
  subagents: 'pack' | 'never';
  /** After a video passes QA, Claude reviews the frames like a creative director (one revision round). */
  directorReview: boolean;
  /** Extra args appended to every claude invocation. */
  extraArgs: string[];
}
