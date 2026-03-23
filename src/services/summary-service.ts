import fs from 'node:fs';
import { nowIso } from '../lib/format.js';
import { getSidecarPaths } from '../lib/paths.js';
import { renderSummaryMarkdown } from '../templates/summary.js';
import { createEvent } from './event-service.js';
import type { DatabaseSync } from 'node:sqlite';

export function readSummaryInputs(db: DatabaseSync, projectId: number, limit: number) {
  const project = db.prepare(`SELECT name, root_path FROM projects WHERE id = ?`).get(projectId) as {
    name: string;
    root_path: string;
  };

  const decisions = db
    .prepare(`SELECT created_at, title, summary FROM events WHERE project_id = ? AND type = 'decision' ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, limit) as Array<{ created_at: string; title: string; summary: string }>;

  const worklogs = db
    .prepare(`SELECT created_at, title, summary FROM events WHERE project_id = ? AND type = 'worklog' ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, limit) as Array<{ created_at: string; title: string; summary: string }>;

  const notes = db
    .prepare(`SELECT created_at, title, summary FROM events WHERE project_id = ? AND type = 'note' ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, limit) as Array<{ created_at: string; title: string; summary: string }>;

  const openTasks = db
    .prepare(`SELECT id, title, priority, updated_at FROM tasks WHERE project_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT ?`)
    .all(projectId, limit) as Array<{ id: number; title: string; priority: string | null; updated_at: string }>;

  const artifacts = db
    .prepare(`SELECT path, kind, note, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(projectId, limit) as Array<{ path: string; kind: string; note: string | null; created_at: string }>;

  const activeSession = db
    .prepare(
      `SELECT id, started_at, actor_type, actor_name FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
    )
    .get(projectId) as
    | { id: number; started_at: string; actor_type: 'human' | 'agent'; actor_name: string | null }
    | undefined;

  const recentEventCount = (
    db
      .prepare(`SELECT COUNT(*) as count FROM events WHERE project_id = ? AND created_at >= datetime('now', '-7 day')`)
      .get(projectId) as { count: number }
  ).count;

  return {
    projectName: project.name,
    projectPath: project.root_path,
    decisions,
    worklogs,
    notes,
    openTasks,
    artifacts,
    activeSession: activeSession ?? null,
    recentEventCount,
  };
}

export function refreshSummaryFile(db: DatabaseSync, rootPath: string, projectId: number, limit = 10) {
  const sidecarPaths = getSidecarPaths(rootPath);
  const data = readSummaryInputs(db, projectId, limit);
  const generatedAt = nowIso();

  const markdown = renderSummaryMarkdown({
    projectName: data.projectName,
    projectPath: data.projectPath,
    generatedAt,
    activeSession: data.activeSession,
    recentEventCount: data.recentEventCount,
    decisions: data.decisions,
    worklogs: data.worklogs,
    notes: data.notes,
    openTasks: data.openTasks,
    artifacts: data.artifacts,
  });

  fs.writeFileSync(sidecarPaths.summaryPath, markdown);

  const eventId = createEvent(db, {
    projectId,
    type: 'summary_generated',
    title: 'Summary refreshed',
    summary: 'Regenerated .sidecar/summary.md from local records',
    source: 'generated',
    createdBy: 'system',
    details: { limit, path: sidecarPaths.summaryPath },
  });

  return { path: sidecarPaths.summaryPath, eventId, generatedAt };
}
