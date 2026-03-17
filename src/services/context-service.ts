import { nowIso } from '../lib/format.js';
import type Database from 'better-sqlite3';

export function buildContext(db: Database.Database, input: { projectId: number; limit: number }) {
  const project = db.prepare(`SELECT name, root_path FROM projects WHERE id = ?`).get(input.projectId) as {
    name: string;
    root_path: string;
  };

  const activeSession = db
    .prepare(
      `SELECT id, started_at, actor_type, actor_name FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
    )
    .get(input.projectId) as
    | { id: number; started_at: string; actor_type: 'human' | 'agent'; actor_name: string | null }
    | undefined;

  const decisions = db
    .prepare(`SELECT created_at, title, summary FROM events WHERE project_id = ? AND type = 'decision' ORDER BY created_at DESC LIMIT ?`)
    .all(input.projectId, input.limit);

  const worklogs = db
    .prepare(`SELECT created_at, title, summary FROM events WHERE project_id = ? AND type = 'worklog' ORDER BY created_at DESC LIMIT ?`)
    .all(input.projectId, input.limit);

  const notes = db
    .prepare(`SELECT created_at, title, summary FROM events WHERE project_id = ? AND type = 'note' ORDER BY created_at DESC LIMIT ?`)
    .all(input.projectId, input.limit);

  const openTasks = db
    .prepare(`SELECT id, title, priority, updated_at FROM tasks WHERE project_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT ?`)
    .all(input.projectId, input.limit);

  const artifacts = db
    .prepare(`SELECT path, kind, note, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(input.projectId, input.limit);

  return {
    generatedAt: nowIso(),
    projectName: project.name,
    projectPath: project.root_path,
    activeSession: activeSession ?? null,
    recentDecisions: decisions,
    recentWorklogs: worklogs,
    notableNotes: notes,
    openTasks,
    recentArtifacts: artifacts,
  };
}
