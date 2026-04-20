import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadRunnerPreferences, type RunnerCommandOverride } from './config.js';
import type { RunnerExecuteInput, RunnerExecutionResult, RunnerPrepareInput, RunnerPreparedCommand } from './runner-adapter.js';
import type { RunnerType } from '../runs/run-record.js';

export interface PrepareDefaults {
  command: string;
  buildArgs: (prompt: string, promptPath: string, role: string) => string[];
  shellLine: (prompt: string, promptPath: string, role: string) => string;
}

export function buildPreparedCommand(
  input: RunnerPrepareInput,
  runner: RunnerType,
  defaults: PrepareDefaults,
): RunnerPreparedCommand {
  const prompt = readPromptFile(input.promptPath);
  const override = loadOverride(input.projectRoot, runner);

  if (override) {
    const command = override.command ?? defaults.command;
    const args = override.args
      ? override.args.map((a) => substituteTokens(a, prompt, input.promptPath, input.agentRole))
      : defaults.buildArgs(prompt, input.promptPath, input.agentRole);
    return {
      command,
      args,
      shellLine: defaults.shellLine(prompt, input.promptPath, input.agentRole),
    };
  }

  return {
    command: defaults.command,
    args: defaults.buildArgs(prompt, input.promptPath, input.agentRole),
    shellLine: defaults.shellLine(prompt, input.promptPath, input.agentRole),
  };
}

function readPromptFile(promptPath: string): string {
  try {
    return fs.readFileSync(promptPath, 'utf8');
  } catch {
    return '';
  }
}

function loadOverride(projectRoot: string, runner: RunnerType): RunnerCommandOverride | undefined {
  try {
    const prefs = loadRunnerPreferences(projectRoot);
    return prefs.runner_commands?.[runner];
  } catch {
    return undefined;
  }
}

function substituteTokens(value: string, prompt: string, promptPath: string, role: string): string {
  return value
    .replace(/\{\{prompt\}\}/g, prompt)
    .replace(/\{\{promptPath\}\}/g, promptPath)
    .replace(/\{\{role\}\}/g, role);
}

export async function runSpawn(
  input: RunnerExecuteInput,
  runner: RunnerType,
  runnerLabel: string,
): Promise<RunnerExecutionResult> {
  if (input.dryRun) {
    return {
      ok: true,
      executed: false,
      exitCode: 0,
      summary: `Dry run: prepared ${runnerLabel} command only.`,
      commandsRun: [input.prepared.shellLine],
      validationResults: ['dry-run'],
      blockers: [],
      followUps: [],
      durationMs: 0,
    };
  }

  const started = Date.now();
  const header = `# ${runner} run at ${new Date().toISOString()}\n# cmd: ${input.prepared.shellLine}\n# cwd: ${input.cwd}\n\n`;

  let logStream: fs.WriteStream | null = null;
  try {
    fs.mkdirSync(path.dirname(input.logPath), { recursive: true });
    logStream = fs.createWriteStream(input.logPath, { flags: 'w' });
    logStream.write(header);
  } catch {
    logStream = null;
  }

  const env = { ...process.env, ...(input.env ?? {}) };

  try {
    const child = spawn(input.prepared.command, input.prepared.args, {
      cwd: input.cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const streamTarget = input.streamOutput ?? 'stdout';
    const stdoutSink =
      streamTarget === 'stdout'
        ? process.stdout
        : streamTarget === 'stderr'
          ? process.stderr
          : null;
    const stderrSink = streamTarget === 'none' ? null : process.stderr;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutSink?.write(chunk);
      logStream?.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrSink?.write(chunk);
      logStream?.write(chunk);
    });

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code === null ? -1 : code));
    });

    const durationMs = Date.now() - started;
    logStream?.end();

    const seconds = Math.round(durationMs / 1000);
    if (exitCode === 0) {
      return {
        ok: true,
        executed: true,
        exitCode,
        summary: `${runnerLabel} run completed (exit 0) in ${seconds}s.`,
        commandsRun: [input.prepared.shellLine],
        validationResults: [],
        blockers: [],
        followUps: [],
        logPath: input.logPath,
        durationMs,
      };
    }

    return {
      ok: false,
      executed: true,
      exitCode,
      summary: `${runnerLabel} run failed (exit ${exitCode}) in ${seconds}s. See log: ${input.logPath}`,
      commandsRun: [input.prepared.shellLine],
      validationResults: [],
      blockers: [`runner exited with code ${exitCode}`],
      followUps: [],
      logPath: input.logPath,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    try {
      logStream?.write(`\n# spawn error: ${message}\n`);
      logStream?.end();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      executed: false,
      exitCode: -1,
      summary: `Failed to launch ${runnerLabel}: ${message}`,
      commandsRun: [input.prepared.shellLine],
      validationResults: [],
      blockers: [message],
      followUps: [`Install the ${runnerLabel} CLI or override the command in .sidecar/preferences.json`],
      logPath: input.logPath,
      durationMs,
    };
  }
}
