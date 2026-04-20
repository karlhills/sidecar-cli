import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { nowIso } from '../lib/format.js';
import { compileTaskPrompt } from '../prompts/prompt-service.js';
import { getTaskPacket } from '../tasks/task-service.js';
import { getRunnerAdapter } from '../runners/factory.js';
import { loadRunnerPreferences, loadReviewPreferences, type AgentRole } from '../runners/config.js';
import { getRunRecord, updateRunRecordEntry } from '../runs/run-service.js';
import type { RunnerType, RunValidationEntry } from '../runs/run-record.js';
import type { PreviousRunSummary, PromptLinkedContext } from '../prompts/packet-sections.js';
import type { RunnerStreamTarget } from '../runners/runner-adapter.js';
import { saveTaskPacket } from '../tasks/task-service.js';
import {
  captureWorkingTreeSnapshot,
  captureFilesChangedSince,
  runValidationCommands,
  formatValidationResultsForRecord,
  normalizeValidationStep,
  type ValidationStep,
  type ValidationResult,
} from '../runs/capture.js';

export interface RunTaskInput {
  rootPath: string;
  taskId: string;
  runner?: RunnerType;
  agentRole?: AgentRole;
  dryRun?: boolean;
  streamOutput?: RunnerStreamTarget;
  parentRunId?: string;
  replayReason?: string;
  editPrompt?: boolean;
  linkedContext?: PromptLinkedContext;
  pipelineId?: string;
  pipelineStep?: number;
  pipelineTotal?: number;
}

export interface RunPipelineInput {
  rootPath: string;
  taskId: string;
  runners: RunnerType[];
  agentRole?: AgentRole;
  dryRun?: boolean;
  streamOutput?: RunnerStreamTarget;
  editPrompt?: boolean;
}

export interface RunPipelineResult {
  pipeline_id: string;
  steps: RunTaskResult[];
}

export interface RunTaskResult {
  task_id: string;
  run_id: string;
  runner_type: RunnerType;
  agent_role: AgentRole;
  prompt_path: string;
  status: 'completed' | 'failed';
  dry_run: boolean;
  shell_command: string;
  summary: string;
  changed_files: string[];
  log_path: string | null;
  duration_ms: number;
}

