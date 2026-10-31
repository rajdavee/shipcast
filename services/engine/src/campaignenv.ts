import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { campaignDir } from './paths.ts';

/**
 * A campaign's environment: the env vars (and test login) the user gave so
 * Shipcast can run their app. Stored next to the campaign with mode 600,
 * passed to Claude's shell for app steps, never shown back by the API and
 * scrubbed from every output file.
 */

const envFile = (id: string) => join(campaignDir(id), 'secrets.env');
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse KEY=VALUE lines (quotes and `export` allowed, # comments ignored). */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (KEY.test(k)) out[k] = v;
  }
  return out;
}

export async function readCampaignEnv(id: string): Promise<Record<string, string>> {
  try {
    return parseEnvText(await readFile(envFile(id), 'utf8'));
  } catch {
    return {};
  }
}

export async function writeCampaignEnv(id: string, patch: Record<string, string | null>): Promise<string[]> {
  const cur = await readCampaignEnv(id);
  for (const [k, v] of Object.entries(patch)) {
    if (!KEY.test(k)) continue;
    if (v === null) delete cur[k];
    else cur[k] = v;
  }
  await mkdir(campaignDir(id), { recursive: true });
  const body = Object.entries(cur).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n';
  await writeFile(envFile(id), body, { mode: 0o600 });
  await chmod(envFile(id), 0o600);
  return Object.keys(cur);
}

const TEXT = /\.(md|txt|json|html?|srt|vtt|csv|ya?ml|js|css|svg|xml|log)$/i;

/**
 * Replace any secret value found in text outputs with •••. Values shorter
 * than 6 characters are skipped (too likely to collide with normal words).
 * Returns the files that were scrubbed.
 */
export async function scrubSecrets(dir: string, secrets: Record<string, string>): Promise<string[]> {
  const values = Object.values(secrets).filter((v) => v && v.length >= 6).sort((a, b) => b.length - a.length);
  if (!values.length || !existsSync(dir)) return [];
  const hits: string[] = [];
  const walk = async (d: string) => {
    for (const name of await readdir(d)) {
      const p = join(d, name);
      const s = await stat(p);
      if (s.isDirectory()) {
        if (name === 'node_modules' || name === 'vendor' || name === '.git') continue;
        await walk(p);
      } else if (TEXT.test(name) && s.size < 20 * 1024 * 1024) {
        let t = await readFile(p, 'utf8');
        let changed = false;
        for (const v of values) if (t.includes(v)) {
          t = t.split(v).join('•••');
          changed = true;
        }
        if (changed) {
          await writeFile(p, t);
          hits.push(p);
        }
      }
    }
  };
  await walk(dir);
  return hits;
}
