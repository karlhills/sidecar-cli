import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const VALIDATION_KINDS = ['typecheck', 'lint', 'test', 'build', 'custom'] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];

// Per-kind default timeouts. `custom` keeps the historical 5-minute budget; tests/builds
// get a longer default because they're the common cause of the 5m ceiling biting.
export const DEFAULT_VALIDATION_TIMEOUT_MS: Record<ValidationKind, number> = {
  typecheck: 3 * 60 * 1000,
  lint: 3 * 60 * 1000,
  test: 10 * 60 * 1000,
  build: 10 * 60 * 1000,
  custom: 5 * 60 * 1000,
};

export interface ValidationStep {
  kind: ValidationKind;
  command: string;
  name?: string;
  timeout_ms?: number;
}

export interface ValidationResult {
  kind: ValidationKind;
  command: string;
  name?: string;
  exitCode: number;
  ok: boolean;
  timedOut: boolean;
  durationMs: number;
  timeoutMs: number;
  outputSnippet: string;
}

export interface WorkingTreeSnapshot {
  trackedRef: string | null;
  untracked: string[];
}

const KILL_GRACE_MS = 5 * 1000;
const SNIPPET_LIMIT = 1000;

export function isValidationKind(value: unknown): value is ValidationKind {
  return typeof value === 'string' && (VALIDATION_KINDS as readonly string[]).includes(value);
}

export function normalizeValidationStep(entry: string | Partial<ValidationStep>): ValidationStep | null {
  if (typeof entry === 'string') {
    const raw = entry.trim();
    if (raw.length === 0) return null;
    // Support "kind:command" shorthand — but only when the prefix before the first
    // colon is a known kind. Anything else (URLs, paths, env vars, bash substitutions)
    // falls through as a plain custom command.
    // Also accepts "kind@<duration>:command" where <duration> is "30s", "2m", or "1500ms"
    // to override the per-kind default timeout.
    const colonIdx = raw.indexOf(':');
    if (colonIdx > 0) {
      const prefix = raw.slice(0, colonIdx).trim();
      const rest = raw.slice(colonIdx + 1).trim();
      const atIdx = prefix.indexOf('@');
      if (atIdx > 0) {
        const kindPart = prefix.slice(0, atIdx).trim();
        const durationPart = prefix.slice(atIdx + 1).trim();
        if (isValidationKind(kindPart) && rest.length > 0) {
          const parsed = parseDurationToMs(durationPart);
          const step: ValidationStep = { kind: kindPart, command: rest };
          if (parsed != null) step.timeout_ms = parsed;
          return step;
        }
      }
      if (isValidationKind(prefix) && rest.length > 0) {
        return { kind: prefix, command: rest };
      }
    }
    return { kind: 'custom', command: raw };
  }
  if (!entry || typeof entry !== 'object') return null;
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  if (command.length === 0) return null;
  const kind = isValidationKind(entry.kind) ? entry.kind : 'custom';
  const step: ValidationStep = { kind, command };
  if (typeof entry.name === 'string' && entry.name.trim().length > 0) step.name = entry.name.trim();
  const rawTimeout =
    typeof entry.timeout_ms === 'number'
      ? entry.timeout_ms
      : typeof (entry as { timeoutMs?: number }).timeoutMs === 'number'
        ? (entry as { timeoutMs?: number }).timeoutMs
        : undefined;
  if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0) {
    step.timeout_ms = Math.floor(rawTimeout);
  }
  return step;
}

export function resolveValidationTimeoutMs(step: ValidationStep): number {
  if (typeof step.timeout_ms === 'number' && step.timeout_ms > 0) return step.timeout_ms;
  return DEFAULT_VALIDATION_TIMEOUT_MS[step.kind];
}

// Parse "30s", "2m", "1500ms" → milliseconds. Returns null on unknown format.
export function parseDurationToMs(raw: string): number | null {
  const match = /^(\d+)(ms|s|m)$/i.exec(raw.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'ms') return value;
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60 * 1000;
  return null;
}

export async function captureHeadSha(cwd: string): Promise<string | null> {
  try {
    const { stdout, exitCode } = await runGit(cwd, ['rev-parse', 'HEAD']);
    if (exitCode !== 0) return null;
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function captureWorkingTreeSnapshot(cwd: string): Promise<WorkingTreeSnapshot> {
  let trackedRef: string | null = null;
  try {
    const stash = await runGit(cwd, ['stash', 'create']);
    const candidate = stash.exitCode === 0 ? stash.stdout.trim() : '';
    if (candidate.length > 0) {
      trackedRef = candidate;
    } else {
      const head = await runGit(cwd, ['rev-parse', 'HEAD']);
      if (head.exitCode === 0) {
        const h = head.stdout.trim();
        trackedRef = h.length > 0 ? h : null;
      }
    }
  } catch {
    trackedRef = null;
  }

  const untracked = await listUntracked(cwd);
  return { trackedRef, untracked };
}

export async function captureFilesChangedSince(cwd: string, snapshot: WorkingTreeSnapshot): Promise<string[]> {
  const files = new Set<string>();

  if (snapshot.trackedRef) {
    try {
      const { stdout, exitCode } = await runGit(cwd, ['diff', '--name-only', snapshot.trackedRef]);
      if (exitCode === 0) {
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length > 0) files.add(trimmed);
        }
      }
    } catch {
      // ignore
    }
  }

  const untrackedNow = await listUntracked(cwd);
  const before = new Set(snapshot.untracked);
  for (const f of untrackedNow) {
    if (!before.has(f)) files.add(f);
  }

  return dedupeSort(Array.from(files));
}

