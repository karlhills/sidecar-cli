import { z } from 'zod';

export const TASK_PACKET_VERSION = '1.0';

const taskIdSchema = z.string().regex(/^T-\d{3,}$/, 'Task id must look like T-001');

export const taskPacketStatusSchema = z.enum(['draft', 'ready', 'queued', 'running', 'review', 'blocked', 'done']);
export const taskPacketPrioritySchema = z.enum(['low', 'medium', 'high']);
export const taskPacketTypeSchema = z.enum(['feature', 'bug', 'chore', 'research']);
export const taskAgentRoleSchema = z.enum(['planner', 'builder-ui', 'builder-app', 'reviewer', 'tester']);
export const taskRunnerSchema = z.enum(['codex', 'claude']);

export const validationKindSchema = z.enum(['typecheck', 'lint', 'test', 'build', 'custom']);
export type ValidationKindValue = z.infer<typeof validationKindSchema>;

// Accept string entries ("npm test") or object entries ({kind,command,...}). String entries
// are promoted to { kind: 'custom', command }. This preserves the v1 packet shape while
// giving new packets first-class typed validation steps.
export const validationStepSchema = z.preprocess(
  (raw) => {
    if (typeof raw === 'string') {
      return { kind: 'custom', command: raw };
    }
    return raw;
  },
  z
    .object({
      kind: validationKindSchema.default('custom'),
      command: z.string().min(1, 'validation command is required'),
      name: z.string().optional(),
      timeout_ms: z.number().int().positive().optional(),
    })
    .strict(),
);
export type ValidationStepInput = z.infer<typeof validationStepSchema>;

export const taskPacketSchema = z
  .object({
    version: z.string().default(TASK_PACKET_VERSION),
    task_id: taskIdSchema,
    title: z.string().min(1, 'title is required'),
    type: taskPacketTypeSchema.default('chore'),
    status: z
      .preprocess((value) => {
        if (value === 'open') return 'draft';
        if (value === 'in_progress') return 'running';
        return value;
      }, taskPacketStatusSchema)
      .default('draft'),
    priority: taskPacketPrioritySchema.default('medium'),
    summary: z.string().min(1, 'summary is required'),
    goal: z.string().min(1, 'goal is required'),
    scope: z.object({
      in_scope: z.array(z.string()).default([]),
      out_of_scope: z.array(z.string()).default([]),
    }),
    context: z.object({
      related_decisions: z.array(z.string()).default([]),
      related_notes: z.array(z.string()).default([]),
    }),
    implementation: z.object({
      files_to_read: z.array(z.string()).default([]),
      files_to_avoid: z.array(z.string()).default([]),
    }),
    constraints: z.object({
      technical: z.array(z.string()).default([]),
      design: z.array(z.string()).default([]),
    }),
    execution: z.object({
      commands: z.object({
        validation: z.array(validationStepSchema).default([]),
      }),
    }),
    dependencies: z.array(taskIdSchema).default([]),
    tags: z.array(z.string()).default([]),
    target_areas: z.array(z.string()).default([]),
    definition_of_done: z.array(z.string()).default([]),
    tracking: z.object({
      branch: z.string().default(''),
      worktree: z.string().default(''),
      assigned_agent_role: taskAgentRoleSchema.nullable().default(null),
      assigned_runner: taskRunnerSchema.nullable().default(null),
      assignment_reason: z.string().default(''),
      assigned_at: z.string().datetime({ offset: true }).nullable().default(null),
    }),
    result: z.object({
      summary: z.string().default(''),
      changed_files: z.array(z.string()).default([]),
      validation_results: z.array(z.string()).default([]),
    }),
  })
  .strict();

export const taskPacketInputSchema = taskPacketSchema.omit({ task_id: true }).partial({
  version: true,
  type: true,
  status: true,
  priority: true,
  scope: true,
  context: true,
  implementation: true,
  constraints: true,
  execution: true,
  dependencies: true,
  tags: true,
  target_areas: true,
  definition_of_done: true,
  tracking: true,
  result: true,
});

export type TaskPacket = z.infer<typeof taskPacketSchema>;
export type TaskPacketStatus = z.infer<typeof taskPacketStatusSchema>;
export type TaskPacketPriority = z.infer<typeof taskPacketPrioritySchema>;
export type TaskPacketType = z.infer<typeof taskPacketTypeSchema>;
export type TaskAgentRole = z.infer<typeof taskAgentRoleSchema>;
export type TaskRunner = z.infer<typeof taskRunnerSchema>;
export type TaskPacketInput = z.infer<typeof taskPacketInputSchema>;

export function createTaskPacket(taskId: string, input: TaskPacketInput): TaskPacket {
  const normalized = {
    ...input,
    version: input.version ?? TASK_PACKET_VERSION,
    task_id: taskId,
    type: input.type ?? 'chore',
    status: input.status ?? 'draft',
    priority: input.priority ?? 'medium',
    scope: {
      in_scope: input.scope?.in_scope ?? [],
      out_of_scope: input.scope?.out_of_scope ?? [],
    },
    context: {
      related_decisions: input.context?.related_decisions ?? [],
      related_notes: input.context?.related_notes ?? [],
    },
    implementation: {
      files_to_read: input.implementation?.files_to_read ?? [],
      files_to_avoid: input.implementation?.files_to_avoid ?? [],
    },
    constraints: {
      technical: input.constraints?.technical ?? [],
      design: input.constraints?.design ?? [],
    },
    execution: {
      commands: {
        validation: input.execution?.commands?.validation ?? [],
      },
    },
    dependencies: input.dependencies ?? [],
    tags: input.tags ?? [],
    target_areas: input.target_areas ?? [],
    definition_of_done: input.definition_of_done ?? [],
    tracking: {
      branch: input.tracking?.branch ?? '',
      worktree: input.tracking?.worktree ?? '',
      assigned_agent_role: input.tracking?.assigned_agent_role ?? null,
      assigned_runner: input.tracking?.assigned_runner ?? null,
      assignment_reason: input.tracking?.assignment_reason ?? '',
      assigned_at: input.tracking?.assigned_at ?? null,
    },
    result: {
      summary: input.result?.summary ?? '',
      changed_files: input.result?.changed_files ?? [],
      validation_results: input.result?.validation_results ?? [],
    },
  };

  return taskPacketSchema.parse(normalized);
}
