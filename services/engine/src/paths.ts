import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentContext } from './context.ts';

/** Repository root (the folder that holds packs/ and plugin/). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const PACKS_DIR = process.env.SHIPCAST_PACKS ?? join(ROOT, 'packs');
export const PLUGIN_DIR = join(ROOT, 'plugin');
export const WEB_DIST = join(ROOT, 'apps/web/dist');

/** The install's data root. Override with SHIPCAST_HOME. Machine-wide caches and the account store live here. */
export function rootHome(): string {
  return process.env.SHIPCAST_HOME ?? join(homedir(), '.shipcast');
}

/**
 * Where the current workspace's data lives: inside a request or job, its own folder under
 * `workspaces/`; outside one, the root (single-user installs and machine-wide tools).
 */
export function home(): string {
  const ws = currentContext()?.workspace;
  return ws ? join(rootHome(), 'workspaces', ws) : rootHome();
}

export const workspaceDir = (id: string) => join(rootHome(), 'workspaces', id);
/** Per-user private data (their own Claude token and config). */
export const userDir = (id: string) => join(rootHome(), 'users', id);

export const campaignsDir = () => join(home(), 'campaigns');
/** A campaign's folder. Ids come from URLs, so anything but a plain id is refused before it can become a path. */
export const campaignDir = (id: string) => {
  if (!/^[\w-]{1,80}$/.test(String(id))) throw Object.assign(new Error('campaign not found'), { status: 404 });
  return join(campaignsDir(), id);
};
export const settingsFile = () => join(home(), 'settings.json');
