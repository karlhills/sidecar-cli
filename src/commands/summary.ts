import { openDb } from '../lib/db.js';
import { findSidecarRoot, getPaths } from '../lib/paths.js';
import { json, shortTime } from '../lib/format.js';
import type { OutputFormat } from '../types.js';

function requireDbPath(): string {
  const root = findSidecarRoot();
  if (!root) {
    throw new Error('No .sidecar directory found. Run `sidecar init` first.');
  }
  return getPaths(root).dbPath;
}

export function runSummary(limit = 25, format: OutputFormat = 'text'): void {
  const db = openDb(requireDbPath());

  const recentEvents = db
    .prepare(`SELECT id, ts, type, title, body FROM events ORDER BY ts DESC LIMIT ?`)
    .all(limit) as Array<{ id: number; ts: string; type: string; title: string; body: string }>;

  const taskCounts = db
    .prepare(`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`)
    .all() as Array<{ status: 'open' | 'done'; count: number }>;

  db.close();

  const counts = {
    open: taskCounts.find((x) => x.status === 'open')?.count ?? 0,
    done: taskCounts.find((x) => x.status === 'done')?.count ?? 0,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    limit,
    taskCounts: counts,
    recentEvents,
  };

  if (format === 'json') {
    console.log(json(payload));
    return;
  }

  if (format === 'markdown') {
    const lines: string[] = [];
    lines.push('# Sidecar Summary');
    lines.push(`Generated: ${payload.generatedAt}`);
    lines.push(`Tasks: ${counts.open} open, ${counts.done} done`);
    lines.push('');
    lines.push('## Recent Activity');

    if (recentEvents.length === 0) {
      lines.push('- No events recorded yet.');
    } else {
      for (const e of recentEvents) {
        lines.push(`- **${e.type}** ${e.title} (${shortTime(e.ts)})`);
        lines.push(`  - ${e.body}`);
      }
    }

    console.log(lines.join('\n'));
    return;
  }

  console.log('Sidecar Summary');
  console.log(`Generated: ${payload.generatedAt}`);
  console.log(`Tasks: ${counts.open} open, ${counts.done} done`);
  console.log('\nRecent Activity:');

  if (recentEvents.length === 0) {
    console.log('- No events recorded yet.');
  } else {
    for (const e of recentEvents) {
      console.log(`- ${e.type} | ${e.title} | ${shortTime(e.ts)}`);
      console.log(`  ${e.body}`);
    }
  }
}
