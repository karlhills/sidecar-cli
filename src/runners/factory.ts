import { SidecarError } from '../lib/errors.js';
import type { RunnerType } from '../runs/run-record.js';
import type { RunnerAdapter } from './runner-adapter.js';
import { CodexRunnerAdapter } from './codex-runner.js';
import { ClaudeRunnerAdapter } from './claude-runner.js';

export function getRunnerAdapter(runner: RunnerType): RunnerAdapter {
  if (runner === 'codex') return new CodexRunnerAdapter();
  if (runner === 'claude') return new ClaudeRunnerAdapter();
  throw new SidecarError(`Unsupported runner: ${runner}`);
}
