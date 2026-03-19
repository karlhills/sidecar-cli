import { RunRecordRepository } from './run-repository.js';
import type { RunRecord, RunRecordCreateInput, RunRecordUpdateInput } from './run-record.js';

export function createRunRecordEntry(rootPath: string, input: RunRecordCreateInput): { run: RunRecord; path: string } {
  const repo = new RunRecordRepository(rootPath);
  return repo.create(input);
}

export function updateRunRecordEntry(rootPath: string, runId: string, patch: RunRecordUpdateInput): RunRecord {
  const repo = new RunRecordRepository(rootPath);
  return repo.update(runId, patch);
}

export function getRunRecord(rootPath: string, runId: string): RunRecord {
  const repo = new RunRecordRepository(rootPath);
  return repo.get(runId);
}

export function listRunRecords(rootPath: string): RunRecord[] {
  const repo = new RunRecordRepository(rootPath);
  return repo
    .list()
    .slice()
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function listRunRecordsForTask(rootPath: string, taskId: string): RunRecord[] {
  const repo = new RunRecordRepository(rootPath);
  return repo
    .listForTask(taskId)
    .slice()
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}
