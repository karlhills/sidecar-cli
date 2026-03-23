import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../lib/format.js';
import type { ActorType } from '../types/models.js';

export function currentSession(db: DatabaseSync, projectId: number) {
  return db
    .prepare(`SELECT * FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`)
    .get(projectId) as Record<string, unknown> | undefined;
}

export function startSession(db: DatabaseSync, input: { projectId: number; actor: ActorType; name?: string }) {
  const active = currentSession(db, input.projectId);
  if (active) return { ok: false as const, reason: 'A session is already active' };

  const info = db
    .prepare(`INSERT INTO sessions (project_id, started_at, ended_at, actor_type, actor_name, summary) VALUES (?, ?, NULL, ?, ?, NULL)`)
    .run(input.projectId, nowIso(), input.actor, input.name ?? null);

  return { ok: true as const, sessionId: Number(info.lastInsertRowid) };
}

export function endSession(db: DatabaseSync, input: { projectId: number; summary?: string }) {
  const active = currentSession(db, input.projectId) as { id: number } | undefined;
  if (!active) return { ok: false as const, reason: 'No active session found' };

  db.prepare(`UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?`).run(nowIso(), input.summary ?? null, active.id);
  return { ok: true as const, sessionId: active.id };
}

export function verifySessionHygiene(db: DatabaseSync, projectId: number, summaryRecentlyRefreshed: boolean) {
  const warnings: string[] = [];

  const active = currentSession(db, projectId) as { id: number } | undefined;
  if (active) {
    const worklog = db
      .prepare(`SELECT id FROM events WHERE project_id = ? AND type = 'worklog' AND session_id = ? LIMIT 1`)
      .get(projectId, active.id);
    if (!worklog) warnings.push('Active session has no worklog yet.');
  }

  const openTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND status = 'open'`).get(projectId) as { count: number };
  if (openTasks.count > 0 && !summaryRecentlyRefreshed) {
    warnings.push('Open tasks exist and summary was not refreshed recently.');
  }

  const recentWork = db
    .prepare(`SELECT COUNT(*) as count FROM events WHERE project_id = ? AND type = 'worklog' AND created_at >= datetime('now', '-3 day')`)
    .get(projectId) as { count: number };
  const recentDecisions = db
    .prepare(`SELECT COUNT(*) as count FROM events WHERE project_id = ? AND type = 'decision' AND created_at >= datetime('now', '-7 day')`)
    .get(projectId) as { count: number };
  if (recentWork.count > 0 && recentDecisions.count === 0) {
    warnings.push('Recent worklogs exist but no recent decision was recorded.');
  }

  return warnings;
}
