import chalk from 'chalk';
import { openDb } from '../lib/db.js';
import { findSidecarRoot, getPaths } from '../lib/paths.js';
import { addEventSchema } from '../lib/validation.js';
import { nowIso } from '../lib/format.js';
import type { EventType } from '../types.js';

export function runRecord(params: {
  type: EventType;
  title: string;
  body: string;
  tags: string[];
}): void {
  const root = findSidecarRoot();
  if (!root) {
    throw new Error('No .sidecar directory found. Run `sidecar init` first.');
  }

  const parsed = addEventSchema.parse(params);
  const paths = getPaths(root);
  const db = openDb(paths.dbPath);

  const stmt = db.prepare(
    `INSERT INTO events (ts, type, title, body, tags_json) VALUES (?, ?, ?, ?, ?)`
  );

  const info = stmt.run(
    nowIso(),
    parsed.type,
    parsed.title,
    parsed.body,
    JSON.stringify(parsed.tags)
  );
  db.close();

  console.log(chalk.green(`Recorded ${parsed.type} event #${info.lastInsertRowid}.`));
}
