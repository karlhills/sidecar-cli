#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Command } from 'commander';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { initializeSchema } from './db/schema.js';
import { findSidecarRoot, getSidecarPaths } from './lib/paths.js';
import { nowIso, humanTime, stringifyJson } from './lib/format.js';
import { SidecarError } from './lib/errors.js';
import { GLOBAL_INSTRUCTIONS_DIR, resolveInstructionsSource } from './lib/instructions.js';
import { jsonFailure, jsonSuccess, printJsonEnvelope } from './lib/output.js';
import { bannerDisabled, renderBanner } from './lib/banner.js';
import { getUpdateNotice } from './lib/update-check.js';
import { ensureUiInstalled, launchUiServer } from './lib/ui.js';
import { requireInitialized } from './db/client.js';
import { renderAgentsMarkdown, renderClaudeMarkdown } from './templates/agents.js';
import { refreshSummaryFile } from './services/summary-service.js';
import { buildContext } from './services/context-service.js';
import { getCapabilitiesManifest } from './services/capabilities-service.js';
import { addArtifact, listArtifacts } from './services/artifact-service.js';
import { addDecision, addNote, addWorklog, getActiveSessionId, listRecentEvents } from './services/event-service.js';
import { currentSession, endSession, startSession, verifySessionHygiene } from './services/session-service.js';
import { eventIngestSchema, ingestEvent } from './services/event-ingest-service.js';
import { buildExportJson, buildExportJsonlEvents, writeOutputFile } from './services/export-service.js';
import { createTaskPacketRecord, getTaskPacket, listTaskPackets } from './tasks/task-service.js';
import { taskPacketPrioritySchema, taskPacketStatusSchema, taskPacketTypeSchema } from './tasks/task-packet.js';
import { getRunRecord, listRunRecords, listRunRecordsForTask } from './runs/run-service.js';
import { runStatusSchema, runnerTypeSchema } from './runs/run-record.js';
import { compileTaskPrompt } from './prompts/prompt-service.js';
import { runTaskExecution } from './services/run-orchestrator-service.js';
import { loadRunnerPreferences } from './runners/config.js';
import { assignTask, queueReadyTasks } from './services/task-orchestration-service.js';
import { buildReviewSummary, createFollowupTaskFromRun, reviewRun } from './services/run-review-service.js';
import type { ActorType, ArtifactKind, SidecarConfig } from './types/models.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const actorSchema = z.enum(['human', 'agent']);
const artifactKindSchema = z.enum(['file', 'doc', 'screenshot', 'other']);
const taskListStatusSchema = z.enum(['draft', 'ready', 'queued', 'running', 'review', 'blocked', 'done', 'all']);
const runListStatusSchema = runStatusSchema.or(z.literal('all'));
const agentRoleSchema = z.enum(['planner', 'builder-ui', 'builder-app', 'reviewer', 'tester']);
const exportFormatSchema = z.enum(['json', 'jsonl']);

const NOT_INITIALIZED_MSG = 'Sidecar is not initialized in this directory or any parent directory';

function fail(message: string): never {
  throw new SidecarError(message);
}

