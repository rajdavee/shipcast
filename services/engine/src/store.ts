import { mkdir, readFile, writeFile, rename, readdir, appendFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { campaignDir, campaignsDir, settingsFile, home } from './paths.ts';
import type { Campaign, CampaignEvent, Settings, Step } from './types.ts';

export const DEFAULT_SETTINGS: Settings = {
  model: '',
  genCapPerProject: 5,
  genCapPerMonth: 25,
  allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite'],
  stepTimeoutMinutes: 60,
  subagents: 'pack',
  directorReview: true,
  criticReview: true,
  extraArgs: [],
  voiceProvider: 'kokoro',
  elevenVoice: '',
  elevenModel: 'eleven_multilingual_v2',
  agentsPaused: false,
  agentsQuietStart: '23:00',
  agentsQuietEnd: '07:00',
  agentsMaxClaudeRunsPerDay: 6,
  publishingPaused: false,
  metricsPaused: false,
};

export function newId(prefix = ''): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}${stamp}-${randomBytes(3).toString('hex')}`;
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(2).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, file);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cross-process lock around a campaign's read-modify-write. The api and the
 * worker are separate processes that share only the data dir, so this is a
 * mkdir lock (atomic on every filesystem we care about) with stale-lock
 * recovery.
 */
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(campaignDir(id), '.lock');
  for (let i = 0; ; i++) {
    try {
      await mkdir(lock);
      break;
    } catch {
      if (i > 200) {
        const s = await stat(lock).catch(() => null);
        if (s && Date.now() - s.mtimeMs > 10_000) await rm(lock, { recursive: true, force: true });
        i = 0;
      }
      await sleep(10);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function readCampaign(id: string): Promise<Campaign | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(campaignDir(id), 'campaign.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function listCampaigns(): Promise<Campaign[]> {
  const dir = campaignsDir();
  if (!existsSync(dir)) return [];
  const ids = await readdir(dir);
  const all = await Promise.all(ids.map(readCampaign));
  return all.filter((c): c is Campaign => !!c).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createCampaign(c: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>): Promise<Campaign> {
  const id = newId('c');
  const now = new Date().toISOString();
  const campaign: Campaign = { ...c, id, createdAt: now, updatedAt: now };
  const dir = campaignDir(id);
  await mkdir(join(dir, 'uploads'), { recursive: true });
  await writeJsonAtomic(join(dir, 'campaign.json'), campaign);
  await appendEvent(id, { step: '-', type: 'log', text: `Campaign created: ${campaign.name}` });
  return campaign;
}

/** Atomically update a campaign. `fn` may mutate and/or return a value. */
export async function updateCampaign<T>(id: string, fn: (c: Campaign) => T): Promise<{ campaign: Campaign; result: T }> {
  return withLock(id, async () => {
    const c = await readCampaign(id);
    if (!c) throw new Error(`campaign ${id} not found`);
    const result = fn(c);
    c.updatedAt = new Date().toISOString();
    await writeJsonAtomic(join(campaignDir(id), 'campaign.json'), c);
    return { campaign: c, result };
  });
}

export async function updateStep(id: string, stepId: string, patch: Partial<Step>): Promise<Campaign> {
  const { campaign } = await updateCampaign(id, (c) => {
    const s = c.steps.find((x) => x.id === stepId);
    if (s) Object.assign(s, patch);
  });
  return campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  if (!/^[\w-]+$/.test(id)) return;
  await rm(campaignDir(id), { recursive: true, force: true });
}

export async function appendEvent(id: string, e: Omit<CampaignEvent, 't'>): Promise<void> {
  const line = JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n';
  await appendFile(join(campaignDir(id), 'events.ndjson'), line);
}

/** Read events starting at a byte offset. Returns the new offset. */
export async function readEvents(id: string, offset = 0): Promise<{ events: CampaignEvent[]; offset: number }> {
  const file = join(campaignDir(id), 'events.ndjson');
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch {
    return { events: [], offset };
  }
  if (buf.length <= offset) return { events: [], offset };
  const chunk = buf.subarray(offset);
  const lastNl = chunk.lastIndexOf(0x0a);
  if (lastNl < 0) return { events: [], offset };
  const events = chunk
    .subarray(0, lastNl)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as CampaignEvent];
      } catch {
        return [];
      }
    });
  return { events, offset: offset + lastNl + 1 };
}

export async function readSettings(): Promise<Settings> {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch };
  await mkdir(home(), { recursive: true });
  await writeJsonAtomic(settingsFile(), next);
  return next;
}
