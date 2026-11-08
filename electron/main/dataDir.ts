import path from 'path';

/**
 * Root folder for all app data (SQLite DB, cover/canvas/transcode caches, uploaded music).
 *
 * - Packaged desktop app: AESTHETICY_DATA_DIR is set to Electron's per-user `userData`
 *   folder (see bootstrapEnv.ts), so data survives updates and the app works no matter
 *   which working directory Windows launches it from (Start menu, file association...).
 * - Dev / web bridge mode: falls back to `<project>/data`.
 */
export function getDataDir(): string {
  const fromEnv = process.env.AESTHETICY_DATA_DIR;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd(), 'data');
}
