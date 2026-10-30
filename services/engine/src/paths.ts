import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (the folder that holds packs/ and plugin/). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const PACKS_DIR = process.env.SHIPCAST_PACKS ?? join(ROOT, 'packs');
export const PLUGIN_DIR = join(ROOT, 'plugin');
export const WEB_DIST = join(ROOT, 'apps/web/dist');

/** Where campaigns and settings live. Override with SHIPCAST_HOME. */
export function home(): string {
  return process.env.SHIPCAST_HOME ?? join(homedir(), '.shipcast');
}

export const campaignsDir = () => join(home(), 'campaigns');
export const campaignDir = (id: string) => join(campaignsDir(), id);
export const settingsFile = () => join(home(), 'settings.json');
