import type { RunnerType } from '../runs/run-record.js';

export interface RunnerPrepareInput {
  runId: string;
  taskId: string;
  agentRole: string;
  promptPath: string;
  projectRoot: string;
}

export interface RunnerPreparedCommand {
  command: string;
  args: string[];
  shellLine: string;
}

export type RunnerStreamTarget = 'stdout' | 'stderr' | 'none';

export interface RunnerExecuteInput {
  prepared: RunnerPreparedCommand;
  dryRun: boolean;
  cwd: string;
  logPath: string;
  env?: Record<string, string>;
  streamOutput?: RunnerStreamTarget;
}

export interface RunnerExecutionResult {
  ok: boolean;
  executed: boolean;
  exitCode: number;
  summary: string;
  commandsRun: string[];
  validationResults: string[];
  blockers: string[];
  followUps: string[];
  logPath?: string;
  durationMs?: number;
}

export interface RunnerAdapter {
  readonly runner: RunnerType;
  prepare(input: RunnerPrepareInput): RunnerPreparedCommand;
  execute(input: RunnerExecuteInput): Promise<RunnerExecutionResult>;
  collectResult(result: RunnerExecutionResult): RunnerExecutionResult;
}
