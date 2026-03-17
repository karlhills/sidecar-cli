#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { initializeSchema } from './db/schema.js';
import { getSidecarPaths } from './lib/paths.js';
import { nowIso, humanTime, stringifyJson } from './lib/format.js';
import { SidecarError } from './lib/errors.js';
import { jsonFailure, jsonSuccess, printJsonEnvelope } from './lib/output.js';
import { bannerDisabled, renderBanner } from './lib/banner.js';
import { getUpdateNotice } from './lib/update-check.js';
import { requireInitialized } from './db/client.js';
import { renderAgentsMarkdown } from './templates/agents.js';
import { refreshSummaryFile } from './services/summary-service.js';
import { buildContext } from './services/context-service.js';
import { getCapabilitiesManifest } from './services/capabilities-service.js';
import { addArtifact, listArtifacts } from './services/artifact-service.js';
import { addDecision, addNote, addWorklog, getActiveSessionId, listRecentEvents } from './services/event-service.js';
import { addTask, listTasks, markTaskDone } from './services/task-service.js';
import { currentSession, endSession, startSession, verifySessionHygiene } from './services/session-service.js';
import type { ActorType, ArtifactKind, SidecarConfig, TaskPriority } from './types/models.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const actorSchema = z.enum(['human', 'agent']);
const taskPrioritySchema = z.enum(['low', 'medium', 'high']);
const artifactKindSchema = z.enum(['file', 'doc', 'screenshot', 'other']);
const taskStatusSchema = z.enum(['open', 'done', 'all']);

const NOT_INITIALIZED_MSG = 'Sidecar is not initialized in this directory or any parent directory';

function fail(message: string): never {
  throw new SidecarError(message);
}

function maybeSessionId(db: Database.Database, projectId: number, explicit?: string): number | null {
  if (explicit) {
    const parsed = Number.parseInt(explicit, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new SidecarError('Session id must be a positive integer');
    }
    return parsed;
  }
  return getActiveSessionId(db, projectId);
}

function handleCommandError(command: string, asJson: boolean, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (asJson) {
    printJsonEnvelope(jsonFailure(command, message));
  } else {
    console.error(message);
  }
  process.exit(err instanceof SidecarError ? err.exitCode : 1);
}

function respondSuccess(command: string, asJson: boolean, data: unknown, lines: string[] = []): void {
  if (asJson) {
    printJsonEnvelope(jsonSuccess(command, data));
    return;
  }
  for (const line of lines) {
    console.log(line);
  }
}

function summaryWasRefreshedRecently(db: Database.Database, projectId: number): boolean {
  return Boolean(
    db
      .prepare(`SELECT id FROM events WHERE project_id = ? AND type = 'summary_generated' AND created_at >= datetime('now', '-3 day') LIMIT 1`)
      .get(projectId)
  );
}

function renderSessionHygiene(command: string, asJson: boolean, warnings: string[]): void {
  if (asJson) {
    printJsonEnvelope(jsonSuccess(command, { warnings, healthy: warnings.length === 0 }));
    return;
  }
  if (warnings.length === 0) {
    console.log('Session hygiene looks good.');
    return;
  }
  console.log('Session hygiene warnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

function renderContextText(data: ReturnType<typeof buildContext>): string {
  const lines: string[] = [];
  lines.push(`Project: ${data.projectName}`);
  lines.push(`Path: ${data.projectPath}`);
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push(
    `Active session: ${
      data.activeSession
        ? `#${data.activeSession.id} (${data.activeSession.actor_type}${
            data.activeSession.actor_name ? `: ${data.activeSession.actor_name}` : ''
          })`
        : 'none'
    }`
  );
  lines.push('');
  lines.push('Recent decisions');
  if (data.recentDecisions.length === 0) lines.push('- none');
  for (const item of data.recentDecisions as Array<{ created_at: string; title: string; summary: string }>) {
    lines.push(`- ${humanTime(item.created_at)} | ${item.title}: ${item.summary}`);
  }
  lines.push('');
  lines.push('Recent worklogs');
  if (data.recentWorklogs.length === 0) lines.push('- none');
  for (const item of data.recentWorklogs as Array<{ created_at: string; title: string; summary: string }>) {
    lines.push(`- ${humanTime(item.created_at)} | ${item.title}: ${item.summary}`);
  }
  lines.push('');
  lines.push('Open tasks');
  if (data.openTasks.length === 0) lines.push('- none');
  for (const task of data.openTasks as Array<{ id: number; title: string; priority: string | null; updated_at: string }>) {
    lines.push(`- #${task.id} [${task.priority ?? 'n/a'}] ${task.title}`);
  }
  lines.push('');
  lines.push('Recent notes');
  if (data.notableNotes.length === 0) lines.push('- none');
  for (const item of data.notableNotes as Array<{ created_at: string; title: string; summary: string }>) {
    lines.push(`- ${humanTime(item.created_at)} | ${item.title}: ${item.summary}`);
  }
  return lines.join('\n');
}