// Open the compiled prompt in the user's editor before executing. Blocks the run until the
// editor exits so the runner reads the saved edits. Falls back silently if no editor is
// available or the spawn fails — the run proceeds with the unedited prompt.
async function openPromptInEditor(promptPath: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  console.error(`Opening prompt in ${editor}: ${promptPath}`);
  console.error('Save and exit the editor to continue the run.');
  await new Promise<void>((resolve) => {
    try {
      const child = spawn(editor, [promptPath], { stdio: 'inherit' });
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

function toRunValidationEntry(r: ValidationResult): RunValidationEntry {
  return {
    kind: r.kind,
    command: r.command,
    ...(r.name ? { name: r.name } : {}),
    exit_code: r.exitCode,
    ok: r.ok,
    timed_out: r.timedOut,
    duration_ms: r.durationMs,
    timeout_ms: r.timeoutMs,
    output_snippet: r.outputSnippet,
  };
}

export async function runTaskExecution(input: RunTaskInput): Promise<RunTaskResult> {
  const prefs = loadRunnerPreferences(input.rootPath);
  const dryRun = Boolean(input.dryRun);

  const task = getTaskPacket(input.rootPath, input.taskId);
  const runner = input.runner ?? task.tracking.assigned_runner ?? prefs.default_runner;
  const agentRole = input.agentRole ?? task.tracking.assigned_agent_role ?? prefs.default_agent_role;

  const worktree = (task.tracking.worktree ?? '').trim();
  let cwd: string;
  if (worktree.length > 0) {
    if (!fs.existsSync(worktree)) {
      throw new Error(
        `Task ${task.task_id} tracking.worktree points to ${worktree} but the directory does not exist.`,
      );
    }
    cwd = worktree;
  } else {
    cwd = input.rootPath;
  }

  const compiled = compileTaskPrompt({
    rootPath: input.rootPath,
    taskId: task.task_id,
    runner,
    agentRole,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.replayReason ? { replayReason: input.replayReason } : {}),
    ...(input.linkedContext ? { linkedContext: input.linkedContext } : {}),
    ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
    ...(input.pipelineStep ? { pipelineStep: input.pipelineStep } : {}),
    ...(input.pipelineTotal ? { pipelineTotal: input.pipelineTotal } : {}),
  });

  if (input.editPrompt && !dryRun) {
    await openPromptInEditor(compiled.prompt_path);
  }

  const logPath = path.resolve(
    path.join(input.rootPath, '.sidecar', 'runs', 'logs', `${compiled.run_id}.log`),
  );

  const adapter = getRunnerAdapter(runner);
  saveTaskPacket(input.rootPath, { ...task, status: 'running' });
  updateRunRecordEntry(input.rootPath, compiled.run_id, {
    status: 'running',
    branch: task.tracking.branch,
    worktree: cwd,
  });

  const prepared = adapter.prepare({
    runId: compiled.run_id,
    taskId: task.task_id,
    agentRole,
    promptPath: compiled.prompt_path,
    projectRoot: input.rootPath,
  });

  const preRunSnapshot = !dryRun ? await captureWorkingTreeSnapshot(cwd) : null;

  const executed = await adapter.execute({
    prepared,
    dryRun,
    cwd,
    logPath,
    streamOutput: input.streamOutput,
  });
  const collected = adapter.collectResult(executed);

  let ok = collected.ok;
  const blockers = [...collected.blockers];
  let validationResults = collected.validationResults;
  let validationEntries: RunValidationEntry[] = [];
  let validationFailed = false;
  let validationAttempted = false;

  let changedFiles: string[] = [];
  if (!dryRun && collected.executed && preRunSnapshot) {
    changedFiles = await captureFilesChangedSince(cwd, preRunSnapshot);
  }

  if (!dryRun && collected.executed && ok) {
    const configured = task.execution?.commands?.validation ?? [];
    const steps: ValidationStep[] = [];
    for (const entry of configured) {
      const normalized = normalizeValidationStep(entry as string | Partial<ValidationStep>);
      if (normalized) steps.push(normalized);
    }
    if (steps.length > 0) {
      validationAttempted = true;
      const results = await runValidationCommands(cwd, steps, logPath);
      validationResults = formatValidationResultsForRecord(results);
      validationEntries = results.map(toRunValidationEntry);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        validationFailed = true;
        ok = false;
        for (const f of failed) {
          blockers.push(`validation failed (${f.kind}): ${f.command}`);
        }
      }
    }
  }

  const finishedStatus = ok ? 'completed' : 'failed';
  const nextTaskStatus = ok ? 'review' : 'blocked';

  // Auto-approve on all-green is opt-in via preferences. We only auto-approve when at least
  // one validation step actually ran and every step passed — a runner-only success with no
  // validation configured still requires a human click.
  const reviewPrefs = loadReviewPreferences(input.rootPath);
  const shouldAutoApprove =
    reviewPrefs.auto_approve_on_all_green && ok && validationAttempted && validationEntries.every((e) => e.ok);

  saveTaskPacket(input.rootPath, {
    ...getTaskPacket(input.rootPath, task.task_id),
    status: nextTaskStatus,
  });

  updateRunRecordEntry(input.rootPath, compiled.run_id, {
    status: finishedStatus,
    completed_at: nowIso(),
    summary: collected.summary,
    commands_run: collected.commandsRun,
    validation_results: validationResults,
    validation: validationEntries,
    blockers,
    follow_ups: collected.followUps,
    changed_files: changedFiles,
    ...(shouldAutoApprove
      ? {
          review_state: 'approved' as const,
          reviewed_at: nowIso(),
          reviewed_by: 'sidecar:auto',
          review_note: `Auto-approved: ${validationEntries.length} validation step(s) passed`,
        }
      : {}),
  });

  const summary = validationFailed
    ? `Runner ok, but validation failed. ${collected.summary}`
    : collected.summary;

  return {
    task_id: task.task_id,
    run_id: compiled.run_id,
    runner_type: runner,
    agent_role: agentRole,
    prompt_path: compiled.prompt_path,
    status: finishedStatus,
    dry_run: dryRun,
    shell_command: prepared.shellLine,
    summary,
    changed_files: changedFiles,
    log_path: dryRun ? null : logPath,
    duration_ms: executed.durationMs ?? 0,
  };
}

function generatePipelineId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `PL-${ts}-${rand}`;
}

function tailLogFile(logPath: string | null, maxChars: number): string {
  if (!logPath) return '';
  try {
    const raw = fs.readFileSync(logPath, 'utf8');
    return raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw;
  } catch {
    return '';
  }
}

function summarizeRunForPipeline(rootPath: string, step: RunTaskResult): PreviousRunSummary {
  let validationSummary: string | undefined;
  try {
    const record = getRunRecord(rootPath, step.run_id);
    const v = record.validation ?? [];
    if (v.length > 0) {
      const ok = v.filter((x) => x.ok).length;
      const failed = v.filter((x) => !x.ok && !x.timed_out).length;
      const timed = v.filter((x) => x.timed_out).length;
      const parts = [`${ok}/${v.length} ok`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (timed > 0) parts.push(`${timed} timed-out`);
      validationSummary = parts.join(', ');
    }
  } catch {
    // missing record shouldn't block the next step — leave summary blank
  }
  return {
    run_id: step.run_id,
    runner: step.runner_type,
    agent_role: step.agent_role,
    status: step.status,
    summary: step.summary,
    changed_files: step.changed_files,
    ...(validationSummary ? { validation_summary: validationSummary } : {}),
    log_tail: tailLogFile(step.log_path, 1500),
  };
}

// Sequential dual-runner pipeline. Each step sees all prior steps' summaries
// (run id, runner, validation outcome, changed files, log tail) as
// `previous_runs` linked context on its compiled prompt. Runs share a
// `pipeline_id` and carry 1-based `pipeline_step` + `pipeline_total` so the
// chain is reconstructable. A step that fails does NOT short-circuit the
// pipeline — downstream runners may be set up explicitly to fix failures.
export async function runPipelineExecution(input: RunPipelineInput): Promise<RunPipelineResult> {
  if (input.runners.length === 0) throw new Error('runPipelineExecution requires at least one runner');
  const pipelineId = generatePipelineId();
  const steps: RunTaskResult[] = [];

  for (let i = 0; i < input.runners.length; i++) {
    const runner = input.runners[i];
    const previousRuns = steps.map((s) => summarizeRunForPipeline(input.rootPath, s));
    const linkedContext: PromptLinkedContext | undefined =
      previousRuns.length > 0 ? { previous_runs: previousRuns } : undefined;

    const stepResult = await runTaskExecution({
      rootPath: input.rootPath,
      taskId: input.taskId,
      runner,
      ...(input.agentRole ? { agentRole: input.agentRole } : {}),
      ...(input.dryRun != null ? { dryRun: input.dryRun } : {}),
      ...(input.streamOutput ? { streamOutput: input.streamOutput } : {}),
      ...(input.editPrompt != null ? { editPrompt: input.editPrompt } : {}),
      ...(linkedContext ? { linkedContext } : {}),
      pipelineId,
      pipelineStep: i + 1,
      pipelineTotal: input.runners.length,
    });
    steps.push(stepResult);
  }

  return { pipeline_id: pipelineId, steps };
}