function maybeSessionId(db: DatabaseSync, projectId: number, explicit?: string): number | null {
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

function renderInitBanner(): string {
  return [
    '  [■]─[▪]',
    '  ███████╗██╗██████╗ ███████╗ ██████╗ █████╗ ██████╗',
    '  ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗',
    '  ███████╗██║██║  ██║█████╗  ██║     ███████║██████╔╝',
    '  ╚════██║██║██║  ██║██╔══╝  ██║     ██╔══██║██╔══██╗',
    '  ███████║██║██████╔╝███████╗╚██████╗██║  ██║██║  ██║',
    '  ╚══════╝╚═╝╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝',
  ].join('\n');
}

function summaryWasRefreshedRecently(db: DatabaseSync, projectId: number): boolean {
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

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function resolveProjectRoot(projectPath?: string): string {
  const basePath = projectPath ? path.resolve(projectPath) : process.cwd();
  const root = findSidecarRoot(basePath);
  if (!root) {
    throw new SidecarError(NOT_INITIALIZED_MSG);
  }
  return root;
}

function parseCsvOption(input?: string): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function askWithDefault(
  rl: readline.Interface,
  question: string,
  fallback?: string
): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  if (answer.length > 0) return answer;
  return fallback ?? '';
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
  .command('ui')
  .description('Launch the optional local Sidecar UI')
  .option('--no-open', 'Do not open the browser automatically')
  .option('--port <port>', 'Port to run the UI on', (v) => Number.parseInt(v, 10), 4310)
  .option('--install-only', 'Install/update UI package but do not launch')
  .option('--project <path>', 'Project path (defaults to nearest Sidecar root)')
  .option('--reinstall', 'Force reinstall UI package')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar ui\n  $ sidecar ui --no-open --port 4311\n  $ sidecar ui --project ../my-repo --install-only'
  )
  .action((opts) => {
    const command = 'ui';
    try {
      const projectRoot = resolveProjectRoot(opts.project);
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail('Port must be an integer between 1 and 65535');
      }

      if (!bannerDisabled()) {
        console.log(renderBanner());
        console.log('');
      }

      console.log('Launching Sidecar UI');
      console.log(`Project: ${projectRoot}`);

      const { installedVersion } = ensureUiInstalled({
        cliVersion: pkg.version,
        reinstall: Boolean(opts.reinstall),
        onStatus: (line) => console.log(line),
      });
      console.log(`UI version: ${installedVersion}`);

      if (opts.installOnly) {
        console.log('Install-only mode complete.');
        return;
      }

      const { url } = launchUiServer({
        projectPath: projectRoot,
        port,
        openBrowser: opts.open !== false,
      });
      console.log(`URL: ${url}`);
      if (opts.open === false) {
        console.log('Browser auto-open disabled.');
      }
    } catch (err) {
      handleCommandError(command, false, err);
    }
  });

program
  .command('init')
  .description('Initialize Sidecar in the current directory')
  .option('--force', 'Overwrite Sidecar files if they already exist')
  .option('--name <project-name>', 'Project name (defaults to current directory name)')
  .option(
    '--instructions-template <name>',
    `Load instructions template by name from ${GLOBAL_INSTRUCTIONS_DIR} (example: "web-app")`
  )
  .option('--instructions-file <path>', 'Load instructions from a specific markdown file path')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar init\n  $ sidecar init --name "My Project"\n  $ sidecar init --instructions-template web-app\n  $ sidecar init --instructions-file ~/.sidecar-cli/instructions/desktop.md\n  $ sidecar init --force --json'
  )
  .action((opts) => {
    const command = 'init';
    try {
      const rootPath = process.cwd();
      const sidecar = getSidecarPaths(rootPath);
      const projectName = opts.name?.trim() || path.basename(rootPath);
      const resolvedInstructions = resolveInstructionsSource({
        templateName: opts.instructionsTemplate,
        sourcePath: opts.instructionsFile,
        cwd: rootPath,
      });
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
        sidecar.tasksPath,
        sidecar.runsPath,
        sidecar.promptsPath,
        sidecar.dbPath,
        sidecar.configPath,
        sidecar.preferencesPath,
        sidecar.agentsPath,
        sidecar.summaryPath,
      ];
      const shouldWriteRootAgents = Boolean(opts.force) || !fs.existsSync(sidecar.rootAgentsPath);
      const shouldWriteRootClaude = Boolean(opts.force) || !fs.existsSync(sidecar.rootClaudePath);
      if (shouldWriteRootAgents) files.push(sidecar.rootAgentsPath);
      if (shouldWriteRootClaude) files.push(sidecar.rootClaudePath);
      if (resolvedInstructions) {
        const canWriteInstructions = Boolean(opts.force) || !fs.existsSync(sidecar.rootInstructionsPath);
        if (!canWriteInstructions) {
          fail(
            `Refusing to overwrite ${sidecar.rootInstructionsPath}. Re-run with --force or choose another destination.`
          );
        }
        files.push(sidecar.rootInstructionsPath);
      }

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
          sidecar.tasksPath,
          sidecar.runsPath,
          sidecar.promptsPath,
        ]) {
          if (fs.existsSync(file)) fs.rmSync(file, { recursive: true, force: true });
        }
      }

      const db = new DatabaseSync(sidecar.dbPath);
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
      fs.mkdirSync(sidecar.tasksPath, { recursive: true });
      fs.mkdirSync(sidecar.runsPath, { recursive: true });
      fs.mkdirSync(sidecar.promptsPath, { recursive: true });
      fs.writeFileSync(
        sidecar.preferencesPath,
        stringifyJson({
          summary: { format: 'markdown', recentLimit: 8 },
          output: { humanTime: true },
          runner: {
            defaultRunner: 'codex',
            preferredRunners: ['codex', 'claude'],
            defaultAgentRole: 'builder-app',
          },
        })
      );
      fs.writeFileSync(sidecar.agentsPath, renderAgentsMarkdown(projectName));
      if (shouldWriteRootAgents) {
        fs.writeFileSync(sidecar.rootAgentsPath, renderAgentsMarkdown(projectName));
      }
      if (shouldWriteRootClaude) {
        fs.writeFileSync(sidecar.rootClaudePath, renderClaudeMarkdown(projectName));
      }
      if (resolvedInstructions) {
        fs.writeFileSync(sidecar.rootInstructionsPath, resolvedInstructions.content);
      }

      const db2 = new DatabaseSync(sidecar.dbPath);
      const refreshed = refreshSummaryFile(db2, rootPath, 1, 10);
      db2.close();

      const data = {
        rootPath,
        sidecarPath: sidecar.sidecarPath,
        projectName,
        filesCreated: files,
        summaryGeneratedAt: refreshed.generatedAt,
        instructionsSource: resolvedInstructions?.sourceLabel ?? null,
        timestamp: nowIso(),
      };

      const shouldShowBanner = !opts.json && !bannerDisabled();
      if (shouldShowBanner) {
        console.log(renderInitBanner());
        console.log('');
      }
      respondSuccess(command, Boolean(opts.json), data, [
        `Initialized Sidecar for project: ${projectName}`,
        'Documentation: https://usesidecar.dev/',
        ...(resolvedInstructions ? ['', `Loaded instructions.md from ${resolvedInstructions.sourceLabel}`] : []),
      ]);
      maybePrintUpdateNotice();
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

      const data = { project, counts, recent_events: recent };
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

