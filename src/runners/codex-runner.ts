import type { RunnerAdapter, RunnerExecuteInput, RunnerExecutionResult, RunnerPrepareInput } from './runner-adapter.js';
import { buildPreparedCommand, runSpawn } from './runner-exec.js';

export class CodexRunnerAdapter implements RunnerAdapter {
  readonly runner = 'codex' as const;

  prepare(input: RunnerPrepareInput) {
    return buildPreparedCommand(input, 'codex', {
      command: 'codex',
      buildArgs: (prompt) => ['exec', prompt],
      shellLine: (_prompt, promptPath) => `codex exec "<prompt from ${promptPath}>"`,
    });
  }

  async execute(input: RunnerExecuteInput): Promise<RunnerExecutionResult> {
    return runSpawn(input, 'codex', 'Codex');
  }

  collectResult(result: RunnerExecutionResult): RunnerExecutionResult {
    return result;
  }
}