function renderContextMarkdown(data: ReturnType<typeof buildContext>): string {
  const lines: string[] = [];
  lines.push('# Sidecar Context');
  lines.push(`Project: ${data.projectName}`);
  lines.push(`Path: ${data.projectPath}`);
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push('');
  lines.push('## Active Session');
  if (!data.activeSession) {
    lines.push('- None');
  } else {
    lines.push(
      `- #${data.activeSession.id} (${data.activeSession.actor_type}${
        data.activeSession.actor_name ? `: ${data.activeSession.actor_name}` : ''
      }) started ${data.activeSession.started_at}`
    );
  }
  lines.push('');
  lines.push('## Recent Decisions');
  if (data.recentDecisions.length === 0) lines.push('- None');
  for (const item of data.recentDecisions as Array<{ created_at: string; title: string; summary: string }>) {
    lines.push(`- ${item.created_at} | **${item.title}**: ${item.summary}`);
  }
  lines.push('');
  lines.push('## Recent Worklogs');
  if (data.recentWorklogs.length === 0) lines.push('- None');
  for (const item of data.recentWorklogs as Array<{ created_at: string; title: string; summary: string }>) {
    lines.push(`- ${item.created_at} | **${item.title}**: ${item.summary}`);
  }
  lines.push('');
  lines.push('## Open Tasks');
  if (data.openTasks.length === 0) lines.push('- None');
  for (const task of data.openTasks as Array<{ id: number; title: string; priority: string | null }>) {
    lines.push(`- [ ] #${task.id} (${task.priority ?? 'n/a'}) ${task.title}`);
  }
  lines.push('');
  lines.push('## Recent Notes');
  if (data.notableNotes.length === 0) lines.push('- None');
  for (const item of data.notableNotes as Array<{ created_at: string; title: string; summary: string }>) {
    lines.push(`- ${item.created_at} | **${item.title}**: ${item.summary}`);
  }
  lines.push('');
  lines.push('## Recent Artifacts');
  if (data.recentArtifacts.length === 0) lines.push('- None');
  for (const art of data.recentArtifacts as Array<{ path: string; kind: string; note: string | null }>) {
    lines.push(`- ${art.kind}: ${art.path}${art.note ? ` - ${art.note}` : ''}`);
  }
  return lines.join('\n');
}

const program = new Command();
program.name('sidecar').description('Local-first project memory and recording CLI').version(pkg.version);
program.option('--no-banner', 'Disable Sidecar banner output');

function maybePrintUpdateNotice(): void {
  const jsonRequested = process.argv.includes('--json');
  const notice = getUpdateNotice({
    packageName: 'sidecar-cli',
    currentVersion: pkg.version,
    skip: jsonRequested,
  });
  if (!notice) return;

  const installTag = notice.channel === 'latest' ? 'latest' : notice.channel;
  console.log('');
  console.log(`Update available: ${pkg.version} -> ${notice.latestVersion}`);
  console.log(`Run: npm install -g sidecar-cli@${installTag}`);
}

