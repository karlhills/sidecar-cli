import type { RunnerAdapter, RunnerExecuteInput, RunnerExecutionResult, RunnerPrepareInput } from './runner-adapter.js';
import { buildPreparedCommand, runSpawn } from './runner-exec.js';

export class ClaudeRunnerAdapter implements RunnerAdapter {
  readonly runner = 'claude' as const;

  prepare(input: RunnerPrepareInput) {
    return buildPreparedCommand(input, 'claude', {
      command: 'claude',
      buildArgs: (prompt) => ['-p', prompt, '--permission-mode', 'acceptEdits'],
      shellLine: (_prompt, promptPath) => `claude -p "<prompt from ${promptPath}>"`,
    });
  }

  async execute(input: RunnerExecuteInput): Promise<RunnerExecutionResult> {
    return runSpawn(input, 'claude', 'Claude');
  }

  collectResult(result: RunnerExecutionResult): RunnerExecutionResult {
    return result;
  }
}
