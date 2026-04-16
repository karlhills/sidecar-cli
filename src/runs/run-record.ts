import { z } from 'zod';
import { nowIso } from '../lib/format.js';

export const RUN_RECORD_VERSION = '1.0';

export const runIdSchema = z.string().regex(/^R-\d{3,}$/, 'Run id must look like R-001');
export const runStatusSchema = z.enum(['queued', 'preparing', 'running', 'review', 'blocked', 'completed', 'failed']);
export const runnerTypeSchema = z.enum(['codex', 'claude']);
export const runReviewStateSchema = z.enum(['pending', 'approved', 'needs_changes', 'blocked', 'merged']);

export const runRecordSchema = z
  .object({
    version: z.string().default(RUN_RECORD_VERSION),
    run_id: runIdSchema,
    task_id: z.string().regex(/^T-\d{3,}$/, 'task_id must look like T-001'),
    runner_type: runnerTypeSchema,
    agent_role: z.string().min(1, 'agent_role is required'),
    status: runStatusSchema,
    branch: z.string().default(''),
    worktree: z.string().default(''),
    prompt_path: z.string().default(''),
    started_at: z.string().datetime({ offset: true }),
    completed_at: z.string().datetime({ offset: true }).nullable().default(null),
    summary: z.string().default(''),
    changed_files: z.array(z.string()).default([]),
    commands_run: z.array(z.string()).default([]),
    validation_results: z.array(z.string()).default([]),
    blockers: z.array(z.string()).default([]),
    follow_ups: z.array(z.string()).default([]),
    review_state: runReviewStateSchema.default('pending'),
    reviewed_at: z.string().datetime({ offset: true }).nullable().default(null),
    reviewed_by: z.string().default(''),
    review_note: z.string().default(''),
    prompt_tokens_estimated_before: z.number().int().nonnegative().default(0),
    prompt_tokens_estimated_after: z.number().int().nonnegative().default(0),
    prompt_budget_target: z.number().int().nonnegative().default(0),
    prompt_trimmed_sections: z.array(z.string()).default([]),
  })
  .strict();

export const runRecordCreateInputSchema = runRecordSchema
  .omit({ run_id: true, version: true })
  .partial({
    status: true,
    branch: true,
    worktree: true,
    prompt_path: true,
    started_at: true,
    completed_at: true,
    summary: true,
    changed_files: true,
    commands_run: true,
    validation_results: true,
    blockers: true,
    follow_ups: true,
    review_state: true,
    reviewed_at: true,
    reviewed_by: true,
    review_note: true,
    prompt_tokens_estimated_before: true,
    prompt_tokens_estimated_after: true,
    prompt_budget_target: true,
    prompt_trimmed_sections: true,
  });

export const runRecordUpdateInputSchema = z
  .object({
    status: runStatusSchema.optional(),
    branch: z.string().optional(),
    worktree: z.string().optional(),
    prompt_path: z.string().optional(),
    completed_at: z.string().datetime({ offset: true }).nullable().optional(),
    summary: z.string().optional(),
    changed_files: z.array(z.string()).optional(),
    commands_run: z.array(z.string()).optional(),
    validation_results: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    follow_ups: z.array(z.string()).optional(),
    review_state: runReviewStateSchema.optional(),
    reviewed_at: z.string().datetime({ offset: true }).nullable().optional(),
    reviewed_by: z.string().optional(),
    review_note: z.string().optional(),
    prompt_tokens_estimated_before: z.number().int().nonnegative().optional(),
    prompt_tokens_estimated_after: z.number().int().nonnegative().optional(),
    prompt_budget_target: z.number().int().nonnegative().optional(),
    prompt_trimmed_sections: z.array(z.string()).optional(),
  })
  .strict();

export type RunRecord = z.infer<typeof runRecordSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunnerType = z.infer<typeof runnerTypeSchema>;
export type RunReviewState = z.infer<typeof runReviewStateSchema>;
export type RunRecordCreateInput = z.infer<typeof runRecordCreateInputSchema>;
export type RunRecordUpdateInput = z.infer<typeof runRecordUpdateInputSchema>;

export function createRunRecord(runId: string, input: RunRecordCreateInput): RunRecord {
  const normalized = {
    version: RUN_RECORD_VERSION,
    run_id: runId,
    task_id: input.task_id,
    runner_type: input.runner_type,
    agent_role: input.agent_role,
    status: input.status ?? 'queued',
    branch: input.branch ?? '',
    worktree: input.worktree ?? '',
    prompt_path: input.prompt_path ?? '',
    started_at: input.started_at ?? nowIso(),
    completed_at: input.completed_at ?? null,
    summary: input.summary ?? '',
    changed_files: input.changed_files ?? [],
    commands_run: input.commands_run ?? [],
    validation_results: input.validation_results ?? [],
    blockers: input.blockers ?? [],
    follow_ups: input.follow_ups ?? [],
    review_state: input.review_state ?? 'pending',
    reviewed_at: input.reviewed_at ?? null,
    reviewed_by: input.reviewed_by ?? '',
    review_note: input.review_note ?? '',
    prompt_tokens_estimated_before: input.prompt_tokens_estimated_before ?? 0,
    prompt_tokens_estimated_after: input.prompt_tokens_estimated_after ?? 0,
    prompt_budget_target: input.prompt_budget_target ?? 0,
    prompt_trimmed_sections: input.prompt_trimmed_sections ?? [],
  };

  return runRecordSchema.parse(normalized);
}
