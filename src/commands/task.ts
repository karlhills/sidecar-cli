import chalk from 'chalk';
import { openDb } from '../lib/db.js';
import { nowIso, shortTime } from '../lib/format.js';
import { findSidecarRoot, getPaths } from '../lib/paths.js';
import { addTaskSchema, completeTaskSchema } from '../lib/validation.js';
import type { TaskRow } from '../types.js';

function requirePaths() {
  const root = findSidecarRoot();
  if (!root) {
    throw new Error('No .sidecar directory found. Run `sidecar init` first.');
  }
  return getPaths(root);
}

export function runTaskAdd(params: { title: string; priority: 'low' | 'medium' | 'high' }): void {
  const parsed = addTaskSchema.parse(params);
  const paths = requirePaths();
  const db = openDb(paths.dbPath);

  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO tasks (title, status, priority, created_at, updated_at) VALUES (?, 'open', ?, ?, ?)`
    )
    .run(parsed.title, parsed.priority, ts, ts);

  db.close();
  console.log(chalk.green(`Added task #${info.lastInsertRowid}: ${parsed.title}`));
}

export function runTaskDone(id: number): void {
  const parsed = completeTaskSchema.parse({ id });
  const paths = requirePaths();
  const db = openDb(paths.dbPath);

  const info = db
    .prepare(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ? AND status != 'done'`)
    .run(nowIso(), parsed.id);

  db.close();

  if (info.changes === 0) {
    console.log(chalk.yellow(`No open task found with id ${parsed.id}.`));
    return;
  }

  console.log(chalk.green(`Marked task #${parsed.id} as done.`));
}

export function runTaskList(status: 'open' | 'done' | 'all' = 'open'): void {
  const paths = requirePaths();
  const db = openDb(paths.dbPath);

  const rows: TaskRow[] =
    status === 'all'
      ? db
          .prepare(`SELECT id, title, status, priority, created_at, updated_at FROM tasks ORDER BY updated_at DESC`)
          .all() as TaskRow[]
      : db
          .prepare(
            `SELECT id, title, status, priority, created_at, updated_at FROM tasks WHERE status = ? ORDER BY updated_at DESC`
          )
          .all(status) as TaskRow[];

  db.close();

  if (rows.length === 0) {
    console.log(chalk.yellow('No tasks found.'));
    return;
  }

  for (const row of rows) {
    const badge = row.status === 'done' ? chalk.green('done') : chalk.blue('open');
    console.log(`#${row.id} [${badge}] (${row.priority}) ${row.title} — ${shortTime(row.updated_at)}`);
  }
}
