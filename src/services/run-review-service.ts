import { SidecarError } from '../lib/errors.js';
import { nowIso } from '../lib/format.js';
import type { RunReviewState } from '../runs/run-record.js';
import { getRunRecord, listRunRecords, updateRunRecordEntry } from '../runs/run-service.js';
import { createTaskPacketRecord, getTaskPacket, saveTaskPacket } from '../tasks/task-service.js';

export interface ReviewRunResult {
  run_id: string;
  task_id: string;
  review_state: RunReviewState;
  task_status: string;
}

function taskStatusForReview(state: RunReviewState): 'ready' | 'blocked' | 'done' | 'review' {
  if (state === 'approved') return 'review';
  if (state === 'needs_changes') return 'ready';
  if (state === 'blocked') return 'blocked';
  if (state === 'merged') return 'done';
  return 'review';
}

export function reviewRun(
  rootPath: string,
  runId: string,
  state: Exclude<RunReviewState, 'pending'>,
  options?: { note?: string; by?: string }
): ReviewRunResult {
  const run = getRunRecord(rootPath, runId);
  if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'blocked') {
    throw new SidecarError('Run must be completed, failed, or blocked before review actions');
  }

  updateRunRecordEntry(rootPath, run.run_id, {
    review_state: state,
    reviewed_at: nowIso(),
    reviewed_by: options?.by ?? 'human',
    review_note: options?.note ?? '',
  });

  const task = getTaskPacket(rootPath, run.task_id);
  const nextTaskStatus = taskStatusForReview(state);
  saveTaskPacket(rootPath, { ...task, status: nextTaskStatus });

  return {
    run_id: run.run_id,
    task_id: run.task_id,
    review_state: state,
    task_status: nextTaskStatus,
  };
}

export function createFollowupTaskFromRun(
  rootPath: string,
  runId: string
): { source_run_id: string; task_id: string; title: string } {
  const run = getRunRecord(rootPath, runId);
  const sourceTask = getTaskPacket(rootPath, run.task_id);
  const suggestions = run.follow_ups.length > 0 ? run.follow_ups : ['Investigate run issues and apply required changes'];

  const created = createTaskPacketRecord(rootPath, {
    title: `Follow-up: ${sourceTask.title}`,
    summary: run.review_note || run.summary || 'Follow-up work from reviewed run',
    goal: suggestions.join('; '),
    type: sourceTask.type,
    status: 'draft',
    priority: sourceTask.priority,
    dependencies: [sourceTask.task_id],
    tags: Array.from(new Set([...sourceTask.tags, 'follow-up'])),
    target_areas: sourceTask.target_areas,
    files_to_read: sourceTask.implementation.files_to_read,
    files_to_avoid: sourceTask.implementation.files_to_avoid,
    technical_constraints: sourceTask.constraints.technical,
    design_constraints: sourceTask.constraints.design,
    validation_commands: sourceTask.execution.commands.validation,
    definition_of_done: [...sourceTask.definition_of_done, ...suggestions],
  });

  return {
    source_run_id: run.run_id,
    task_id: created.task.task_id,
    title: created.task.title,
  };
}

export function buildReviewSummary(rootPath: string): {
  completed_runs: number;
  blocked_runs: number;
  suggested_follow_ups: number;
  recently_merged: Array<{ run_id: string; task_id: string; reviewed_at: string }>;
} {
  const runs = listRunRecords(rootPath);
  return {
    completed_runs: runs.filter((r) => r.status === 'completed').length,
    blocked_runs: runs.filter((r) => r.status === 'blocked' || r.review_state === 'blocked').length,
    suggested_follow_ups: runs.reduce((acc, r) => acc + r.follow_ups.length, 0),
    recently_merged: runs
      .filter((r) => r.review_state === 'merged' && r.reviewed_at)
      .sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)))
      .slice(0, 10)
      .map((r) => ({ run_id: r.run_id, task_id: r.task_id, reviewed_at: r.reviewed_at || '' })),
  };
}
