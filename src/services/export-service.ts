import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { JSON_CONTRACT_VERSION } from '../lib/output.js';
import type { ApiArtifact, ApiEvent, ApiPreferences, ApiTask } from '../types/api.js';

export type ExportFormat = 'json' | 'jsonl';

export interface JsonExportPayload {
  version: string;
  project: Record<string, unknown> | undefined;
  preferences: ApiPreferences | null;
  sessions: Array<Record<string, unknown>>;
  tasks: ApiTask[];
  artifacts: ApiArtifact[];
  events: ApiEvent[];
}

export function buildExportJson(db: DatabaseSync, input: {
  projectId: number;
  rootPath: string;
  limit?: number;
  type?: string;
  since?: string;
  until?: string;
}): JsonExportPayload {
  const project = db.prepare('SELECT id, name, root_path, created_at, updated_at FROM projects WHERE id = ?').get(input.projectId) as
    | Record<string, unknown>
    | undefined;

  const preferencesPath = path.join(input.rootPath, '.sidecar', 'preferences.json');
  const preferences = fs.existsSync(preferencesPath)
    ? JSON.parse(fs.readFileSync(preferencesPath, 'utf8'))
    : null;

  const sessions = db
    .prepare('SELECT id, project_id, started_at, ended_at, actor_type, actor_name, summary FROM sessions WHERE project_id = ? ORDER BY started_at DESC')
    .all(input.projectId);

  const tasks = db
    .prepare(`SELECT id, project_id, title, description, status, priority, created_at, updated_at, closed_at, origin_event_id FROM tasks WHERE project_id = ? ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC`)
    .all(input.projectId);

  const artifacts = db
    .prepare('SELECT id, project_id, path, kind, note, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC')
    .all(input.projectId);

  const eventWhere = ['project_id = ?'];
  const eventArgs: unknown[] = [input.projectId];

  if (input.type) {
    eventWhere.push('type = ?');
    eventArgs.push(input.type);
  }
  if (input.since) {
    eventWhere.push('created_at >= ?');
    eventArgs.push(input.since);
  }
  if (input.until) {
    eventWhere.push('created_at <= ?');
    eventArgs.push(input.until);
  }

  const limitClause = input.limit && input.limit > 0 ? ` LIMIT ${Math.floor(input.limit)}` : '';
  const events = db
    .prepare(
      `SELECT id, project_id, type, title, summary, details_json, created_at, created_by, source, session_id
       FROM events
       WHERE ${eventWhere.join(' AND ')}
       ORDER BY created_at DESC${limitClause}`
    )
    .all(...(eventArgs as Array<string | number | null>)) as unknown as ApiEvent[];

  return {
    version: JSON_CONTRACT_VERSION,
    project,
    preferences: preferences as ApiPreferences | null,
    sessions: sessions as Array<Record<string, unknown>>,
    tasks: tasks as unknown as ApiTask[],
    artifacts: artifacts as unknown as ApiArtifact[],
    events,
  };
}

export function buildExportJsonlEvents(db: DatabaseSync, input: {
  projectId: number;
  limit?: number;
  type?: string;
  since?: string;
  until?: string;
}) {
  const where = ['project_id = ?'];
  const args: unknown[] = [input.projectId];

  if (input.type) {
    where.push('type = ?');
    args.push(input.type);
  }
  if (input.since) {
    where.push('created_at >= ?');
    args.push(input.since);
  }
  if (input.until) {
    where.push('created_at <= ?');
    args.push(input.until);
  }

  const limitClause = input.limit && input.limit > 0 ? ` LIMIT ${Math.floor(input.limit)}` : '';
  const rows = db
    .prepare(
      `SELECT id, project_id, type, title, summary, details_json, created_at, created_by, source, session_id
       FROM events
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC${limitClause}`
    )
    .all(...(args as Array<string | number | null>)) as Array<Record<string, unknown>>;

  return rows.map((row) => JSON.stringify({ version: JSON_CONTRACT_VERSION, record_type: 'event', project_id: row.project_id, data: row }));
}

export function writeOutputFile(outputPath: string, content: string) {
  const abs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
