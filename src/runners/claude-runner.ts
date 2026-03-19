import type { RunnerAdapter, RunnerExecuteInput, RunnerExecutionResult, RunnerPrepareInput } from './runner-adapter.js';

export class ClaudeRunnerAdapter implements RunnerAdapter {
  readonly runner = 'claude' as const;

  prepare(input: RunnerPrepareInput) {
    const args = ['run', '--prompt-file', input.promptPath, '--role', input.agentRole];
    return {
      command: 'claude',
      args,
      shellLine: `claude ${args.join(' ')}`,
    };
  }

  execute(input: RunnerExecuteInput): RunnerExecutionResult {
    if (input.dryRun) {
      return {
        ok: true,
        executed: false,
        exitCode: 0,
        summary: 'Dry run: prepared Claude command only.',
        commandsRun: [input.prepared.shellLine],
        validationResults: ['dry-run'],
        blockers: [],
        followUps: [],
      };
    }

    return {
      ok: true,
      executed: false,
      exitCode: 0,
      summary: 'Prepared Claude command. Live execution is placeholder behavior in v1.',
      commandsRun: [input.prepared.shellLine],
      validationResults: ['runner execute placeholder'],
      blockers: [],
      followUps: ['Integrate real Claude command execution in runner adapter.'],
    };
  }

  collectResult(result: RunnerExecutionResult): RunnerExecutionResult {
    return result;
  }
}
