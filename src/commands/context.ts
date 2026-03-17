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

export function runContext(format: OutputFormat = 'text'): void {
  const db = openDb(requireDbPath());

  const openTasks = db
    .prepare(`SELECT id, title, priority, updated_at FROM tasks WHERE status = 'open' ORDER BY updated_at DESC LIMIT 10`)
    .all() as Array<{ id: number; title: string; priority: string; updated_at: string }>;

  const recentEvents = db
    .prepare(`SELECT id, ts, type, title, body FROM events ORDER BY ts DESC LIMIT 12`)
    .all() as Array<{ id: number; ts: string; type: string; title: string; body: string }>;

  db.close();

  const payload = {
    generatedAt: new Date().toISOString(),
    openTasks,
    recentEvents,
  };

  if (format === 'json') {
    console.log(json(payload));
    return;
  }

  if (format === 'markdown') {
    const lines: string[] = [];
    lines.push('# Sidecar Context');
    lines.push(`Generated: ${payload.generatedAt}`);
    lines.push('');
    lines.push('## Open Tasks');
    if (openTasks.length === 0) {
      lines.push('- None');
    } else {
      for (const t of openTasks) {
        lines.push(`- [ ] #${t.id} (${t.priority}) ${t.title} _(${shortTime(t.updated_at)})_`);
      }
    }
    lines.push('');
    lines.push('## Recent Events');
    if (recentEvents.length === 0) {
      lines.push('- None');
    } else {
      for (const e of recentEvents) {
        lines.push(`- **${e.type}** #${e.id} ${e.title} (${shortTime(e.ts)})`);
      }
    }
    console.log(lines.join('\n'));
    return;
  }

  console.log('Sidecar Context');
  console.log(`Generated: ${payload.generatedAt}`);
  console.log('\nOpen Tasks:');
  if (openTasks.length === 0) {
    console.log('- none');
  } else {
    for (const t of openTasks) {
      console.log(`- #${t.id} (${t.priority}) ${t.title} [${shortTime(t.updated_at)}]`);
    }
  }

  console.log('\nRecent Events:');
  if (recentEvents.length === 0) {
    console.log('- none');
  } else {
    for (const e of recentEvents) {
      console.log(`- ${e.type} #${e.id}: ${e.title} [${shortTime(e.ts)}]`);
    }
  }
}
