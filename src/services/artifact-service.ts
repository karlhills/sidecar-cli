import type Database from 'better-sqlite3';
import { nowIso } from '../lib/format.js';
import type { ArtifactKind } from '../types/models.js';

export function addArtifact(db: Database.Database, input: {
  projectId: number;
  path: string;
  kind: ArtifactKind;
  note?: string;
}) {
  const info = db
    .prepare(`INSERT INTO artifacts (project_id, path, kind, note, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(input.projectId, input.path, input.kind, input.note ?? null, nowIso());

  return Number(info.lastInsertRowid);
}

export function listArtifacts(db: Database.Database, projectId: number) {
  return db
    .prepare(`SELECT id, path, kind, note, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(projectId);
}
