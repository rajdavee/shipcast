// Shared by the real-product-film scripts: load Shipcast's engine from this
// checkout and work in the run's own workspace, so signed-in sessions stay
// private to it.
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../services/engine/src');
const ws = process.env.SHIPCAST_WORKSPACE_HOME;
if (ws && basename(dirname(ws)) === 'workspaces') process.env.SHIPCAST_HOME ??= dirname(dirname(ws));
const context = await import(join(src, 'context.ts'));
if (ws && basename(dirname(ws)) === 'workspaces') context.setProcessContext({ workspace: basename(ws) });

export const takes = await import(join(src, 'takes.ts'));
export const sessions = await import(join(src, 'capture-session.ts'));
export const explore = await import(join(src, 'explore.ts'));
