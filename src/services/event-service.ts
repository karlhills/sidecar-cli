import type Database from 'better-sqlite3';
import path from 'node:path';
import { z } from 'zod';
import { nowIso, splitCsv } from '../lib/format.js';
import type { ActorType, CreatedByType, EventSource, EventType } from '../types/models.js';

const createdBySchema = z.enum(['human', 'agent', 'system']);

function normalizeArtifactPath(inputPath: string): string {
  const normalized = path.normalize(inputPath.trim()).replaceAll('\\', '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

export function getActiveSessionId(db: Database.Database, projectId: number): number | null {
  const row = db
    .prepare(`SELECT id FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`)
    .get(projectId) as { id: number } | undefined;
  return row?.id ?? null;
}

export function createEvent(db: Database.Database, input: {
  projectId: number;
  type: EventType;
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  createdBy?: CreatedByType;
  source?: EventSource;
  sessionId?: number | null;
}): number {
  const createdBy = createdBySchema.parse(input.createdBy ?? 'human');
  const source = input.source ?? 'cli';

  const info = db
    .prepare(`
      INSERT INTO events (project_id, type, title, summary, details_json, created_at, created_by, source, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.projectId,
      input.type,
      input.title,
      input.summary,
      JSON.stringify(input.details ?? {}),
      nowIso(),
      createdBy,
      source,
      input.sessionId ?? null
    );

  return Number(info.lastInsertRowid);
}

export function addNote(db: Database.Database, input: {
  projectId: number;
  text: string;
  title?: string;
  by?: ActorType;
  sessionId?: number | null;
}): number {
  const title = input.title?.trim() || 'Note';
  return createEvent(db, {
    projectId: input.projectId,
    type: 'note',
    title,
    summary: input.text,
    details: { text: input.text },
    createdBy: input.by,
    sessionId: input.sessionId,
  });
}

export function addDecision(db: Database.Database, input: {
  projectId: number;
  title: string;
  summary: string;
  details?: string;
  by?: ActorType;
  sessionId?: number | null;
}): number {
  return createEvent(db, {
    projectId: input.projectId,
    type: 'decision',
    title: input.title,
    summary: input.summary,
    details: { details: input.details ?? null },
    createdBy: input.by,
    sessionId: input.sessionId,
  });
}

export function addWorklog(db: Database.Database, input: {
  projectId: number;
  goal?: string;
  done: string;
  files?: string;
  risks?: string;
  next?: string;
  by?: ActorType;
  sessionId?: number | null;
}): { eventId: number; files: string[] } {
  const files = Array.from(new Set(splitCsv(input.files).map(normalizeArtifactPath).filter(Boolean)));
  const goal = input.goal?.trim();
  const done = input.done.trim();
  const risks = input.risks?.trim() || null;
  const next = input.next?.trim() || null;
  const title = goal ? `Worklog: ${goal}` : 'Worklog entry';
  const eventId = createEvent(db, {
    projectId: input.projectId,
    type: 'worklog',
    title,
    summary: done,
    details: {
      goal: goal ?? null,
      done,
      files,
      risks,
      next,
    },
    createdBy: input.by,
    sessionId: input.sessionId,
  });

  return { eventId, files };
}

export function listRecentEvents(db: Database.Database, input: {
  projectId: number;
  type?: string;
  limit: number;
}) {
  if (input.type) {
    return db
      .prepare(`SELECT id, type, title, summary, created_by, created_at FROM events WHERE project_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?`)
      .all(input.projectId, input.type, input.limit);
  }
  return db
    .prepare(`SELECT id, type, title, summary, created_by, created_at FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(input.projectId, input.limit);
}
