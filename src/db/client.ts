import { DatabaseSync } from 'node:sqlite';
import { findSidecarRoot, getSidecarPaths } from '../lib/paths.js';
import { SidecarError } from '../lib/errors.js';

export function requireInitialized(): { rootPath: string; db: DatabaseSync; projectId: number } {
  const rootPath = findSidecarRoot();
  if (!rootPath) {
    throw new SidecarError('Sidecar is not initialized in this directory or any parent directory', 'NOT_INITIALIZED', 2);
  }

  const db = new DatabaseSync(getSidecarPaths(rootPath).dbPath);
  const row = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (!row) {
    db.close();
    throw new SidecarError('Sidecar database exists but project row is missing. Re-run `sidecar init --force`.', 'PROJECT_MISSING', 2);
  }

  return { rootPath, db, projectId: row.id };
}