async function listUntracked(cwd: string): Promise<string[]> {
  try {
    const { stdout, exitCode } = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']);
    if (exitCode !== 0) return [];
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

export async function captureChangedFiles(cwd: string, sinceRef?: string): Promise<string[]> {
  try {
    if (sinceRef && sinceRef.length > 0) {
      const { stdout, exitCode } = await runGit(cwd, ['diff', '--name-only', sinceRef]);
      if (exitCode !== 0) return [];
      return dedupeSort(
        stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    }

    const { stdout, exitCode } = await runGit(cwd, ['status', '--porcelain']);
    if (exitCode !== 0) return [];

    const files: string[] = [];
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.length === 0) continue;
      const payload = line.length > 3 ? line.slice(3) : '';
      if (payload.length === 0) continue;
      const arrowIdx = payload.indexOf(' -> ');
      const path = arrowIdx >= 0 ? payload.slice(arrowIdx + 4) : payload;
      const unquoted = unquoteGitPath(path.trim());
      if (unquoted.length > 0) files.push(unquoted);
    }
    return dedupeSort(files);
  } catch {
    return [];
  }
}

export async function runValidationCommands(
  cwd: string,
  steps: ValidationStep[],
  logPath?: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  if (logPath) ensureLogDir(logPath);

  for (const step of steps) {
    const result = await runOneValidation(cwd, step, logPath);
    results.push(result);
  }
  return results;
}

export function formatValidationResultsForRecord(results: ValidationResult[]): string[] {
  if (results.length === 0) return [];
  return results.map((r) => {
    const label = r.name ? `${r.kind}:${r.name}` : r.kind;
    if (r.timedOut) return `${label} (${r.command}): timed out (${r.durationMs}ms)`;
    return r.ok
      ? `${label} (${r.command}): ok (${r.durationMs}ms)`
      : `${label} (${r.command}): failed (exit ${r.exitCode}, ${r.durationMs}ms)`;
  });
}

async function runOneValidation(
  cwd: string,
  step: ValidationStep,
  logPath?: string,
): Promise<ValidationResult> {
  const start = Date.now();
  const timeoutMs = resolveValidationTimeoutMs(step);
  const { kind, command, name } = step;
  try {
    if (logPath) {
      const label = name ? `${kind}:${name}` : kind;
      appendFileSync(logPath, `\n\n--- validation [${label}]: ${command} ---\n`);
    }

    return await new Promise<ValidationResult>((resolve) => {
      let child;
      try {
        child = spawn(command, {
          cwd,
          shell: true,
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        resolve({
          kind,
          command,
          ...(name ? { name } : {}),
          exitCode: -1,
          ok: false,
          timedOut: false,
          durationMs: Date.now() - start,
          timeoutMs,
          outputSnippet: errorMessage(err),
        });
        return;
      }

      let buffer = '';
      let timedOut = false;
      let killTimer: NodeJS.Timeout | null = null;
      let settled = false;

      const appendToBuffer = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.length > SNIPPET_LIMIT * 4) {
          buffer = buffer.slice(buffer.length - SNIPPET_LIMIT * 4);
        }
      };

      const teeToLog = (chunk: Buffer) => {
        if (!logPath) return;
        try {
          appendFileSync(logPath, chunk);
        } catch {
          // ignore log write errors
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        appendToBuffer(chunk);
        teeToLog(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        appendToBuffer(chunk);
        teeToLog(chunk);
      });

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, KILL_GRACE_MS);
      }, timeoutMs);

      const finalize = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        const durationMs = Date.now() - start;
        let snippet = buffer.length > SNIPPET_LIMIT ? buffer.slice(buffer.length - SNIPPET_LIMIT) : buffer;
        snippet = snippet.trim();
        if (timedOut) {
          const marker = `[timed out after ${Math.round(timeoutMs / 1000)}s]`;
          snippet = snippet.length > 0 ? `${snippet}\n${marker}` : marker;
          resolve({
            kind,
            command,
            ...(name ? { name } : {}),
            exitCode: 124,
            ok: false,
            timedOut: true,
            durationMs,
            timeoutMs,
            outputSnippet: snippet,
          });
          return;
        }
        resolve({
          kind,
          command,
          ...(name ? { name } : {}),
          exitCode,
          ok: exitCode === 0,
          timedOut: false,
          durationMs,
          timeoutMs,
          outputSnippet: snippet,
        });
      };

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        resolve({
          kind,
          command,
          ...(name ? { name } : {}),
          exitCode: -1,
          ok: false,
          timedOut: false,
          durationMs: Date.now() - start,
          timeoutMs,
          outputSnippet: errorMessage(err),
        });
      });

      child.on('close', (code, signal) => {
        const exitCode = typeof code === 'number' ? code : signal ? 128 : -1;
        finalize(exitCode);
      });
    });
  } catch (err) {
    return {
      kind,
      command,
      ...(name ? { name } : {}),
      exitCode: -1,
      ok: false,
      timedOut: false,
      durationMs: Date.now() - start,
      timeoutMs,
      outputSnippet: errorMessage(err),
    };
  }
}

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      resolve({ stdout: '', stderr: errorMessage(err), exitCode: -1 });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: stderr + errorMessage(err), exitCode: -1 });
    });
    child.on('close', (code, signal) => {
      const exitCode = typeof code === 'number' ? code : signal ? 128 : -1;
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function dedupeSort(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

function unquoteGitPath(path: string): string {
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    const inner = path.slice(1, -1);
    return inner.replace(/\\(.)/g, '$1');
  }
  return path;
}

function ensureLogDir(logPath: string): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {
    // ignore
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
