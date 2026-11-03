import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A cross-process lock on a folder: `mkdir` is atomic, so whichever process
 * creates `<dir>/.lock` first goes ahead. A lock older than 10 s is from a
 * process that died mid-write and is cleared.
 */
export async function withDirLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(dir, '.lock');
  await mkdir(dir, { recursive: true });
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
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
