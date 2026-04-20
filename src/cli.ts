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
import { c } from './lib/color.js';
import { renderTable } from './lib/table.js';
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
import { HOOK_EVENTS, handleHookEvent, hookEventSchema, hookPayloadSchema } from './services/hook-service.js';
import { loadPromptSpec } from './prompts/prompt-spec.js';
import { compileSections, type TrimPolicy } from './prompts/sections.js';
import { loadPromptPreferences } from './runners/config.js';
import { renderClaudeCodeHooksJson } from './templates/hooks.js';
import { eventIngestSchema, ingestEvent } from './services/event-ingest-service.js';
import { buildExportJson, buildExportJsonlEvents, writeOutputFile } from './services/export-service.js';
import { createTaskPacketRecord, getTaskPacket, listTaskPackets } from './tasks/task-service.js';
import { taskPacketPrioritySchema, taskPacketStatusSchema, taskPacketTypeSchema } from './tasks/task-packet.js';
import { getRunRecord, listRunRecords, listRunRecordsForTask } from './runs/run-service.js';
import { runStatusSchema, runnerTypeSchema } from './runs/run-record.js';
import { compileTaskPrompt } from './prompts/prompt-service.js';
import { runPipelineExecution, runTaskExecution } from './services/run-orchestrator-service.js';
import { loadRunnerPreferences, type AgentRole } from './runners/config.js';
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

function formatStatus(value: string): string {
  const v = value.toLowerCase();
  if (v === 'ready' || v === 'draft') return c.cyan(value);
  if (v === 'running' || v === 'queued') return c.yellow(value);
  if (v === 'review') return c.magenta(value);
  if (v === 'blocked') return c.red(value);
  if (v === 'done' || v === 'merged' || v === 'approved') return c.green(value);
  return value;
}

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
    console.error(`${c.red(c.bold('Error:'))} ${message}`);
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
program
  .name('sidecar')
  .description(
    'Local-first project memory and agent runner. Two namespaces:\n' +
      '  sidecar log <memory-cmd>   (worklog, decision, note, recent, context, summary, session, event, artifact)\n' +
      '  sidecar work <runner-cmd>  (task, run, prompt, hooks)\n' +
      'The underlying verbs also work directly (e.g. `sidecar worklog record`), so existing scripts keep working.',
  )
  .version(pkg.version);
program.option('--no-banner', 'Disable Sidecar banner output');

const LOG_NAMESPACE_MEMBERS = [
  'worklog',
  'decision',
  'note',
  'recent',
  'context',
  'summary',
  'session',
  'event',
  'artifact',
] as const;
const WORK_NAMESPACE_MEMBERS = ['task', 'run', 'prompt', 'hooks'] as const;

// Approach C for the namespace split (memory vs runner): NEW top-level groups
// `log` and `work` that proxy to the existing verbs by rewriting argv before
// commander parses it. Existing verbs remain registered as-is, so scripts,
// agents, and CLAUDE.md files in the wild keep working — the new namespaces
// just add a clean positioning surface on top.
function rewriteNamespaceArgv(argv: readonly string[]): string[] {
  const out = [...argv];
  if (out.length < 4) return out;
  const ns = out[2];
  const next = out[3];
  if (ns === 'log' && (LOG_NAMESPACE_MEMBERS as readonly string[]).includes(next)) {
    out.splice(2, 1);
    return out;
  }
  if (ns === 'work' && (WORK_NAMESPACE_MEMBERS as readonly string[]).includes(next)) {
    out.splice(2, 1);
    return out;
  }
  return out;
}

