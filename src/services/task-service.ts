import { nowIso } from '../lib/format.js';
import type { DatabaseSync } from 'node:sqlite';
import { createEvent } from './event-service.js';
import type { ActorType, TaskPriority } from '../types/models.js';

export function addTask(db: DatabaseSync, input: {
  projectId: number;
  title: string;
  description?: string;
  priority?: TaskPriority;
  by?: ActorType;
}) {
  const ts = nowIso();
  const info = db
    .prepare(`
      INSERT INTO tasks (project_id, title, description, status, priority, created_at, updated_at, closed_at, origin_event_id)
      VALUES (?, ?, ?, 'open', ?, ?, ?, NULL, NULL)
    `)
    .run(input.projectId, input.title, input.description ?? null, input.priority ?? 'medium', ts, ts);

  const taskId = Number(info.lastInsertRowid);
  const eventId = createEvent(db, {
    projectId: input.projectId,
    type: 'task_created',
    title: `Task #${taskId} created`,
    summary: input.title,
    details: { taskId, description: input.description ?? null, priority: input.priority ?? 'medium' },
    createdBy: input.by,
  });

  db.prepare(`UPDATE tasks SET origin_event_id = ? WHERE id = ?`).run(eventId, taskId);
  return { taskId, eventId };
}

export function markTaskDone(db: DatabaseSync, input: { projectId: number; taskId: number; by?: ActorType }) {
  const existing = db
    .prepare(`SELECT id, title, status FROM tasks WHERE project_id = ? AND id = ?`)
    .get(input.projectId, input.taskId) as { id: number; title: string; status: string } | undefined;

  if (!existing) {
    return { ok: false as const, reason: 'Task not found' };
  }

  if (existing.status === 'done') {
    return { ok: false as const, reason: 'Task is already done' };
  }

  const ts = nowIso();
  db.prepare(`UPDATE tasks SET status = 'done', updated_at = ?, closed_at = ? WHERE id = ?`).run(ts, ts, input.taskId);

  const eventId = createEvent(db, {
    projectId: input.projectId,
    type: 'task_completed',
    title: `Task #${input.taskId} completed`,
    summary: existing.title,
    details: { taskId: input.taskId },
    createdBy: input.by,
  });

  return { ok: true as const, eventId };
}

export function listTasks(db: DatabaseSync, input: { projectId: number; status: 'open' | 'done' | 'all' }) {
  if (input.status === 'all') {
    return db
      .prepare(
        `SELECT * FROM tasks WHERE project_id = ? ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC`
      )
      .all(input.projectId);
  }
  return db
    .prepare(`SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY updated_at DESC`)
    .all(input.projectId, input.status);
}