const preferences = program.command('preferences').description('Preferences commands');
preferences
  .command('show')
  .description('Show project preferences')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar preferences show\n  $ sidecar preferences show --json')
  .action((opts) => {
    const command = 'preferences show';
    try {
      const { rootPath } = requireInitialized();
      const prefsPath = getSidecarPaths(rootPath).preferencesPath;
      const preferencesData = fs.existsSync(prefsPath) ? JSON.parse(fs.readFileSync(prefsPath, 'utf8')) : {};
      respondSuccess(
        command,
        Boolean(opts.json),
        { project: { root_path: rootPath }, preferences: preferencesData, path: prefsPath },
        [`Preferences path: ${prefsPath}`, stringifyJson(preferencesData)]
      );
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
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

const event = program.command('event').description('Generic event ingest commands');
event
  .command('add')
  .description('Add a validated generic Sidecar event')
  .option('--type <type>', 'note|decision|worklog|task_created|task_completed|summary_generated')
  .option('--title <title>', 'Event title')
  .option('--summary <summary>', 'Event summary')
  .option('--details-json <json>', 'JSON object for details_json')
  .option('--created-by <by>', 'human|agent|system')
  .option('--source <source>', 'cli|imported|generated')
  .option('--session-id <id>', 'Optional session id', (v) => Number.parseInt(v, 10))
  .option('--json-input <json>', 'Raw JSON event payload')
  .option('--stdin', 'Read JSON event payload from stdin')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar event add --type note --summary "Captured context"\n  $ sidecar event add --json-input \'{"type":"decision","title":"Use SQLite","summary":"Local-first"}\' --json\n  $ cat event.json | sidecar event add --stdin --json'
  )
  .action(async (opts) => {
    const command = 'event add';
    try {
      const payloadSources = [Boolean(opts.jsonInput), Boolean(opts.stdin), Boolean(opts.type || opts.title || opts.summary || opts.detailsJson || opts.createdBy || opts.source || opts.sessionId)];
      if (payloadSources.filter(Boolean).length !== 1) {
        fail('Provide exactly one payload source: structured flags OR --json-input OR --stdin');
      }

      let payloadRaw: unknown;
      if (opts.jsonInput) {
        payloadRaw = JSON.parse(opts.jsonInput);
      } else if (opts.stdin) {
        const raw = (await readStdinText()).trim();
        if (!raw) fail('STDIN payload is empty');
        payloadRaw = JSON.parse(raw);
      } else {
        payloadRaw = {
          type: opts.type,
          title: opts.title,
          summary: opts.summary,
          details_json: opts.detailsJson ? JSON.parse(opts.detailsJson) : undefined,
          created_by: opts.createdBy,
          source: opts.source,
          session_id: Number.isInteger(opts.sessionId) ? opts.sessionId : undefined,
        };
      }

      const payload = eventIngestSchema.parse(payloadRaw);
      const { db, projectId } = requireInitialized();
      const created = ingestEvent(db, { project_id: projectId, payload });
      db.close();

      respondSuccess(
        command,
        Boolean(opts.json),
        { event: { ...created, created_at: nowIso() } },
        [`Recorded ${created.type} event #${created.id}.`]
      );
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('export')
  .description('Export project memory in JSON or JSONL')
  .option('--format <format>', 'json|jsonl', 'json')
  .option('--limit <n>', 'Limit exported events', (v) => Number.parseInt(v, 10))
  .option('--type <event-type>', 'Filter exported events by type')
  .option('--since <iso-date>', 'Filter events created_at >= since')
  .option('--until <iso-date>', 'Filter events created_at <= until')
  .option('--output <path>', 'Write export to file path instead of stdout')
  .option('--json', 'Wrap command metadata in JSON envelope when writing to file')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar export --format json\n  $ sidecar export --format jsonl --output sidecar-events.jsonl\n  $ sidecar export --type decision --since 2026-01-01T00:00:00Z'
  )
  .action((opts) => {
    const command = 'export';
    try {
      const format = exportFormatSchema.parse(opts.format);
      if (opts.since && Number.isNaN(Date.parse(opts.since))) fail('--since must be a valid ISO date');
      if (opts.until && Number.isNaN(Date.parse(opts.until))) fail('--until must be a valid ISO date');

      const { db, projectId, rootPath } = requireInitialized();
      if (format === 'json') {
        const payload = buildExportJson(db, {
          projectId,
          rootPath,
          limit: opts.limit,
          type: opts.type,
          since: opts.since,
          until: opts.until,
        });
        db.close();
        const rendered = stringifyJson(payload);
        if (opts.output) {
          const filePath = writeOutputFile(opts.output, `${rendered}\n`);
          respondSuccess(command, Boolean(opts.json), { format, output_path: filePath }, [`Export written: ${filePath}`]);
        } else {
          console.log(rendered);
        }
        return;
      }

      const lines = buildExportJsonlEvents(db, {
        projectId,
        limit: opts.limit,
        type: opts.type,
        since: opts.since,
        until: opts.until,
      });
      db.close();
      const rendered = `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
      if (opts.output) {
        const filePath = writeOutputFile(opts.output, rendered);
        respondSuccess(command, Boolean(opts.json), { format, output_path: filePath, records: lines.length }, [`Export written: ${filePath}`]);
      } else {
        process.stdout.write(rendered);
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
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

      respondSuccess(command, Boolean(opts.json), { summary: { path: out.path, generated_at: out.generatedAt } }, ['Summary refreshed.', `Path: ${out.path}`]);
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
      if (opts.json) printJsonEnvelope(jsonSuccess(command, { events: rows }));
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
      respondSuccess(
        command,
        Boolean(opts.json),
        { event: { id: eventId, type: 'note', title: opts.title?.trim() || 'Note', summary: text, created_by: by, session_id: sessionId, created_at: nowIso() } },
        [`Recorded note event #${eventId}.`]
      );
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
      respondSuccess(
        command,
        Boolean(opts.json),
        { event: { id: eventId, type: 'decision', title: opts.title, summary: opts.summary, created_by: by, session_id: sessionId, created_at: nowIso() } },
        [`Recorded decision event #${eventId}.`]
      );
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
      respondSuccess(command, Boolean(opts.json), { event: { id: result.eventId, type: 'worklog', summary: opts.done, created_by: by, session_id: sessionId, created_at: nowIso() }, artifacts: result.files.map((p) => ({ path: p, kind: 'file' })) }, [
        `Recorded worklog event #${result.eventId}.`,
        `Artifacts linked: ${result.files.length}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const task = program.command('task').description('Task commands');
task
  .command('create')
  .description('Create a structured task packet')
  .option('--title <title>', 'Task title')
  .option('--type <type>', 'feature|bug|chore|research', 'chore')
  .option('--status <status>', 'draft|ready|queued|running|review|blocked|done', 'draft')
  .option('--priority <priority>', 'low|medium|high', 'medium')
  .option('--summary <summary>', 'Task summary')
  .option('--goal <goal>', 'Task goal')
  .option('--dependencies <task-ids>', 'Comma-separated dependency task IDs')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--target-areas <areas>', 'Comma-separated target areas')
  .option('--scope-in <items>', 'Comma-separated in-scope items')
  .option('--scope-out <items>', 'Comma-separated out-of-scope items')
  .option('--related-decisions <items>', 'Comma-separated related decision IDs/titles')
  .option('--related-notes <items>', 'Comma-separated related notes')
  .option('--files-read <paths>', 'Comma-separated files to read')
  .option('--files-avoid <paths>', 'Comma-separated files to avoid')
  .option('--constraint-tech <items>', 'Comma-separated technical constraints')
  .option('--constraint-design <items>', 'Comma-separated design constraints')
  .option('--validate-cmds <commands>', 'Comma-separated validation commands')
  .option('--dod <items>', 'Comma-separated definition-of-done checks')
  .option('--branch <name>', 'Branch name')
  .option('--worktree <path>', 'Worktree path')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar task create\n  $ sidecar task create --title "Add import support" --summary "Support JSON import" --goal "Enable scripted import flow" --priority high\n  $ sidecar task create --title "Refactor parser" --files-read src/parser.ts,src/types.ts --dod "Tests pass,Docs updated"'
  )
  .action(async (opts) => {
    const command = 'task create';
    try {
      const rootPath = resolveProjectRoot();
      let title = opts.title?.trim() ?? '';
      let summary = opts.summary?.trim() ?? '';
      let goal = opts.goal?.trim() ?? '';

      if (!title || !summary || !goal) {
        if (!process.stdin.isTTY) {
          fail('Missing required fields. Provide --title, --summary, and --goal when not running interactively.');
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          title = title || (await askWithDefault(rl, 'Title'));
          summary = summary || (await askWithDefault(rl, 'Summary', title));
          goal = goal || (await askWithDefault(rl, 'Goal', `Complete: ${title}`));
        } finally {
          rl.close();
        }
      }

      const type = taskPacketTypeSchema.parse(opts.type);
      const status = taskPacketStatusSchema.parse(opts.status);
      const priority = taskPacketPrioritySchema.parse(opts.priority);

      const created = createTaskPacketRecord(rootPath, {
        title,
        summary,
        goal,
        type,
        status,
        priority,
        scope_in_scope: parseCsvOption(opts.scopeIn),
        scope_out_of_scope: parseCsvOption(opts.scopeOut),
        related_decisions: parseCsvOption(opts.relatedDecisions),
        related_notes: parseCsvOption(opts.relatedNotes),
        files_to_read: parseCsvOption(opts.filesRead),
        files_to_avoid: parseCsvOption(opts.filesAvoid),
        technical_constraints: parseCsvOption(opts.constraintTech),
        design_constraints: parseCsvOption(opts.constraintDesign),
        validation_commands: parseCsvOption(opts.validateCmds),
        dependencies: parseCsvOption(opts.dependencies).map((v) => v.toUpperCase()),
        tags: parseCsvOption(opts.tags),
        target_areas: parseCsvOption(opts.targetAreas),
        definition_of_done: parseCsvOption(opts.dod),
        branch: opts.branch?.trim(),
        worktree: opts.worktree?.trim(),
      });

      respondSuccess(
        command,
        Boolean(opts.json),
        { task: created.task, path: created.path },
        [`Created task ${created.task.task_id}.`, `Path: ${created.path}`]
      );
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

task
  .command('show <task-id>')
  .description('Show a task packet by id')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar task show T-001\n  $ sidecar task show T-001 --json')
  .action((taskIdText, opts) => {
    const command = 'task show';
    try {
      const task = getTaskPacket(resolveProjectRoot(), taskIdText.trim().toUpperCase());
      if (opts.json) {
        respondSuccess(command, true, { task }, []);
        return;
      }
      console.log(stringifyJson(task));
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

task
  .command('list')
  .description('List task packets')
  .option('--status <status>', 'draft|ready|queued|running|review|blocked|done|all', 'all')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar task list\n  $ sidecar task list --status open\n  $ sidecar task list --json')
  .action((opts) => {
    const command = 'task list';
    try {
      const status = taskListStatusSchema.parse(
        opts.status as 'draft' | 'ready' | 'queued' | 'running' | 'review' | 'blocked' | 'done' | 'all'
      );
      const tasks = listTaskPackets(resolveProjectRoot());
      const rows = status === 'all' ? tasks : tasks.filter((task) => task.status === status);

      if (opts.json) {
        respondSuccess(command, true, { status, tasks: rows }, []);
        return;
      }

      if (rows.length === 0) {
        console.log('No tasks found.');
        return;
      }

      const idWidth = Math.max(6, ...rows.map((r) => r.task_id.length));
      const statusWidth = Math.max(11, ...rows.map((r) => r.status.length));
      const priorityWidth = Math.max(8, ...rows.map((r) => r.priority.length));
      console.log(`${'TASK ID'.padEnd(idWidth)}  ${'STATUS'.padEnd(statusWidth)}  ${'PRIORITY'.padEnd(priorityWidth)}  TITLE`);
      for (const row of rows) {
        console.log(
          `${row.task_id.padEnd(idWidth)}  ${row.status.padEnd(statusWidth)}  ${row.priority.padEnd(priorityWidth)}  ${row.title}`
        );
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

task
  .command('assign <task-id>')
  .description('Auto-assign agent role and runner for a task')
  .option('--agent-role <role>', 'planner|builder-ui|builder-app|reviewer|tester')
  .option('--runner <runner>', 'codex|claude')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar task assign T-001\n  $ sidecar task assign T-001 --agent-role builder-ui --runner codex\n  $ sidecar task assign T-001 --json'
  )
  .action((taskIdText, opts) => {
    const command = 'task assign';
    try {
      const rootPath = resolveProjectRoot();
      const result = assignTask(rootPath, taskIdText.trim().toUpperCase(), {
        role: opts.agentRole ? agentRoleSchema.parse(opts.agentRole as string) : undefined,
        runner: opts.runner ? runnerTypeSchema.parse(opts.runner as string) : undefined,
      });
      respondSuccess(command, Boolean(opts.json), result, [
        `Assigned ${result.task_id}.`,
        `Role: ${result.agent_role}`,
        `Runner: ${result.runner}`,
        `Reason: ${result.reason}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

task
  .command('create-followup <run-id>')
  .description('Create a follow-up task packet from a run report')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar task create-followup R-010\n  $ sidecar task create-followup R-010 --json'
  )
  .action((runIdText, opts) => {
    const command = 'task create-followup';
    try {
      const result = createFollowupTaskFromRun(resolveProjectRoot(), runIdText.trim().toUpperCase());
      respondSuccess(command, Boolean(opts.json), result, [
        `Created follow-up task ${result.task_id}.`,
        `Source run: ${result.source_run_id}`,
        `Title: ${result.title}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const prompt = program.command('prompt').description('Prompt compilation commands');
prompt
  .command('compile <task-id>')
  .description('Compile a markdown execution brief from a task packet')
  .requiredOption('--runner <runner>', 'codex|claude')
  .requiredOption('--agent-role <role>', 'Agent role, for example builder')
  .option('--preview', 'Print compiled prompt content after writing file')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar prompt compile T-001 --runner codex --agent-role builder\n  $ sidecar prompt compile T-001 --runner claude --agent-role builder --preview\n  $ sidecar prompt compile T-001 --runner codex --agent-role reviewer --json'
  )
  .action((taskIdText, opts) => {
    const command = 'prompt compile';
    try {
      const rootPath = resolveProjectRoot();
      const taskId = taskIdText.trim().toUpperCase();
      const runner = runnerTypeSchema.parse(opts.runner as string);
      const agentRole = String(opts.agentRole ?? '').trim();
      if (!agentRole) fail('Agent role is required');

      const compiled = compileTaskPrompt({
        rootPath,
        taskId,
        runner,
        agentRole,
      });

      respondSuccess(
        command,
        Boolean(opts.json),
        {
          run_id: compiled.run_id,
          task_id: compiled.task_id,
          runner_type: compiled.runner_type,
          agent_role: compiled.agent_role,
          prompt_path: compiled.prompt_path,
          prompt_optimization: compiled.prompt_optimization,
          preview: opts.preview ? compiled.prompt_markdown : null,
        },
        [
          `Compiled prompt for ${compiled.task_id}.`,
          `Run: ${compiled.run_id}`,
          `Path: ${compiled.prompt_path}`,
          `Prompt estimate: ${compiled.prompt_optimization.estimated_tokens_before} -> ${compiled.prompt_optimization.estimated_tokens_after} tokens (target ${compiled.prompt_optimization.budget_target})`,
          ...(compiled.prompt_optimization.trimmed_sections.length > 0
            ? [`Trimmed: ${compiled.prompt_optimization.trimmed_sections.join(', ')}`]
            : []),
          ...(opts.preview ? ['', compiled.prompt_markdown] : []),
        ]
      );
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('run-exec <task-id>')
  .description('Internal command backing `sidecar run <task-id>`')
  .option('--runner <runner>', 'codex|claude')
  .option('--agent-role <role>', 'planner|builder-ui|builder-app|reviewer|tester')
  .option('--dry-run', 'Prepare and compile only without executing external runner')
  .option('--json', 'Print machine-readable JSON output')
  .action((taskIdText, opts) => {
    const command = 'run';
    try {
      const rootPath = resolveProjectRoot();
      const defaults = loadRunnerPreferences(rootPath);
      const selectedRunner = opts.runner ? runnerTypeSchema.parse(opts.runner as string) : defaults.default_runner;
      const selectedAgentRole = opts.agentRole
        ? agentRoleSchema.parse(opts.agentRole as string)
        : defaults.default_agent_role;

      const result = runTaskExecution({
        rootPath,
        taskId: String(taskIdText).trim().toUpperCase(),
        runner: selectedRunner,
        agentRole: selectedAgentRole,
        dryRun: Boolean(opts.dryRun),
      });

      respondSuccess(command, Boolean(opts.json), result, [
        `Prepared run ${result.run_id} for ${result.task_id}.`,
        `Runner: ${result.runner_type} (${result.agent_role})`,
        `Prompt: ${result.prompt_path}`,
        `Command: ${result.shell_command}`,
        `Status: ${result.status}`,
        `Summary: ${result.summary}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

const run = program
  .command('run')
  .description('Run task execution or inspect run records')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar run T-001 --dry-run\n  $ sidecar run T-001 --runner claude --agent-role reviewer\n  $ sidecar run queue\n  $ sidecar run start-ready --dry-run\n  $ sidecar run list --task T-001\n  $ sidecar run show R-001'
  );

run
  .command('queue')
  .description('Queue all ready tasks with satisfied dependencies')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar run queue\n  $ sidecar run queue --json')
  .action((opts) => {
    const command = 'run queue';
    try {
      const rootPath = resolveProjectRoot();
      const decisions = queueReadyTasks(rootPath);
      respondSuccess(command, Boolean(opts.json), { decisions }, [
        `Processed ${decisions.length} ready task(s).`,
        ...decisions.map((d) => `- ${d.task_id}: ${d.reason}`),
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

run
  .command('start-ready')
  .description('Queue and start all runnable ready tasks')
  .option('--dry-run', 'Prepare and compile only without executing external runners')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar run start-ready\n  $ sidecar run start-ready --dry-run --json')
  .action((opts) => {
    const command = 'run start-ready';
    try {
      const rootPath = resolveProjectRoot();
      const queueDecisions = queueReadyTasks(rootPath);
      const queuedTasks = listTaskPackets(rootPath).filter((task) => task.status === 'queued');
      const results = queuedTasks.map((task) => runTaskExecution({ rootPath, taskId: task.task_id, dryRun: Boolean(opts.dryRun) }));
      respondSuccess(command, Boolean(opts.json), { queued: queueDecisions, results }, [
        `Queued in this pass: ${queueDecisions.filter((d) => d.queued).length}`,
        `Started: ${results.length}`,
        ...results.map((r) => `- ${r.task_id} -> ${r.run_id} (${r.status})`),
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

run
  .command('approve <run-id>')
  .description('Review a completed run as approved, needs changes, or merged')
  .option('--state <state>', 'approved|needs_changes|merged', 'approved')
  .option('--note <text>', 'Review note')
  .option('--by <name>', 'Reviewer name', 'human')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar run approve R-010\n  $ sidecar run approve R-010 --state needs_changes --note "Address test failures"\n  $ sidecar run approve R-010 --state merged --json'
  )
  .action((runIdText, opts) => {
    const command = 'run approve';
    try {
      const state = String(opts.state);
      if (state !== 'approved' && state !== 'needs_changes' && state !== 'merged') {
        fail('State must be one of: approved, needs_changes, merged');
      }
      const result = reviewRun(resolveProjectRoot(), runIdText.trim().toUpperCase(), state, {
        note: opts.note,
        by: opts.by,
      });
      respondSuccess(command, Boolean(opts.json), result, [
        `Run ${result.run_id} marked ${result.review_state}.`,
        `Task ${result.task_id} -> ${result.task_status}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

run
  .command('block <run-id>')
  .description('Mark a completed run as blocked and set linked task blocked')
  .option('--note <text>', 'Blocking reason')
  .option('--by <name>', 'Reviewer name', 'human')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar run block R-010 --note "Migration failed"\n  $ sidecar run block R-010 --json')
  .action((runIdText, opts) => {
    const command = 'run block';
    try {
      const result = reviewRun(resolveProjectRoot(), runIdText.trim().toUpperCase(), 'blocked', {
        note: opts.note,
        by: opts.by,
      });
      respondSuccess(command, Boolean(opts.json), result, [
        `Run ${result.run_id} marked blocked.`,
        `Task ${result.task_id} -> ${result.task_status}`,
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

run
  .command('list')
  .description('List execution run records')
  .option('--task <task-id>', 'Filter by task id (for example T-001)')
  .option('--status <status>', 'queued|preparing|running|review|blocked|completed|failed|all', 'all')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar run list\n  $ sidecar run list --task T-001\n  $ sidecar run list --status completed --json')
  .action((opts) => {
    const command = 'run list';
    try {
      const rootPath = resolveProjectRoot();
      const status = runListStatusSchema.parse(opts.status as string);
      const base = opts.task ? listRunRecordsForTask(rootPath, String(opts.task).trim().toUpperCase()) : listRunRecords(rootPath);
      const rows = status === 'all' ? base : base.filter((entry) => entry.status === status);

      if (opts.json) {
        respondSuccess(command, true, { status, task_id: opts.task ? String(opts.task).trim().toUpperCase() : null, runs: rows }, []);
        return;
      }

      if (rows.length === 0) {
        console.log('No run records found.');
        return;
      }

      const idWidth = Math.max(6, ...rows.map((r) => r.run_id.length));
      const taskWidth = Math.max(7, ...rows.map((r) => r.task_id.length));
      const statusWidth = Math.max(10, ...rows.map((r) => r.status.length));
      console.log(`${'RUN ID'.padEnd(idWidth)}  ${'TASK ID'.padEnd(taskWidth)}  ${'STATUS'.padEnd(statusWidth)}  STARTED`);
      for (const row of rows) {
        console.log(
          `${row.run_id.padEnd(idWidth)}  ${row.task_id.padEnd(taskWidth)}  ${row.status.padEnd(statusWidth)}  ${humanTime(row.started_at)}`
        );
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

run
  .command('summary')
  .description('Show project-level run review summary')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar run summary\n  $ sidecar run summary --json')
  .action((opts) => {
    const command = 'run summary';
    try {
      const data = buildReviewSummary(resolveProjectRoot());
      respondSuccess(command, Boolean(opts.json), data, [
        `Completed runs: ${data.completed_runs}`,
        `Blocked runs: ${data.blocked_runs}`,
        `Suggested follow-ups: ${data.suggested_follow_ups}`,
        'Recently merged:',
        ...(data.recently_merged.length
          ? data.recently_merged.map((r) => `- ${r.run_id} (${r.task_id}) at ${humanTime(r.reviewed_at)}`)
          : ['- none']),
      ]);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

run
  .command('show <run-id>')
  .description('Show a run record by id')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText('after', '\nExamples:\n  $ sidecar run show R-001\n  $ sidecar run show R-001 --json')
  .action((runIdText, opts) => {
    const command = 'run show';
    try {
      const runRecord = getRunRecord(resolveProjectRoot(), runIdText.trim().toUpperCase());
      if (opts.json) {
        respondSuccess(command, true, { run: runRecord }, []);
        return;
      }
      console.log(stringifyJson(runRecord));
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
      respondSuccess(command, Boolean(opts.json), { session: { id: result.sessionId, actor_type: actor, actor_name: opts.name ?? null, started_at: nowIso() } }, [`Started session #${result.sessionId}.`]);
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
      respondSuccess(command, Boolean(opts.json), { session: { id: result.sessionId, ended_at: nowIso(), summary: opts.summary ?? null } }, [`Ended session #${result.sessionId}.`]);
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
      if (opts.json) printJsonEnvelope(jsonSuccess(command, { session: current ?? null }));
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
      respondSuccess(command, Boolean(opts.json), { artifact: { id: artifactId, path: artifactPath, kind, note: opts.note ?? null, created_at: nowIso() } }, [`Added artifact #${artifactId}.`]);
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
      if (opts.json) printJsonEnvelope(jsonSuccess(command, { artifacts: rows }));
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
  process.exit(0);
}

if (
  process.argv[2] === 'run' &&
  process.argv[3] &&
  !process.argv[3].startsWith('-') &&
  process.argv[3] !== 'list' &&
  process.argv[3] !== 'show' &&
  process.argv[3] !== 'queue' &&
  process.argv[3] !== 'start-ready' &&
  process.argv[3] !== 'approve' &&
  process.argv[3] !== 'block' &&
  process.argv[3] !== 'summary'
) {
  process.argv.splice(2, 1, 'run-exec');
}

program.parse(process.argv);
