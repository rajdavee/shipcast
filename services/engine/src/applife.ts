import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnCollect } from './exec.ts';
import { readCampaignEnv } from './campaignenv.ts';
import { campaignDir } from './paths.ts';
import type { Campaign } from './types.ts';

/**
 * The life of the user's app inside a campaign: app-run starts it and records
 * how to start and stop it in out/app.json; later steps need it up; Shipcast
 * stops it when the campaign is packaged, fails, is cancelled or deleted.
 */

export interface AppJson {
  url?: string;
  external?: boolean;
  start?: string[] | string;
  stop?: string[] | string;
  [k: string]: unknown;
}

const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String).slice(0, 12);

/** The newest finished app-run step's folder and app.json. */
export async function appInfo(c: Campaign): Promise<{ dir: string; app: AppJson } | null> {
  for (const s of [...c.steps].reverse()) {
    if (s.pack !== 'app-run' || s.status !== 'done') continue;
    const dir = join(campaignDir(c.id), 'deliverables', s.id);
    try {
      return { dir, app: JSON.parse(await readFile(join(dir, 'out', 'app.json'), 'utf8')) };
    } catch {}
  }
  return null;
}

/** Is anything answering at the app's URL (any status below 500)? */
export async function appUp(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function sh(c: Campaign, cmds: string[], cwd: string, timeoutMs: number): Promise<string[]> {
  const out: string[] = [];
  // The same environment app-run had: the user's env vars for this campaign.
  const env = { ...process.env, ...(await readCampaignEnv(c.id).catch(() => ({}))) };
  for (const cmd of cmds) {
    // Commands run from the app-run step's folder (where work/ and out/ live).
    const r = await spawnCollect('/bin/sh', ['-c', cmd], { cwd, env, timeoutMs }).catch((e) => ({ code: 1, stdout: '', stderr: String(e) }));
    out.push(r.code === 0 ? `ok: ${cmd.slice(0, 80)}` : `failed: ${cmd.slice(0, 80)} — ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0]?.slice(0, 160) ?? ''}`);
  }
  return out;
}

/** Bring the app back (after a reboot, sleep, or a stop) from app.json `start`, then wait for it. */
export async function startApp(c: Campaign, waitMs = 150_000): Promise<{ up: boolean; log: string[] }> {
  const info = await appInfo(c);
  if (!info) return { up: false, log: ['no app-run step has finished'] };
  if (await appUp(info.app.url)) return { up: true, log: ['already running'] };
  const cmds = list(info.app.start);
  if (!cmds.length) return { up: false, log: ['app.json has no start commands'] };
  const log = await sh(c, cmds, info.dir, 300_000);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    if (await appUp(info.app.url)) return { up: true, log };
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { up: false, log: [...log, `nothing answered at ${info.app.url} after ${Math.round(waitMs / 1000)} s`] };
}

/** Stop what app-run started (app.json `stop`), best effort. Never touches an external app. */
export async function stopApp(c: Campaign): Promise<string[]> {
  const info = await appInfo(c);
  if (!info || info.app.external) return [];
  return (await sh(c, list(info.app.stop), info.dir, 180_000)).map((l) => l.replace(/^ok:/, 'stopped:').replace(/^failed:/, 'could not stop:'));
}

/** True when nothing in the campaign is running, queued or waiting for the user. */
export const campaignIdle = (c: Campaign) => !c.steps.some((s) => s.status === 'running' || s.status === 'queued' || s.status === 'needs-input' || s.status === 'blocked');

export interface OptionalKey {
  key: string;
  label: string;
  unlocks?: string;
  set: boolean;
}

export async function appStatus(c: Campaign): Promise<{ hasApp: boolean; url?: string; up: boolean; external: boolean; canStart: boolean; optional: OptionalKey[] }> {
  const info = await appInfo(c);
  if (!info) return { hasApp: false, up: false, external: false, canStart: false, optional: [] };
  const env = await readCampaignEnv(c.id).catch(() => ({}) as Record<string, string>);
  const optional = (Array.isArray(info.app.optional) ? info.app.optional : [])
    .filter((o: any) => o && /^[A-Z][A-Z0-9_]*$/.test(String(o.key)))
    .slice(0, 8)
    .map((o: any) => ({ key: String(o.key), label: String(o.label ?? o.key).slice(0, 80), unlocks: o.unlocks ? String(o.unlocks).slice(0, 160) : undefined, set: !!env[String(o.key)] }));
  return { hasApp: true, url: info.app.url, up: await appUp(info.app.url), external: !!info.app.external, canStart: list(info.app.start).length > 0 && existsSync(join(info.dir, 'work', 'app')), optional };
}

async function du(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  const r = await spawnCollect('du', ['-sk', path], { timeoutMs: 120_000 });
  return (Number(r.stdout.trim().split(/\s+/)[0]) || 0) * 1024;
}

/** Disk used by the campaign, and how much of it is the copy of the user's app. */
export async function campaignSize(c: Campaign): Promise<{ bytes: number; appBytes: number }> {
  const info = await appInfo(c);
  return { bytes: await du(campaignDir(c.id)), appBytes: info ? await du(join(info.dir, 'work')) : 0 };
}

/**
 * Drop what's only needed while making: render projects, chapter caches and
 * scratch folders. Finished files stay; specs stay, so re-rendering still works.
 * With `app`, also stop the app and delete its copy (re-capturing then needs setup again).
 */
export async function tidyCampaign(c: Campaign, opts: { app?: boolean } = {}): Promise<{ freed: number; log: string[] }> {
  const before = await du(campaignDir(c.id));
  const log: string[] = [];
  const info = await appInfo(c);
  const root = join(campaignDir(c.id), 'deliverables');
  for (const id of await readdir(root).catch(() => [] as string[])) {
    const d = join(root, id);
    const isApp = info?.dir === d;
    for (const sub of ['out/project', 'out/chapters', 'out/preview']) await rm(join(d, sub), { recursive: true, force: true });
    if (!isApp) {
      // Keep notes Claude wrote for itself (model.md and friends); drop everything heavy.
      for (const e of await readdir(join(d, 'work'), { withFileTypes: true }).catch(() => [])) {
        if (e.isFile() && /\.(md|json)$/.test(e.name)) continue;
        await rm(join(d, 'work', e.name), { recursive: true, force: true });
      }
    }
  }
  if (opts.app && info && !info.app.external) {
    log.push(...(await stopApp(c)));
    await rm(join(info.dir, 'work'), { recursive: true, force: true });
    log.push('removed the app copy');
  }
  return { freed: Math.max(0, before - (await du(campaignDir(c.id)))), log };
}
