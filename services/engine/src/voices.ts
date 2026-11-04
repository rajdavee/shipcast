import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withDirLock } from './filelock.ts';
import { home } from './paths.ts';

/**
 * Optional bring-your-own voice providers. Kokoro (local, free) is always the
 * default; ElevenLabs is used only when the user connects their own API key.
 * Keys live in ~/.shipcast/secrets.json (mode 600) and never leave this
 * machine except in requests to the provider itself.
 */

const secretsFile = () => join(home(), 'secrets.json');

async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(secretsFile(), 'utf8'));
  } catch {
    return {};
  }
}

export async function getSecret(name: string): Promise<string | undefined> {
  return (await readSecrets())[name] || undefined;
}

// Read-modify-write of one file shared by every connection: one at a time in this process, a folder
// lock across processes, and an atomic replace so a reader never sees a half-written file.
let secretChain: Promise<unknown> = Promise.resolve();
export function setSecret(name: string, value: string | null): Promise<void> {
  const go = async () => {
    await mkdir(home(), { recursive: true });
    await withDirLock(join(home(), '.secrets-lock'), async () => {
      const all = await readSecrets();
      if (value) all[name] = value;
      else delete all[name];
      const tmp = `${secretsFile()}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, secretsFile());
    });
  };
  const next = secretChain.then(go, go);
  secretChain = next.catch(() => {});
  return next;
}

const EL = 'https://api.elevenlabs.io/v1';

export interface ElevenVoice {
  id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview?: string;
}

/** Validate a key and list the voices it can use. Throws a readable error. */
export async function elevenVoices(apiKey?: string): Promise<ElevenVoice[]> {
  const key = apiKey ?? (await getSecret('elevenlabs'));
  if (!key) throw new Error('ElevenLabs is not connected');
  const r = await fetch(`${EL}/voices`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401) throw new Error('ElevenLabs rejected that API key');
  if (!r.ok) throw new Error(`ElevenLabs voices failed (${r.status})`);
  const data = (await r.json()) as { voices?: any[] };
  return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels, preview: v.preview_url }));
}

export interface ElevenSpeech {
  /** Raw 24 kHz mono 16-bit PCM. */
  pcm: Buffer;
  words: { text: string; start: number; end: number }[];
}

/**
 * Speak `text` with character-level timestamps and fold them into words, so
 * captions and cuts line up without a separate transcription pass.
 */
export async function elevenSpeak(text: string, voiceId: string, opts: { model?: string; speed?: number } = {}): Promise<ElevenSpeech> {
  const key = await getSecret('elevenlabs');
  if (!key) throw new Error('ElevenLabs is not connected');
  const r = await fetch(`${EL}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=pcm_24000`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: opts.model || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, ...(opts.speed && opts.speed !== 1 ? { speed: Math.min(1.2, Math.max(0.7, opts.speed)) } : {}) },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (r.status === 401) throw new Error('ElevenLabs rejected the API key');
  if (r.status === 429) throw new Error('ElevenLabs rate limit or quota reached');
  if (!r.ok) throw new Error(`ElevenLabs speech failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
  const a = data.alignment;
  const words: ElevenSpeech['words'] = [];
  if (a) {
    let cur: { text: string; start: number; end: number } | null = null;
    a.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) {
        if (cur) words.push(cur);
        cur = null;
        return;
      }
      if (!cur) cur = { text: '', start: a.character_start_times_seconds[i], end: a.character_end_times_seconds[i] };
      cur.text += ch;
      cur.end = a.character_end_times_seconds[i];
    });
    if (cur) words.push(cur);
  }
  return { pcm: Buffer.from(data.audio_base64, 'base64'), words };
}