program
  .command('init')
  .description('Initialize Sidecar in the current directory')
  .option('--force', 'Overwrite Sidecar files if they already exist')
  .option('--name <project-name>', 'Project name (defaults to current directory name)')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar init\n  $ sidecar init --name "My Project"\n  $ sidecar init --force --json'
  )
  .action((opts) => {
    const command = 'init';
    try {
      const rootPath = process.cwd();
      const sidecar = getSidecarPaths(rootPath);
      const projectName = opts.name?.trim() || path.basename(rootPath);
      if (fs.existsSync(sidecar.sidecarPath)) {
        const stat = fs.lstatSync(sidecar.sidecarPath);
        if (stat.isSymbolicLink()) {
          fail('Refusing to initialize: .sidecar is a symbolic link. Remove it and run init again.');
        }
        if (!stat.isDirectory()) {
          fail('Refusing to initialize: .sidecar exists but is not a directory.');
        }
      }

      if (fs.existsSync(sidecar.sidecarPath) && !opts.force) {
        fail('Sidecar is already initialized in this project. Re-run with --force to recreate .sidecar files.');
      }

      const files = [
        sidecar.dbPath,
        sidecar.configPath,
        sidecar.preferencesPath,
        sidecar.agentsPath,
        sidecar.summaryPath,
      ];

      fs.mkdirSync(sidecar.sidecarPath, { recursive: true });
      if (opts.force) {
        for (const file of [
          sidecar.dbPath,
          `${sidecar.dbPath}-wal`,
          `${sidecar.dbPath}-shm`,
          sidecar.configPath,
          sidecar.preferencesPath,
          sidecar.agentsPath,
          sidecar.summaryPath,
        ]) {
          if (fs.existsSync(file)) fs.rmSync(file);
        }
      }

      const db = new Database(sidecar.dbPath);
      initializeSchema(db);
      const ts = nowIso();
      db.prepare(`DELETE FROM projects`).run();
      db.prepare(`INSERT INTO projects (name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(projectName, rootPath, ts, ts);
      db.close();

      const config: SidecarConfig = {
        schemaVersion: 1,
        project: { name: projectName, rootPath, createdAt: ts },
        defaults: { summary: { recentLimit: 10 } },
        settings: {},
      };

      fs.writeFileSync(sidecar.configPath, stringifyJson(config));
      fs.writeFileSync(
        sidecar.preferencesPath,
        stringifyJson({
          summary: { format: 'markdown', recentLimit: 8 },
          output: { humanTime: true },
        })
      );
      fs.writeFileSync(sidecar.agentsPath, renderAgentsMarkdown(projectName));

      const db2 = new Database(sidecar.dbPath);
      const refreshed = refreshSummaryFile(db2, rootPath, 1, 10);
      db2.close();

      const data = {
        rootPath,
        sidecarPath: sidecar.sidecarPath,
        projectName,
        filesCreated: files,
        summaryGeneratedAt: refreshed.generatedAt,
        timestamp: nowIso(),
      };

      const shouldShowBanner = !opts.json && !bannerDisabled();
      if (shouldShowBanner) {
        console.log(renderBanner());
        console.log('');
      }
      respondSuccess(command, Boolean(opts.json), data, [
        `Initialized Sidecar for project: ${projectName}`,
        'Sidecar provides local project memory for decisions, work logs, tasks, and summaries.',
        'Created:',
        ...data.filesCreated.map((f) => `- ${f}`),
        '',
        'Next step:',
        'sidecar context',
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('status')
  .description('Show Sidecar status and recent project activity')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar status\n  $ sidecar status --json')
  .action((opts) => {
    const command = 'status';
    try {
      const { db, projectId } = requireInitialized();
      const project = db.prepare(`SELECT name, root_path, created_at FROM projects WHERE id = ?`).get(projectId);
      const counts = {
        events: (db.prepare(`SELECT COUNT(*) as count FROM events WHERE project_id = ?`).get(projectId) as { count: number }).count,
        tasks: (db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE project_id = ?`).get(projectId) as { count: number }).count,
        sessions: (db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE project_id = ?`).get(projectId) as { count: number }).count,
      };
      const recent = db.prepare(`SELECT type, title, created_at FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT 5`).all(projectId);
      db.close();

      const data = { initialized: true, project, counts, recent };
      respondSuccess(command, Boolean(opts.json), data, [
        `Project: ${(project as { name: string }).name}`,
        `Root: ${(project as { root_path: string }).root_path}`,
        `Counts: events=${counts.events}, tasks=${counts.tasks}, sessions=${counts.sessions}`,
        'Recent activity:',
        ...(recent as Array<{ type: string; title: string; created_at: string }>).map(
          (r) => `- ${humanTime(r.created_at)} | ${r.type} | ${r.title}`
        ),
      ]);
    } catch (err) {
      const normalized =
        err instanceof SidecarError && err.code === 'NOT_INITIALIZED'
          ? new SidecarError(NOT_INITIALIZED_MSG, err.code, err.exitCode)
          : err;
      handleCommandError(command, Boolean(opts.json), normalized);
    }
  });

program
  .command('capabilities')
  .description('Output a machine-readable manifest of Sidecar commands')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar capabilities --json')
  .action((opts) => {
    const command = 'capabilities';
    const manifest = getCapabilitiesManifest(pkg.version);
    if (opts.json) printJsonEnvelope(jsonSuccess(command, manifest));
    else console.log(stringifyJson(manifest));
  });

program
  .command('context')
  .description('Generate a compact context snapshot for a work session')
  .option('--limit <n>', 'Item limit per section', (v) => Number.parseInt(v, 10), 8)
  .option('--format <format>', 'text|markdown|json', 'text')
  .option('--json', 'Wrap output in standard JSON envelope')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar context\n  $ sidecar context --format markdown\n  $ sidecar context --format json --json'
  )
  .action((opts) => {
    const command = 'context';
    try {
      const { db, projectId } = requireInitialized();
      const limit = Math.max(1, opts.limit);
      const data = buildContext(db, { projectId, limit });
      db.close();

      if (opts.format === 'json') {
        if (opts.json) printJsonEnvelope(jsonSuccess(command, data));
        else console.log(stringifyJson(data));
        return;
      }

      const rendered = opts.format === 'markdown' ? renderContextMarkdown(data) : renderContextText(data);
      if (opts.json) printJsonEnvelope(jsonSuccess(command, { format: opts.format, content: rendered }));
      else console.log(rendered);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const summary = program.command('summary').description('Summary operations');
summary
  .command('refresh')
  .description('Regenerate .sidecar/summary.md from local records')
  .option('--limit <n>', 'Item limit per section', (v) => Number.parseInt(v, 10), 8)
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar summary refresh\n  $ sidecar summary refresh --limit 5 --json')
  .action((opts) => {
    const command = 'summary refresh';
    try {
      const { db, projectId, rootPath } = requireInitialized();
      const out = refreshSummaryFile(db, rootPath, projectId, Math.max(1, opts.limit));
      db.close();

      respondSuccess(command, Boolean(opts.json), { ...out, timestamp: nowIso() }, ['Summary refreshed.', `Path: ${out.path}`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('recent')
  .description('Show recent events in timeline order')
  .option('--type <event-type>', 'Filter by event type')
  .option('--limit <n>', 'Number of rows', (v) => Number.parseInt(v, 10), 20)
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar recent\n  $ sidecar recent --type decision --limit 10')
  .action((opts) => {
    const command = 'recent';
    try {
      const { db, projectId } = requireInitialized();
      const rows = listRecentEvents(db, { projectId, type: opts.type, limit: Math.max(1, opts.limit) });
      db.close();
      if (opts.json) printJsonEnvelope(jsonSuccess(command, rows));
      else {
        if ((rows as unknown[]).length === 0) {
          console.log('No events found.');
          return;
        }
        for (const row of rows as Array<{ id: number; type: string; title: string; summary: string; created_at: string }>) {
          console.log(`#${row.id} ${humanTime(row.created_at)} | ${row.type} | ${row.title}`);
          console.log(`  ${row.summary}`);
        }
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('note <text>')
  .description('Record a freeform note event')
  .option('--title <title>', 'Optional title')
  .option('--by <actor>', 'human|agent', 'human')
  .option('--session <session-id>', 'Session id override')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar note "Need to revisit parser edge cases"\n  $ sidecar note "UI flaky" --title "Test note" --by agent')
  .action((text, opts) => {
    const command = 'note';
    try {
      const by = actorSchema.parse(opts.by as ActorType);
      const { db, projectId } = requireInitialized();
      const sessionId = maybeSessionId(db, projectId, opts.session);
      const eventId = addNote(db, { projectId, text, title: opts.title, by, sessionId });
      db.close();
      respondSuccess(command, Boolean(opts.json), { eventId, timestamp: nowIso() }, [`Recorded note event #${eventId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const decision = program.command('decision').description('Decision commands');
decision
  .command('record')
  .description('Record a project decision')
  .requiredOption('--title <title>', 'Decision title')
  .requiredOption('--summary <summary>', 'Decision summary')
  .option('--details <details>', 'Optional details')
  .option('--by <actor>', 'human|agent', 'human')
  .option('--session <session-id>', 'Session id override')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar decision record --title "Use SQLite" --summary "Local-first storage"\n  $ sidecar decision record --title "Auth strategy" --summary "No auth in v1" --by agent'
  )
  .action((opts) => {
    const command = 'decision record';
    try {
      const by = actorSchema.parse(opts.by as ActorType);
      const { db, projectId } = requireInitialized();
      const sessionId = maybeSessionId(db, projectId, opts.session);
      const eventId = addDecision(db, { projectId, title: opts.title, summary: opts.summary, details: opts.details, by, sessionId });
      db.close();
      respondSuccess(command, Boolean(opts.json), { eventId, timestamp: nowIso() }, [`Recorded decision event #${eventId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const worklog = program.command('worklog').description('Worklog commands');
worklog
  .command('record')
  .description('Record completed work and related metadata')
  .option('--goal <goal>', 'Goal worked on')
  .requiredOption('--done <done-summary>', 'What was completed')
  .option('--files <comma-separated-paths>', 'Changed files')
  .option('--risks <text>', 'Risks')
  .option('--next <text>', 'Next step')
  .option('--by <actor>', 'human|agent', 'human')
  .option('--session <session-id>', 'Session id override')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar worklog record --done "Implemented context output"\n  $ sidecar worklog record --goal "Refactor" --done "Moved formatter logic" --files src/cli.ts,src/lib/format.ts --by agent'
  )
  .action((opts) => {
    const command = 'worklog record';
    try {
      const by = actorSchema.parse(opts.by as ActorType);
      const { db, projectId } = requireInitialized();
      const sessionId = maybeSessionId(db, projectId, opts.session);
      const result = addWorklog(db, {
        projectId,
        goal: opts.goal,
        done: opts.done,
        files: opts.files,
        risks: opts.risks,
        next: opts.next,
        by,
        sessionId,
      });

      for (const filePath of result.files) {
        addArtifact(db, { projectId, path: filePath, kind: 'file' });
      }

      db.close();
      respondSuccess(command, Boolean(opts.json), { ...result, timestamp: nowIso() }, [
        `Recorded worklog event #${result.eventId}.`,
        `Artifacts linked: ${result.files.length}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const task = program.command('task').description('Task commands');
task
  .command('add <title>')
  .description('Create an open task')
  .option('--description <text>', 'Description')
  .option('--priority <priority>', 'low|medium|high', 'medium')
  .option('--by <actor>', 'human|agent', 'human')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar task add "Ship v0.1"\n  $ sidecar task add "Add tests" --priority high --by agent')
  .action((title, opts) => {
    const command = 'task add';
    try {
      const priority = taskPrioritySchema.parse(opts.priority as TaskPriority);
      const by = actorSchema.parse(opts.by as ActorType);
      const { db, projectId } = requireInitialized();
      const result = addTask(db, { projectId, title, description: opts.description, priority, by });
      db.close();
      respondSuccess(command, Boolean(opts.json), { ...result, timestamp: nowIso() }, [`Added task #${result.taskId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

task
  .command('done <task-id>')
  .description('Mark a task as done')
  .option('--by <actor>', 'human|agent', 'human')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar task done 3\n  $ sidecar task done 3 --json')
  .action((taskIdText, opts) => {
    const command = 'task done';
    try {
      const taskId = Number.parseInt(taskIdText, 10);
      if (!Number.isInteger(taskId) || taskId <= 0) fail('Task id must be a positive integer');
      const by = actorSchema.parse(opts.by as ActorType);
      const { db, projectId } = requireInitialized();
      const result = markTaskDone(db, { projectId, taskId, by });
      db.close();
      if (!result.ok) fail(result.reason);
      respondSuccess(command, Boolean(opts.json), { taskId, eventId: result.eventId, timestamp: nowIso() }, [`Completed task #${taskId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

task
  .command('list')
  .description('List tasks by status')
  .option('--status <status>', 'open|done|all', 'open')
  .option('--format <format>', 'table|json', 'table')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar task list\n  $ sidecar task list --status all --format json')
  .action((opts) => {
    const command = 'task list';
    try {
      const status = taskStatusSchema.parse(opts.status as 'open' | 'done' | 'all');
      const { db, projectId } = requireInitialized();
      const rows = listTasks(db, { projectId, status });
      db.close();

      if (opts.format === 'json' || opts.json) {
        if (opts.json) printJsonEnvelope(jsonSuccess(command, rows));
        else console.log(stringifyJson(rows));
        return;
      }

      const taskRows = rows as Array<{ id: number; status: string; priority: string | null; title: string; updated_at: string }>;
      if (taskRows.length === 0) {
        console.log('No tasks found.');
        return;
      }
      const idWidth = Math.max(2, ...taskRows.map((r) => String(r.id).length));
      const statusWidth = Math.max(6, ...taskRows.map((r) => r.status.length));
      const priorityWidth = Math.max(8, ...taskRows.map((r) => (r.priority ?? 'n/a').length));
      console.log(
        `${'ID'.padEnd(idWidth)}  ${'STATUS'.padEnd(statusWidth)}  ${'PRIORITY'.padEnd(priorityWidth)}  TITLE`
      );
      for (const row of taskRows) {
        const id = String(row.id).padEnd(idWidth);
        const statusLabel = row.status.padEnd(statusWidth);
        const prio = (row.priority ?? 'n/a').padEnd(priorityWidth);
        console.log(`${id}  ${statusLabel}  ${prio}  ${row.title}`);
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const session = program.command('session').description('Session commands');
session
  .command('start')
  .description('Start a new work session')
  .option('--actor <actor>', 'human|agent', 'human')
  .option('--name <actor-name>', 'Actor name')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar session start --actor agent --name codex')
  .action((opts) => {
    const command = 'session start';
    try {
      const actor = actorSchema.parse(opts.actor as ActorType);
      const { db, projectId } = requireInitialized();
      const result = startSession(db, { projectId, actor, name: opts.name });
      db.close();
      if (!result.ok) fail(result.reason);
      respondSuccess(command, Boolean(opts.json), { ...result, timestamp: nowIso() }, [`Started session #${result.sessionId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

session
  .command('end')
  .description('End the current active session')
  .option('--summary <text>', 'Session summary')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar session end --summary "Completed migration"')
  .action((opts) => {
    const command = 'session end';
    try {
      const { db, projectId } = requireInitialized();
      const result = endSession(db, { projectId, summary: opts.summary });
      db.close();
      if (!result.ok) fail(result.reason);
      respondSuccess(command, Boolean(opts.json), { ...result, timestamp: nowIso() }, [`Ended session #${result.sessionId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

session
  .command('current')
  .description('Show the current active session')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar session current\n  $ sidecar session current --json')
  .action((opts) => {
    const command = 'session current';
    try {
      const { db, projectId } = requireInitialized();
      const current = currentSession(db, projectId);
      db.close();
      if (opts.json) printJsonEnvelope(jsonSuccess(command, { current: current ?? null }));
      else if (!current) {
        console.log('No active session.');
      } else {
        const session = current as { id: number; actor_type: string; actor_name: string | null; started_at: string };
        console.log(`Session #${session.id}`);
        console.log(`Actor: ${session.actor_type}${session.actor_name ? ` (${session.actor_name})` : ''}`);
        console.log(`Started: ${humanTime(session.started_at)}`);
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

session
  .command('verify')
  .description('Run lightweight hygiene checks for the current project')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar session verify\n  $ sidecar session verify --json')
  .action((opts) => {
    const command = 'session verify';
    try {
      const { db, projectId } = requireInitialized();
      const warnings = verifySessionHygiene(db, projectId, summaryWasRefreshedRecently(db, projectId));
      db.close();
      renderSessionHygiene(command, Boolean(opts.json), warnings);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('doctor')
  .description('Alias for `sidecar session verify`')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar doctor')
  .action((opts) => {
    const command = 'doctor';
    try {
      const { db, projectId } = requireInitialized();
      const warnings = verifySessionHygiene(db, projectId, summaryWasRefreshedRecently(db, projectId));
      db.close();
      renderSessionHygiene(command, Boolean(opts.json), warnings);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const artifact = program.command('artifact').description('Artifact commands');
artifact
  .command('add <path>')
  .description('Attach an artifact reference')
  .option('--kind <kind>', 'file|doc|screenshot|other', 'file')
  .option('--note <text>', 'Optional note')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar artifact add README.md --kind doc --note "Product spec"')
  .action((artifactPath, opts) => {
    const command = 'artifact add';
    try {
      const kind = artifactKindSchema.parse(opts.kind as ArtifactKind);
      const { db, projectId } = requireInitialized();
      const artifactId = addArtifact(db, { projectId, path: artifactPath, kind, note: opts.note });
      db.close();
      respondSuccess(command, Boolean(opts.json), { artifactId, timestamp: nowIso() }, [`Added artifact #${artifactId}.`]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

artifact
  .command('list')
  .description('List recent artifact references')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar artifact list\n  $ sidecar artifact list --json')
  .action((opts) => {
    const command = 'artifact list';
    try {
      const { db, projectId } = requireInitialized();
      const rows = listArtifacts(db, projectId);
      db.close();
      if (opts.json) printJsonEnvelope(jsonSuccess(command, rows));
      else {
        if ((rows as unknown[]).length === 0) {
          console.log('No artifacts found.');
          return;
        }
        for (const row of rows as Array<{ id: number; path: string; kind: string; note: string | null; created_at: string }>) {
          console.log(`#${row.id} ${row.kind} ${row.path}${row.note ? ` - ${row.note}` : ''}`);
        }
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

if (process.argv.length === 2) {
  if (!bannerDisabled()) {
    console.log(renderBanner());
    console.log('');
  }
  program.outputHelp();
  maybePrintUpdateNotice();
  process.exit(0);
}

program.parse(process.argv);
maybePrintUpdateNotice();
