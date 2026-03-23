import { nowIso } from '../lib/format.js';
import { compileTaskPrompt } from '../prompts/prompt-service.js';
import { getTaskPacket } from '../tasks/task-service.js';
import { getRunnerAdapter } from '../runners/factory.js';
import { loadRunnerPreferences, type AgentRole } from '../runners/config.js';
import { updateRunRecordEntry } from '../runs/run-service.js';
import type { RunnerType } from '../runs/run-record.js';
import { saveTaskPacket } from '../tasks/task-service.js';

export interface RunTaskInput {
  rootPath: string;
  taskId: string;
  runner?: RunnerType;
  agentRole?: AgentRole;
  dryRun?: boolean;
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
}

export function runTaskExecution(input: RunTaskInput): RunTaskResult {
  const prefs = loadRunnerPreferences(input.rootPath);
  const dryRun = Boolean(input.dryRun);

  const task = getTaskPacket(input.rootPath, input.taskId);
  const runner = input.runner ?? task.tracking.assigned_runner ?? prefs.default_runner;
  const agentRole = input.agentRole ?? task.tracking.assigned_agent_role ?? prefs.default_agent_role;
  const compiled = compileTaskPrompt({
    rootPath: input.rootPath,
    taskId: task.task_id,
    runner,
    agentRole,
  });

  const adapter = getRunnerAdapter(runner);
  saveTaskPacket(input.rootPath, { ...task, status: 'running' });
  updateRunRecordEntry(input.rootPath, compiled.run_id, {
    status: 'running',
    branch: task.tracking.branch,
    worktree: task.tracking.worktree || input.rootPath,
  });

  const prepared = adapter.prepare({
    runId: compiled.run_id,
    taskId: task.task_id,
    agentRole,
    promptPath: compiled.prompt_path,
    projectRoot: input.rootPath,
  });

  const executed = adapter.execute({ prepared, dryRun });
  const collected = adapter.collectResult(executed);
  const finishedStatus = collected.ok ? 'completed' : 'failed';
  const nextTaskStatus = collected.ok ? 'review' : 'blocked';

  saveTaskPacket(input.rootPath, { ...getTaskPacket(input.rootPath, task.task_id), status: nextTaskStatus });

  updateRunRecordEntry(input.rootPath, compiled.run_id, {
    status: finishedStatus,
    completed_at: nowIso(),
    summary: collected.summary,
    commands_run: collected.commandsRun,
    validation_results: collected.validationResults,
    blockers: collected.blockers,
    follow_ups: collected.followUps,
  });

  return {
    task_id: task.task_id,
    run_id: compiled.run_id,
    runner_type: runner,
    agent_role: agentRole,
    prompt_path: compiled.prompt_path,
    status: finishedStatus,
    dry_run: dryRun,
    shell_command: prepared.shellLine,
    summary: collected.summary,
  };
}