function printNamespaceHelp(kind: 'log' | 'work'): void {
  const members = kind === 'log' ? LOG_NAMESPACE_MEMBERS : WORK_NAMESPACE_MEMBERS;
  const heading = kind === 'log' ? 'Memory commands' : 'Runner commands';
  console.log(`${heading} — use ${c.cyan(`sidecar ${kind} <command> …`)} or the verb directly.`);
  console.log('');
  for (const m of members) {
    console.log(`  ${c.cyan(`sidecar ${kind} ${m}`)}  →  ${c.dim(`sidecar ${m}`)}`);
  }
  console.log('');
  console.log(`Run ${c.cyan(`sidecar <command> --help`)} for details on any verb.`);
}

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
  console.log(c.yellow(`Update available: ${pkg.version} -> ${notice.latestVersion}`));
  console.log(`Run: ${c.cyan(`npm install -g sidecar-cli@${installTag}`)}`);
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

      // Format info with aligned labels
      const projectLabel = 'Project:'.padEnd(15);
      const versionLabel = 'UI version:'.padEnd(15);
      console.log(`  ${projectLabel}${projectRoot}`);

      const { installedVersion } = ensureUiInstalled({
        cliVersion: pkg.version,
        reinstall: Boolean(opts.reinstall),
        onStatus: (line) => console.log(`  …  ${line}`),
      });
      console.log(`  ${versionLabel}${installedVersion}`);

      if (opts.installOnly) {
        console.log('Install-only mode complete.');
        return;
      }

      const { url } = launchUiServer({
        projectPath: projectRoot,
        port,
        openBrowser: opts.open !== false,
      });

      console.log('');
      const openLabel = 'Open:'.padEnd(15);
      console.log(`  ${openLabel}${c.cyan(url)}`);
      if (opts.open === false) {
        console.log('  Browser auto-open disabled.');
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
        console.log(renderBanner('block'));
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
  .command('demo')
  .description('One-shot walkthrough in a temp dir: init → task → prompt → worklog → decision → summary')
  .option('--cleanup', 'Delete the demo directory when done (default: keep so you can inspect the files)')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar demo\n  $ sidecar demo --cleanup\n  $ sidecar demo --json'
  )
  .action(async (opts) => {
    const command = 'demo';
    const os = await import('node:os');
    const asJson = Boolean(opts.json);
    const previousCwd = process.cwd();
    const demoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-demo-'));
    const log = asJson ? () => {} : (line = '') => console.log(line);
    const step = (n: number, title: string) => log(`\n${c.bold(c.cyan(`[${n}] ${title}`))}`);
    try {
      process.chdir(demoRoot);

      log(c.bold('Sidecar demo'));
      log(c.dim(`Sandbox: ${demoRoot}`));
      log(c.dim('Nothing below modifies your current project.'));

      step(1, 'Initialize (.sidecar/, config, DB)');
      const sidecar = getSidecarPaths(demoRoot);
      fs.mkdirSync(sidecar.sidecarPath, { recursive: true });
      fs.mkdirSync(sidecar.tasksPath, { recursive: true });
      fs.mkdirSync(sidecar.runsPath, { recursive: true });
      fs.mkdirSync(sidecar.promptsPath, { recursive: true });
      const ts = nowIso();
      const projectName = 'demo-project';
      {
        const db = new DatabaseSync(sidecar.dbPath);
        initializeSchema(db);
        db.prepare(`DELETE FROM projects`).run();
        db.prepare(
          `INSERT INTO projects (name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?)`
        ).run(projectName, demoRoot, ts, ts);
        db.close();
      }
      const config: SidecarConfig = {
        schemaVersion: 1,
        project: { name: projectName, rootPath: demoRoot, createdAt: ts },
        defaults: { summary: { recentLimit: 10 } },
        settings: {},
      };
      fs.writeFileSync(sidecar.configPath, stringifyJson(config));
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
      log(c.green('  ✓ ') + 'Sidecar initialized');
      log(c.dim(`     try: sidecar status`));

      step(2, 'Create a sample task packet');
      const created = createTaskPacketRecord(demoRoot, {
        title: 'Add welcome banner',
        summary: 'Show a friendly greeting on first launch so new users know the tool is working.',
        goal: 'Render a configurable banner at the top of the home page.',
        type: 'feature',
        status: 'ready',
        priority: 'medium',
        scope_in_scope: ['Render banner component', 'Wire to /home route'],
        scope_out_of_scope: ['Dismissal persistence'],
        files_to_read: ['src/pages/home.tsx'],
        definition_of_done: ['Banner visible on load', 'No layout shift'],
        validation_commands: ['typecheck@30s:tsc --noEmit', 'test@2m:npm test'],
      });
      log(c.green('  ✓ ') + `${created.task.task_id} — ${created.task.title}`);
      log(c.dim(`     packet: ${path.relative(demoRoot, created.path)}`));
      log(c.dim(`     try: sidecar task show ${created.task.task_id}`));

      step(3, 'Compile a prompt (no runner spawn)');
      const compiled = compileTaskPrompt({
        rootPath: demoRoot,
        taskId: created.task.task_id,
        runner: 'codex',
        agentRole: 'builder-app',
      });
      const promptPreview = compiled.prompt_markdown
        .split('\n')
        .slice(0, 10)
        .map((l) => '     ' + l)
        .join('\n');
      log(c.green('  ✓ ') + `${compiled.run_id} compiled to ${path.relative(demoRoot, compiled.prompt_path)}`);
      log(
        c.dim(
          `     tokens: ${compiled.prompt_optimization.estimated_tokens_before} → ${compiled.prompt_optimization.estimated_tokens_after} (budget ${compiled.prompt_optimization.budget_target})`
        )
      );
      log(c.dim('     preview:'));
      log(c.dim(promptPreview));
      log(c.dim(`     try: sidecar run-exec ${created.task.task_id} --dry-run`));

      step(4, 'Record a worklog + decision');
      const db = new DatabaseSync(sidecar.dbPath);
      const row = db.prepare(`SELECT id FROM projects LIMIT 1`).get() as { id: number };
      const projectId = row.id;
      addWorklog(db, {
        projectId,
        goal: 'welcome banner',
        done: 'Scaffolded banner component and wired the home route.',
        files: 'src/pages/home.tsx,src/components/Banner.tsx',
        by: 'agent',
      });
      addDecision(db, {
        projectId,
        title: 'Use inline SVG for the banner icon',
        summary: 'Avoids an extra network request on first load; matches existing icon patterns.',
        by: 'agent',
      });
      log(c.green('  ✓ ') + 'worklog + decision recorded');
      log(c.dim('     try: sidecar worklog list  |  sidecar decision list'));

      step(5, 'Refresh summary + show context');
      const refreshed = refreshSummaryFile(db, demoRoot, projectId, 10);
      const ctx = buildContext(db, { projectId, limit: 10 });
      db.close();
      log(c.green('  ✓ ') + `summary.md refreshed (${refreshed.generatedAt})`);
      log(c.dim(`     path: ${path.relative(demoRoot, sidecar.summaryPath)}`));
      log(
        c.dim(
          `     worklogs: ${ctx.recentWorklogs.length}, decisions: ${ctx.recentDecisions.length}, open tasks: ${ctx.openTasks.length}`
        )
      );
      log(c.dim('     try: sidecar context --format markdown'));

      log('');
      log(c.bold('Done.'));
      if (opts.cleanup) {
        process.chdir(previousCwd);
        fs.rmSync(demoRoot, { recursive: true, force: true });
        log(c.dim('Sandbox cleaned up.'));
      } else {
        log(`Sandbox kept at ${c.cyan(demoRoot)} — poke around, then ${c.dim('rm -rf')} when done.`);
      }

      const data = {
        demo_root: demoRoot,
        task_id: created.task.task_id,
        run_id: compiled.run_id,
        prompt_path: compiled.prompt_path,
        cleaned_up: Boolean(opts.cleanup),
      };
      if (asJson) {
        process.chdir(previousCwd);
        printJsonEnvelope(jsonSuccess(command, data));
      }
    } catch (err) {
      try { process.chdir(previousCwd); } catch { /* ignore */ }
      handleCommandError(command, asJson, err);
    } finally {
      if (process.cwd() !== previousCwd) {
        try { process.chdir(previousCwd); } catch { /* ignore */ }
      }
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
        const typed = rows as Array<{ id: number; type: string; title: string; summary: string; created_at: string }>;
        if (typed.length === 0) {
          console.log('No events found.');
          return;
        }
        renderTable(
          [
            { key: 'id', label: 'ID', align: 'right' },
            { key: 'when', label: 'When' },
            { key: 'type', label: 'Type' },
            { key: 'title', label: 'Title', maxWidth: 40 },
            { key: 'summary', label: 'Summary', maxWidth: 60 },
          ],
          typed.map((row) => ({
            id: `#${row.id}`,
            when: humanTime(row.created_at),
            type: row.type,
            title: row.title ?? '',
            summary: row.summary ?? '',
          }))
        );
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
  .option(
    '--validate-cmds <commands>',
    'Comma-separated validation commands. Use "kind:command" to tag (typecheck|lint|test|build|custom), e.g. "typecheck:tsc --noEmit,test:npm test". Append "@30s" / "@2m" / "@1500ms" to the kind to override the timeout, e.g. "test@2m:npm test".',
  )
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

      const tableRows = rows.map((r) => ({
        task_id: r.task_id,
        status: r.status,
        priority: r.priority,
        title: r.title,
      }));

      renderTable(
        [
          { key: 'task_id', label: 'TASK ID', minWidth: 6 },
          { key: 'status', label: 'STATUS', minWidth: 8, format: formatStatus },
          { key: 'priority', label: 'PRIORITY', minWidth: 8 },
          { key: 'title', label: 'TITLE', maxWidth: 60 },
        ],
        tableRows
      );
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

function parseSectionPolicy(raw: string | undefined): Record<string, TrimPolicy> | undefined {
  if (!raw) return undefined;
  const out: Record<string, TrimPolicy> = {};
  for (const pair of raw.split(',')) {
    const [id, policy] = pair.split('=').map((s) => s.trim());
    if (!id || !policy) continue;
    if (policy !== 'keep' && policy !== 'trim-last' && policy !== 'drop') {
      fail(`Invalid policy for ${id}: ${policy} (expected keep|trim-last|drop)`);
    }
    out[id] = policy;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isSpecFileTarget(target: string): boolean {
  const lower = target.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.json')) return true;
  if (target.includes('/') || target.startsWith('.')) return true;
  if (fs.existsSync(target)) return true;
  return false;
}

prompt
  .command('compile <task-or-file>')
  .description('Compile a markdown execution brief from a task id OR a freestanding prompt spec file (.yaml|.yml|.json)')
  .option('--runner <runner>', 'codex|claude (task-id mode only)')
  .option('--agent-role <role>', 'Agent role, for example builder (task-id mode only)')
  .option('--preview', 'Print compiled prompt content after writing file')
  .option('--budget <tokens>', 'Override target budget (spec-file mode)', (v) => Number.parseInt(v, 10))
  .option('--budget-max <tokens>', 'Override ceiling budget (spec-file mode)', (v) => Number.parseInt(v, 10))
  .option('--section-policy <id=policy,...>', 'Per-section policy overrides (keep|trim-last|drop), spec-file mode')
  .option('--explain', 'Print a per-section trace of what got kept, trimmed, or dropped')
  .option('-o, --out <path>', 'Write compiled markdown to this path (spec-file mode; default prints to stdout)')
  .option('--format <format>', 'markdown|json (spec-file mode; default markdown)', 'markdown')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n' +
      '  $ sidecar prompt compile T-001 --runner codex --agent-role builder\n' +
      '  $ sidecar prompt compile T-001 --runner claude --agent-role builder --preview\n' +
      '  $ sidecar prompt compile ./prompt.yaml\n' +
      '  $ sidecar prompt compile prompt.yaml --budget 2000 --explain\n' +
      '  $ sidecar prompt compile prompt.yaml --section-policy notes=drop,decisions=keep -o out.md\n' +
      '\nSpec schema (YAML or JSON):\n' +
      '  header: ["# Title", "..."]\n' +
      '  sections:\n' +
      '    - id: objective\n' +
      '      title: Objective\n' +
      '      content: "What to build"\n' +
      '      required: true\n' +
      '    - id: scope\n' +
      '      title: In scope\n' +
      '      list: ["...", "..."]\n' +
      '      trim: { policy: trim-last, limit: 8, limit_strict: 3, overflow_label: "in-scope items" }\n' +
      '  budget: { target: 1200, max: 1500 }\n',
  )
  .action((target: string, opts) => {
    const command = 'prompt compile';
    try {
      const targetText = String(target).trim();
      const usingSpec = isSpecFileTarget(targetText);

      if (usingSpec) {
        const rootPath = resolveProjectRoot();
        const pref = loadPromptPreferences(rootPath);
        const { spec, input } = loadPromptSpec(targetText);

        const target_budget = Number.isFinite(opts.budget) ? Number(opts.budget) : spec.budget?.target ?? pref.budget_target;
        const max_budget = Number.isFinite(opts.budgetMax)
          ? Number(opts.budgetMax)
          : spec.budget?.max ?? Math.max(target_budget, pref.budget_max);
        const policyOverrides = {
          ...(input.policy_overrides ?? {}),
          ...(parseSectionPolicy(opts.sectionPolicy) ?? {}),
        };

        const result = compileSections({
          ...input,
          budget: { target: target_budget, max: max_budget },
          ...(Object.keys(policyOverrides).length > 0 ? { policy_overrides: policyOverrides } : {}),
        });

        const format = String(opts.format ?? 'markdown').toLowerCase();
        if (opts.out) {
          fs.mkdirSync(path.dirname(path.resolve(String(opts.out))), { recursive: true });
          fs.writeFileSync(path.resolve(String(opts.out)), result.markdown, 'utf8');
        }

        if (opts.json || format === 'json') {
          printJsonEnvelope(
            jsonSuccess(command, {
              source: targetText,
              out_path: opts.out ? path.resolve(String(opts.out)) : null,
              markdown: result.markdown,
              metadata: result.metadata,
            }),
          );
          return;
        }

        if (!opts.out) {
          process.stdout.write(result.markdown);
        } else {
          console.log(`Compiled ${targetText} -> ${path.resolve(String(opts.out))}`);
          console.log(
            `Estimate: ${result.metadata.estimated_tokens_before} -> ${result.metadata.estimated_tokens_after} tokens (target ${target_budget}, max ${max_budget})`,
          );
        }
        if (opts.explain) {
          console.error(''); // blank line before explain block when stdout carried markdown
          console.error('--- explain ---');
          for (const s of result.metadata.sections) {
            const status = s.was_dropped ? 'dropped' : s.was_trimmed ? 'trimmed' : 'kept';
            const counts = s.kind === 'list' ? ` ${s.kept_items ?? 0}/${s.total_items ?? 0}` : '';
            console.error(
              `  [${status}] ${s.id} (${s.kind}${counts}) — ~${s.estimated_tokens} tokens — policy=${s.policy_applied}`,
            );
          }
          if (result.metadata.trimmed_sections.length > 0) {
            console.error(`trimmed: ${result.metadata.trimmed_sections.join(', ')}`);
          }
          if (result.metadata.dropped_sections.length > 0) {
            console.error(`dropped: ${result.metadata.dropped_sections.join(', ')}`);
          }
        }
        return;
      }

      // Task-id mode (legacy path).
      const rootPath = resolveProjectRoot();
      const taskId = targetText.toUpperCase();
      if (!opts.runner) fail('--runner is required when compiling a task packet');
      if (!opts.agentRole) fail('--agent-role is required when compiling a task packet');
      const runner = runnerTypeSchema.parse(opts.runner as string);
      const agentRole = String(opts.agentRole ?? '').trim();

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
  .option('--runner <runner>', 'codex|claude — comma-separated for a dual-runner pipeline (e.g. codex,claude)')
  .option('--agent-role <role>', 'planner|builder-ui|builder-app|reviewer|tester')
  .option('--dry-run', 'Prepare and compile only without executing external runner')
  .option('--json', 'Print machine-readable JSON output')
  .action(async (taskIdText, opts) => {
    const command = 'run';
    try {
      const rootPath = resolveProjectRoot();
      const defaults = loadRunnerPreferences(rootPath);
      const runnersRaw = typeof opts.runner === 'string' ? opts.runner : '';
      const runners = runnersRaw
        ? runnersRaw
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .map((s: string) => runnerTypeSchema.parse(s))
        : [defaults.default_runner];
      const selectedAgentRole = opts.agentRole
        ? agentRoleSchema.parse(opts.agentRole as string)
        : defaults.default_agent_role;
      const taskId = String(taskIdText).trim().toUpperCase();

      if (runners.length > 1) {
        const pipeline = await runPipelineExecution({
          rootPath,
          taskId,
          runners,
          agentRole: selectedAgentRole,
          dryRun: Boolean(opts.dryRun),
          streamOutput: opts.json ? 'stderr' : 'stdout',
        });
        const lines: string[] = [
          `Pipeline ${pipeline.pipeline_id} — ${pipeline.steps.length} runners for ${taskId}.`,
        ];
        pipeline.steps.forEach((r, i) => {
          lines.push(
            `  [${i + 1}/${pipeline.steps.length}] ${r.runner_type} (${r.agent_role}) → ${r.run_id} · ${r.status} · ${(r.duration_ms / 1000).toFixed(1)}s · changed ${r.changed_files.length}`,
          );
        });
        respondSuccess(command, Boolean(opts.json), pipeline, lines);
        return;
      }

      const result = await runTaskExecution({
        rootPath,
        taskId,
        runner: runners[0],
        agentRole: selectedAgentRole,
        dryRun: Boolean(opts.dryRun),
        streamOutput: opts.json ? 'stderr' : 'stdout',
      });

      respondSuccess(command, Boolean(opts.json), result, [
        `Prepared run ${result.run_id} for ${result.task_id}.`,
        `Runner: ${result.runner_type} (${result.agent_role})`,
        `Prompt: ${result.prompt_path}`,
        `Command: ${result.shell_command}`,
        `Status: ${result.status}`,
        `Summary: ${result.summary}`,
        `Changed files: ${result.changed_files.length}`,
        `Duration: ${(result.duration_ms / 1000).toFixed(1)}s`,
        `Log: ${result.log_path ?? 'n/a'}`,
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
    '\nExamples:\n  $ sidecar run T-001 --dry-run\n  $ sidecar run T-001 --runner claude --agent-role reviewer\n  $ sidecar run replay R-010 --edit-prompt\n  $ sidecar run replay R-010 --runner claude --reason "second opinion"\n  $ sidecar run queue\n  $ sidecar run start-ready --dry-run\n  $ sidecar run list --task T-001\n  $ sidecar run show R-001'
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
  .action(async (opts) => {
    const command = 'run start-ready';
    try {
      const rootPath = resolveProjectRoot();
      const queueDecisions = queueReadyTasks(rootPath);
      const queuedTasks = listTaskPackets(rootPath).filter((task) => task.status === 'queued');
      const results: Awaited<ReturnType<typeof runTaskExecution>>[] = [];
      for (const task of queuedTasks) {
        const result = await runTaskExecution({
          rootPath,
          taskId: task.task_id,
          dryRun: Boolean(opts.dryRun),
          streamOutput: opts.json ? 'stderr' : 'stdout',
        });
        results.push(result);
      }
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
  .command('replay <run-id>')
  .description('Replay an existing run as a new run on the same task')
  .option('--runner <runner>', 'Override the runner for the replay (codex|claude)')
  .option('--agent-role <role>', 'Override the agent role (planner|builder-ui|builder-app|reviewer|tester)')
  .option('--reason <text>', 'Why you are replaying (stored on the new run)')
  .option('--edit-prompt', 'Open the compiled prompt in $EDITOR before executing')
  .option('--dry-run', 'Prepare and compile only without executing external runners')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nExamples:\n  $ sidecar run replay R-010\n  $ sidecar run replay R-010 --runner claude --reason "second opinion"\n  $ sidecar run replay R-010 --edit-prompt\n  $ sidecar run replay R-010 --dry-run --json',
  )
  .action(async (runIdText, opts) => {
    const command = 'run replay';
    try {
      const rootPath = resolveProjectRoot();
      const parentRunId = String(runIdText).trim().toUpperCase();
      const parent = getRunRecord(rootPath, parentRunId);
      const runner = opts.runner ? runnerTypeSchema.parse(opts.runner) : parent.runner_type;
      const agentRole = opts.agentRole ? agentRoleSchema.parse(opts.agentRole) : parent.agent_role;
      const result = await runTaskExecution({
        rootPath,
        taskId: parent.task_id,
        runner,
        agentRole: agentRole as AgentRole,
        dryRun: Boolean(opts.dryRun),
        streamOutput: opts.json ? 'stderr' : 'stdout',
        parentRunId,
        replayReason: opts.reason ? String(opts.reason) : undefined,
        editPrompt: Boolean(opts.editPrompt),
      });
      respondSuccess(command, Boolean(opts.json), result, [
        `Replayed ${parentRunId} as ${result.run_id} (${result.status}).`,
        `Runner: ${result.runner_type} · Role: ${result.agent_role}`,
        ...(result.summary ? [result.summary] : []),
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

      const tableRows = rows.map((r) => ({
        run_id: r.run_id,
        task_id: r.task_id,
        status: r.status,
        started: humanTime(r.started_at),
      }));

      renderTable(
        [
          { key: 'run_id', label: 'RUN ID', minWidth: 6 },
          { key: 'task_id', label: 'TASK ID', minWidth: 7 },
          { key: 'status', label: 'STATUS', minWidth: 8, format: formatStatus },
          { key: 'started', label: 'STARTED', minWidth: 16 },
        ],
        tableRows
      );
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
      printRunHuman(runRecord);
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

function printRunHuman(run: {
  run_id: string;
  task_id: string;
  runner_type: string;
  agent_role: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string;
  changed_files: string[];
  validation: Array<{
    kind: string;
    command: string;
    name?: string;
    ok: boolean;
    timed_out: boolean;
    duration_ms: number;
    exit_code: number;
  }>;
  validation_results: string[];
  review_state: string;
  reviewed_by: string;
  review_note: string;
  blockers: string[];
  follow_ups: string[];
  parent_run_id: string | null;
  replay_reason: string;
}): void {
  console.log(`${c.bold(run.run_id)} — ${run.task_id} [${formatStatus(run.status)}]`);
  console.log(`Runner: ${run.runner_type} · Role: ${run.agent_role}`);
  console.log(`Started: ${humanTime(run.started_at)}${run.completed_at ? ` · Completed: ${humanTime(run.completed_at)}` : ''}`);
  if (run.parent_run_id) {
    const reason = run.replay_reason ? ` — ${run.replay_reason}` : '';
    console.log(`Replay of: ${c.cyan(run.parent_run_id)}${c.dim(reason)}`);
  }
  if (run.summary) console.log(`Summary: ${run.summary}`);

  // Show child replays if any (rooted lineage is rendered at the start of the tree).
  try {
    const rootPath = resolveProjectRoot();
    const children = listRunRecordsForTask(rootPath, run.task_id).filter((r) => r.parent_run_id === run.run_id);
    if (children.length > 0) {
      console.log(`Replayed as: ${children.map((r) => c.cyan(r.run_id)).join(', ')}`);
    }
  } catch {
    // ignore — lineage is a nice-to-have, not critical path
  }

  const isAuto = run.reviewed_by === 'sidecar:auto';
  const reviewLine = isAuto
    ? `Review: ${formatStatus(run.review_state)} ${c.dim('(auto-approved)')}`
    : `Review: ${formatStatus(run.review_state)}${run.reviewed_by ? ` by ${run.reviewed_by}` : ''}`;
  console.log(reviewLine);
  if (run.review_note) console.log(`  Note: ${run.review_note}`);

  if (run.validation.length > 0) {
    console.log('');
    console.log(c.bold('Validation:'));
    for (const v of run.validation) {
      const kindLabel = v.name ? `${v.kind}:${v.name}` : v.kind;
      const badge = v.ok ? c.green('✓ ok') : v.timed_out ? c.red('⏱ timed out') : c.red(`✗ failed (exit ${v.exit_code})`);
      const duration = `${(v.duration_ms / 1000).toFixed(1)}s`;
      console.log(`  ${c.cyan(`[${kindLabel}]`)} ${badge}  ${c.dim(duration)}  ${v.command}`);
    }
  } else if (run.validation_results.length > 0) {
    // Legacy pre-kind records — still show them.
    console.log('');
    console.log(c.bold('Validation (legacy):'));
    for (const line of run.validation_results) console.log(`  ${line}`);
  }

  if (run.changed_files.length > 0) {
    console.log('');
    console.log(c.bold(`Changed files (${run.changed_files.length}):`));
    for (const f of run.changed_files.slice(0, 20)) console.log(`  ${f}`);
    if (run.changed_files.length > 20) console.log(c.dim(`  … ${run.changed_files.length - 20} more`));
  }

  if (run.blockers.length > 0) {
    console.log('');
    console.log(c.bold('Blockers:'));
    for (const b of run.blockers) console.log(`  - ${b}`);
  }
  if (run.follow_ups.length > 0) {
    console.log('');
    console.log(c.bold('Follow-ups:'));
    for (const f of run.follow_ups) console.log(`  - ${f}`);
  }
}

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
        const typed = rows as Array<{ id: number; path: string; kind: string; note: string | null; created_at: string }>;
        if (typed.length === 0) {
          console.log('No artifacts found.');
          return;
        }
        renderTable(
          [
            { key: 'id', label: 'ID', align: 'right' },
            { key: 'kind', label: 'Kind' },
            { key: 'path', label: 'Path', maxWidth: 60 },
            { key: 'note', label: 'Note', maxWidth: 40 },
          ],
          typed.map((row) => ({
            id: `#${row.id}`,
            kind: row.kind,
            path: row.path,
            note: row.note ?? '',
          }))
        );
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

const hooks = program.command('hooks').description('Hook integration helpers');
hooks
  .command('print')
  .description('Print a Claude Code settings.json hooks block wiring ambient capture')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nCopy the output into .claude/settings.json (project) or ~/.claude/settings.json (user). Claude Code merges hook arrays across scopes.',
  )
  .action((opts) => {
    const command = 'hooks print';
    try {
      const json = renderClaudeCodeHooksJson();
      if (opts.json) {
        printJsonEnvelope(jsonSuccess(command, { settings_json: json }));
      } else {
        console.log(json);
      }
    } catch (err) {
      handleCommandError(command, Boolean(opts.json), err);
    }
  });

program
  .command('hook <event>')
  .description(`Ambient capture entry point for Claude Code / Codex hooks (event: ${HOOK_EVENTS.join('|')})`)
  .option('--actor-name <name>', 'Override the session actor_name (default: claude-code[:session])')
  .option('--json', 'Print machine-readable JSON output')
  .addHelpText(
    'after',
    '\nReads an optional JSON payload from stdin. Exit code is always 0 so hooks never block the caller — internal errors go to stderr.\n' +
      '\nExamples:\n' +
      '  $ echo \'{"session_id":"abc"}\' | sidecar hook session-start\n' +
      '  $ echo \'{"tool_name":"Edit","tool_input":{"file_path":"/abs/src/foo.ts"}}\' | sidecar hook file-edit\n' +
      '  $ sidecar hook session-end',
  )
  .action(async (eventArg: string, opts) => {
    const command = `hook ${eventArg}`;
    const asJson = Boolean(opts.json);
    try {
      const event = hookEventSchema.parse(eventArg);
      let payload: z.infer<typeof hookPayloadSchema> = {};
      if (!process.stdin.isTTY) {
        const raw = (await readStdinText()).trim();
        if (raw.length > 0) {
          try {
            payload = hookPayloadSchema.parse(JSON.parse(raw));
          } catch (parseErr) {
            const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            console.error(`sidecar hook: ignoring malformed payload (${msg})`);
          }
        }
      }
      const { db, projectId, rootPath } = requireInitialized();
      const result = handleHookEvent({
        db,
        projectId,
        projectRoot: rootPath,
        event,
        payload,
        ...(opts.actorName ? { actorName: String(opts.actorName) } : {}),
      });
      db.close();
      if (asJson) {
        printJsonEnvelope(jsonSuccess(command, result));
      }
      process.exit(0);
    } catch (err) {
      // Hooks must never block the caller — log to stderr and exit 0.
      const message = err instanceof Error ? err.message : String(err);
      if (asJson) {
        printJsonEnvelope(jsonSuccess(command, { ok: true, event: eventArg, action: 'skipped', detail: message }));
      } else {
        console.error(`sidecar hook: ${message}`);
      }
      process.exit(0);
    }
  });

program
  .command('log')
  .description('Memory namespace (alias group) — see `sidecar log --help`')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(() => {
    printNamespaceHelp('log');
  })
  .addHelpText(
    'after',
    `\nMembers:\n${LOG_NAMESPACE_MEMBERS.map((m) => `  sidecar log ${m}  →  sidecar ${m}`).join('\n')}\n`,
  );

program
  .command('work')
  .description('Runner namespace (alias group) — see `sidecar work --help`')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(() => {
    printNamespaceHelp('work');
  })
  .addHelpText(
    'after',
    `\nMembers:\n${WORK_NAMESPACE_MEMBERS.map((m) => `  sidecar work ${m}  →  sidecar ${m}`).join('\n')}\n`,
  );

// Rewrite `sidecar log <member> …` and `sidecar work <member> …` before
// commander sees argv, so the verb's existing subcommand tree handles the call
// verbatim (options, help, JSON envelopes, everything).
const rewrittenArgv = rewriteNamespaceArgv(process.argv);
if (rewrittenArgv !== process.argv) {
  process.argv.length = 0;
  process.argv.push(...rewrittenArgv);
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
  process.argv[3] !== 'summary' &&
  process.argv[3] !== 'replay'
) {
  process.argv.splice(2, 1, 'run-exec');
}

program.parse(process.argv);
