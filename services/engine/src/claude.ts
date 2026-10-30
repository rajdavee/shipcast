import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { run } from './exec.ts';
import { engineEnv } from './setup.ts';

export interface ClaudeAuth {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  method?: string;
  account?: string;
}

/** Ask the local Claude Code CLI who is signed in. Never reads tokens. */
export async function claudeAuth(): Promise<ClaudeAuth> {
  const v = await run('claude', ['--version']);
  if (v.code !== 0) return { installed: false, loggedIn: false };
  const version = v.stdout.trim().split(' ')[0];
  const s = await run('claude', ['auth', 'status', '--json']);
  try {
    const j = JSON.parse(s.stdout);
    return {
      installed: true,
      version,
      loggedIn: !!j.loggedIn,
      method: j.authMethod,
      account: j.email ?? j.orgName,
    };
  } catch {
    return { installed: true, version, loggedIn: false };
  }
}

/** Events we surface from Claude's stream-json output. */
export type StreamEvent =
  | { kind: 'init'; sessionId: string; model?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; summary: string }
  | { kind: 'tool_result'; summary: string; isError: boolean }
  | { kind: 'result'; ok: boolean; text: string; costUsd?: number; durationMs?: number; sessionId?: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** One-line description of a tool call, for the live timeline. */
export function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Bash':
      return pick('description') || clip(pick('command').split('\n')[0], 120);
    case 'Read':
    case 'Write':
    case 'Edit':
      return pick('file_path').split('/').slice(-2).join('/');
    case 'WebFetch':
      return pick('url');
    case 'WebSearch':
      return pick('query');
    case 'Skill':
      return pick('skill');
    case 'Glob':
    case 'Grep':
      return pick('pattern');
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
      const active = todos.find((t) => t.status === 'in_progress');
      return active?.content ?? `${todos.length} tasks`;
    }
    default:
      return '';
  }
}

/** Parse one line of `claude -p --output-format stream-json` into zero or more events. */
export function parseStreamLine(line: string): StreamEvent[] {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return [];
  }
  if (m.type === 'system' && m.subtype === 'init') return [{ kind: 'init', sessionId: m.session_id, model: m.model }];
  if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
    return m.message.content.flatMap((b: any): StreamEvent[] => {
      if (b.type === 'text' && b.text?.trim()) return [{ kind: 'text', text: b.text.trim() }];
      if (b.type === 'tool_use') return [{ kind: 'tool', tool: b.name, summary: summarizeTool(b.name, b.input) }];
      return [];
    });
  }
  if (m.type === 'user' && Array.isArray(m.message?.content)) {
    return m.message.content.flatMap((b: any): StreamEvent[] => {
      if (b.type !== 'tool_result') return [];
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? '').join(' ') : '';
      return [{ kind: 'tool_result', summary: clip(text.trim().split('\n')[0] ?? '', 160), isError: !!b.is_error }];
    });
  }
  if (m.type === 'result') {
    return [
      {
        kind: 'result',
        ok: m.subtype === 'success' && !m.is_error,
        text: typeof m.result === 'string' ? m.result : (m.subtype ?? ''),
        costUsd: m.total_cost_usd,
        durationMs: m.duration_ms,
        sessionId: m.session_id,
      },
    ];
  }
  return [];
}

export interface RunOptions {
  prompt: string;
  cwd: string;
  pluginDir?: string;
  addDirs?: string[];
  allowedTools: string[];
  model?: string;
  resume?: string;
  appendSystemPrompt?: string;
  extraArgs?: string[];
  allowSubagents?: boolean;
  onEvent: (e: StreamEvent) => void;
}

export function buildArgs(o: Omit<RunOptions, 'onEvent' | 'cwd'>): string[] {
  const args = ['-p', o.prompt, '--output-format', 'stream-json', '--verbose'];
  args.push('--allowedTools', o.allowedTools.join(','));
  // Sub-agents multiply usage; only workflows that are built around them get them.
  if (o.allowSubagents) args[args.indexOf('--allowedTools') + 1] += ',Task,Agent';
  else args.push('--disallowedTools', 'Task,Agent');
  if (o.pluginDir) args.push('--plugin-dir', o.pluginDir);
  for (const d of o.addDirs ?? []) args.push('--add-dir', d);
  if (o.model) args.push('--model', o.model);
  if (o.resume) args.push('--resume', o.resume);
  if (o.appendSystemPrompt) args.push('--append-system-prompt', o.appendSystemPrompt);
  args.push(...(o.extraArgs ?? []));
  return args;
}

export interface ClaudeRun {
  child: ChildProcess;
  kill: () => void;
  done: Promise<{ code: number | null; result?: Extract<StreamEvent, { kind: 'result' }>; sessionId?: string; stderr: string }>;
}

export function runClaude(o: RunOptions): ClaudeRun {
  const bin = process.env.SHIPCAST_CLAUDE_BIN ?? 'claude';
  const child = spawn(bin, buildArgs(o), {
    cwd: o.cwd,
    env: { ...process.env, ...engineEnv() },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so stopping a run also stops the renders it started.
    detached: process.platform !== 'win32',
  });
  let result: Extract<StreamEvent, { kind: 'result' }> | undefined;
  let sessionId: string | undefined;
  let stderr = '';
  child.stderr!.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    for (const e of parseStreamLine(line)) {
      if (e.kind === 'init') sessionId = e.sessionId;
      if (e.kind === 'result') result = e;
      o.onEvent(e);
    }
  });
  const done = new Promise<Awaited<ClaudeRun['done']>>((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: String(err) }));
    child.on('close', (code) => resolve({ code, result, sessionId: result?.sessionId ?? sessionId, stderr }));
  });
  const kill = () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  };
  return { child, kill, done };
}
