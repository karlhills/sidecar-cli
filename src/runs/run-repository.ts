import fs from 'node:fs';
import path from 'node:path';
import { getSidecarPaths } from '../lib/paths.js';
import { SidecarError } from '../lib/errors.js';
import { stringifyJson } from '../lib/format.js';
import {
  createRunRecord,
  runRecordCreateInputSchema,
  runRecordSchema,
  runRecordUpdateInputSchema,
  type RunRecord,
  type RunRecordCreateInput,
  type RunRecordUpdateInput,
} from './run-record.js';

function runFilePath(runsPath: string, runId: string): string {
  return path.join(runsPath, `${runId}.json`);
}

function parseRunOrdinal(runId: string): number {
  const match = /^R-(\d+)$/.exec(runId);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export class RunRecordRepository {
  constructor(private readonly rootPath: string) {}

  get runsPath(): string {
    return getSidecarPaths(this.rootPath).runsPath;
  }

  ensureStorage(): void {
    fs.mkdirSync(this.runsPath, { recursive: true });
  }

  generateNextRunId(): string {
    this.ensureStorage();
    const files = fs.readdirSync(this.runsPath, { withFileTypes: true });
    let max = 0;
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      const id = file.name.slice(0, -'.json'.length);
      max = Math.max(max, parseRunOrdinal(id));
    }
    return `R-${String(max + 1).padStart(3, '0')}`;
  }

  create(input: RunRecordCreateInput): { run: RunRecord; path: string } {
    const parsed = runRecordCreateInputSchema.parse(input);
    const runId = this.generateNextRunId();
    const run = createRunRecord(runId, parsed);
    const filePath = runFilePath(this.runsPath, runId);
    fs.writeFileSync(filePath, `${stringifyJson(run)}\n`, 'utf8');
    return { run, path: filePath };
  }

  update(runId: string, patch: RunRecordUpdateInput): RunRecord {
    const existing = this.get(runId);
    const parsedPatch = runRecordUpdateInputSchema.parse(patch);
    const merged = {
      ...existing,
      ...parsedPatch,
      changed_files: parsedPatch.changed_files ?? existing.changed_files,
      commands_run: parsedPatch.commands_run ?? existing.commands_run,
      validation_results: parsedPatch.validation_results ?? existing.validation_results,
      blockers: parsedPatch.blockers ?? existing.blockers,
      follow_ups: parsedPatch.follow_ups ?? existing.follow_ups,
    };
    const validated = runRecordSchema.parse(merged);
    const filePath = runFilePath(this.runsPath, runId);
    fs.writeFileSync(filePath, `${stringifyJson(validated)}\n`, 'utf8');
    return validated;
  }

  get(runId: string): RunRecord {
    const filePath = runFilePath(this.runsPath, runId);
    if (!fs.existsSync(filePath)) {
      throw new SidecarError(`Run not found: ${runId}`);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      return runRecordSchema.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SidecarError(`Invalid run record at ${filePath}: ${message}`);
    }
  }

  list(): RunRecord[] {
    this.ensureStorage();
    const files = fs
      .readdirSync(this.runsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(this.runsPath, entry.name))
      .sort();

    const runs: RunRecord[] = [];
    for (const filePath of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        runs.push(runRecordSchema.parse(raw));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new SidecarError(`Invalid run record at ${filePath}: ${message}`);
      }
    }
    return runs;
  }

  listForTask(taskId: string): RunRecord[] {
    return this.list().filter((run) => run.task_id === taskId);
  }
}
