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

export interface RunnerExecuteInput {
  prepared: RunnerPreparedCommand;
  dryRun: boolean;
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
}

export interface RunnerAdapter {
  readonly runner: RunnerType;
  prepare(input: RunnerPrepareInput): RunnerPreparedCommand;
  execute(input: RunnerExecuteInput): RunnerExecutionResult;
  collectResult(result: RunnerExecutionResult): RunnerExecutionResult;
}
