import { spawn, type ChildProcess } from 'node:child_process';

/**
 * "Connect" flows. Shipcast never sees a token: it starts the official CLI
 * login (Claude Code, GitHub CLI) and relays the URL or one-time code the
 * CLI prints so you can finish in your browser. The CLIs store their own
 * credentials exactly as if you had run them in a terminal.
 */
export interface LoginState {
  running: boolean;
  url?: string;
  code?: string;
  output: string;
  exitCode?: number | null;
}

const flows = new Map<string, { child: ChildProcess; state: LoginState }>();

function startFlow(key: string, cmd: string, args: string[], parse: (out: string, st: LoginState) => void, stdin?: string): LoginState {
  const existing = flows.get(key);
  if (existing?.state.running) return existing.state;
  const state: LoginState = { running: true, output: '' };
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '' } });
  const onData = (d: Buffer) => {
    state.output = (state.output + d.toString()).slice(-4000);
    parse(state.output, state);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => {
    state.running = false;
    state.output += String(e);
  });
  child.on('close', (code) => {
    state.running = false;
    state.exitCode = code;
  });
  if (stdin) child.stdin.write(stdin);
  setTimeout(() => child.kill('SIGTERM'), 10 * 60_000).unref();
  flows.set(key, { child, state });
  return state;
}

export function loginState(key: string): LoginState | null {
  return flows.get(key)?.state ?? null;
}

const firstUrl = (s: string, host: RegExp) => s.match(/https:\/\/[^\s"'<>]+/g)?.find((u) => host.test(u));

export function startClaudeLogin(): LoginState {
  return startFlow('claude', process.env.SHIPCAST_CLAUDE_BIN ?? 'claude', ['auth', 'login', '--claudeai'], (out, st) => {
    st.url ??= firstUrl(out, /claude\.(ai|com)|anthropic\.com/);
  });
}

export function startGithubLogin(): LoginState {
  return startFlow(
    'github',
    'gh',
    ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'],
    (out, st) => {
      st.code ??= out.match(/code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
      if (st.code) st.url = 'https://github.com/login/device';
    },
    '\n',
  );
}
