import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run, which } from './exec.ts';
import { claudeAuth } from './claude.ts';
import { githubStatus } from './github.ts';
import { voiceReady } from './setup.ts';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  hint?: string;
  /** Id of a one-click setup in SETUPS that fixes this check. */
  fix?: string;
}

/** Find a Chrome the renderers can drive: HyperFrames' cached shell, then system browsers. */
export function findChrome(): string | null {
  const cache = join(homedir(), '.cache/hyperframes/chrome/chrome-headless-shell');
  if (existsSync(cache)) {
    for (const v of readdirSync(cache).sort().reverse()) {
      for (const sub of readdirSync(join(cache, v))) {
        const bin = join(cache, v, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

async function bin(id: string, label: string, required: boolean, hint: string, versionArgs = ['-version']): Promise<Check> {
  const path = await which(id);
  if (!path) return { id, label, ok: false, required, detail: 'not found', hint };
  const v = await run(id, versionArgs, { timeoutMs: 10_000 });
  const ver = (v.stdout + v.stderr).match(/version\s+v?([\w.-]+)/i)?.[1];
  return { id, label, ok: true, required, detail: ver ? `v${ver}` : 'ready' };
}

export async function doctor(): Promise<Check[]> {
  const [claude, gh, git, ffmpeg, whisper, kokoro] = await Promise.all([
    claudeAuth(),
    githubStatus(),
    bin('git', 'git', true, 'Install git', ['--version']),
    bin('ffmpeg', 'FFmpeg', true, 'brew install ffmpeg  ·  apt install ffmpeg  ·  winget install ffmpeg'),
    bin('whisper-cli', 'whisper.cpp (captions)', false, 'brew install whisper-cpp — word-timed captions offline', ['--help']),
    voiceReady(),
  ]);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const chrome = findChrome();
  return [
    {
      id: 'node',
      label: 'Node.js',
      ok: major > 22 || (major === 22 && minor >= 18),
      required: true,
      detail: process.version,
      hint: 'Shipcast needs Node 22.18 or newer',
    },
    {
      id: 'claude',
      label: 'Claude Code',
      ok: claude.installed && claude.loggedIn,
      required: true,
      detail: !claude.installed ? 'not installed' : claude.loggedIn ? `${claude.version} · ${claude.method ?? 'signed in'}` : `${claude.version} · signed out`,
      hint: !claude.installed ? 'npm install -g @anthropic-ai/claude-code' : 'claude auth login',
    },
    {
      id: 'gh',
      label: 'GitHub CLI',
      ok: gh.loggedIn,
      required: false,
      detail: !gh.installed ? 'not installed' : gh.loggedIn ? `@${gh.login}` : 'signed out',
      hint: !gh.installed ? 'brew install gh — needed for private repos and PR videos' : 'gh auth login --web',
    },
    git,
    ffmpeg,
    {
      id: 'chrome',
      label: 'Headless Chrome',
      ok: !!chrome,
      required: true,
      detail: chrome ? chrome.split('/').slice(-1)[0] : 'not found',
      hint: 'npx hyperframes browser ensure  (or install Google Chrome)',
      fix: 'chrome',
    },
    whisper,
    {
      id: 'kokoro',
      label: 'Kokoro TTS (voiceover)',
      ok: kokoro,
      required: false,
      detail: kokoro ? 'local voices ready' : 'not installed — videos fall back to the system voice',
      hint: 'Free, natural local voiceover. Installs into ~/.shipcast/voice.',
      fix: 'voice',
    },
  ];
}
