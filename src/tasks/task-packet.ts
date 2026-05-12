import { z } from 'zod';
import { nowIso } from '../lib/format.js';

export const TASK_PACKET_VERSION = '2.0';

const taskIdSchema = z.string().regex(/^T-\d{3,}$/, 'Task id must look like T-001');

export const taskPacketStatusSchema = z.enum(['active', 'blocked', 'done']);
export const taskPacketPrioritySchema = z.enum(['low', 'medium', 'high']);

export const taskTriggerSchema = z
  .object({
    condition: z.string().min(1, 'trigger condition is required'),
    check_command: z.string().min(1).optional(),
    depends_on: z.array(taskIdSchema).default([]),
  })
  .strict();

export const taskResultSchema = z
  .object({
    summary: z.string().default(''),
    changed_files: z.array(z.string()).default([]),
    validation_output: z.string().default(''),
    validated_at: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();

function normalizeLegacyStatus(value: unknown): unknown {
  if (value === 'open') return 'active';
  if (value === 'in_progress') return 'active';
  if (value === 'draft' || value === 'ready' || value === 'queued' || value === 'running' || value === 'review') return 'active';
  return value;
}

function normalizeLegacyPacket(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const packet = raw as Record<string, unknown>;

  const entryFromLegacy = (() => {
    const implementation = packet.implementation as Record<string, unknown> | undefined;
    const files = implementation?.files_to_read;
    if (Array.isArray(files)) {
      return files
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0)
        .slice(0, 3);
    }
    return [];
  })();

  const doneFromLegacy = (() => {
    const dod = packet.definition_of_done;
    if (Array.isArray(dod) && dod.length > 0) {
      const first = dod.find((v) => typeof v === 'string' && v.trim().length > 0);
      if (typeof first === 'string') return first.trim();
    }
    const goal = typeof packet.goal === 'string' ? packet.goal.trim() : '';
    return goal;
  })();

  const validationFromLegacy = (() => {
    const execution = packet.execution as Record<string, unknown> | undefined;
    const commands = execution?.commands as Record<string, unknown> | undefined;
    const validation = commands?.validation;
    if (Array.isArray(validation) && validation.length > 0) {
      const first = validation[0];
      if (typeof first === 'string') return first.trim();
      if (first && typeof first === 'object') {
        const command = (first as { command?: unknown }).command;
        if (typeof command === 'string') return command.trim();
      }
    }
    return '';
  })();

  const dependenciesFromLegacy = (() => {
    const deps = packet.dependencies;
    if (Array.isArray(deps)) {
      return deps.filter((v): v is string => typeof v === 'string' && /^T-\d{3,}$/.test(v));
    }
    return [];
  })();

  const baseSummary = typeof packet.summary === 'string' ? packet.summary.trim() : '';
  const baseGoal = typeof packet.goal === 'string' ? packet.goal.trim() : '';
  const baseTitle = typeof packet.title === 'string' ? packet.title.trim() : '';
  const resultLegacy = (() => {
    const result = packet.result as Record<string, unknown> | undefined;
    if (!result || typeof result !== 'object') return undefined;
    const validationResults = Array.isArray(result.validation_results)
      ? result.validation_results.filter((v): v is string => typeof v === 'string')
      : [];
    return {
      summary: typeof result.summary === 'string' ? result.summary : '',
      changed_files: Array.isArray(result.changed_files)
        ? result.changed_files.filter((v): v is string => typeof v === 'string')
        : [],
      validation_output: validationResults.join('\n'),
      validated_at: null,
    };
  })();

  return {
    version: typeof packet.version === 'string' ? packet.version : TASK_PACKET_VERSION,
    task_id: packet.task_id,
    title: baseTitle,
    summary: baseSummary || baseGoal || baseTitle,
    priority: packet.priority,
    status: normalizeLegacyStatus(packet.status),
    created_at: packet.created_at,
    updated_at: packet.updated_at,
    trigger: packet.trigger ?? {
      condition: dependenciesFromLegacy.length > 0
        ? `After dependencies are done: ${dependenciesFromLegacy.join(', ')}`
        : 'Set explicit trigger before execution.',
      depends_on: dependenciesFromLegacy,
    },
    entry_points: packet.entry_points ?? entryFromLegacy,
    done_condition: packet.done_condition ?? doneFromLegacy,
    validation_command: packet.validation_command ?? validationFromLegacy,
    ...(resultLegacy ? { result: resultLegacy } : {}),
  };
}

const taskPacketShapeSchema = z
  .object({
    version: z.string().default(TASK_PACKET_VERSION),
    task_id: taskIdSchema,
    title: z.string().min(1, 'title is required'),
    summary: z.string().min(1, 'summary is required'),
    priority: taskPacketPrioritySchema.default('medium'),
    status: z.preprocess(normalizeLegacyStatus, taskPacketStatusSchema).default('active'),
    created_at: z.string().datetime({ offset: true }).default(() => nowIso()),
    updated_at: z.string().datetime({ offset: true }).default(() => nowIso()),
    trigger: taskTriggerSchema,
    entry_points: z
      .array(z.string().min(1))
      .min(1, 'at least one entry point is required')
      .max(3, 'entry points must be 1-3 files'),
    done_condition: z.string().min(1, 'done condition is required'),
    validation_command: z.string().min(1, 'validation command is required'),
    result: taskResultSchema.default({
      summary: '',
      changed_files: [],
      validation_output: '',
      validated_at: null,
    }),
  })
  .strict();

export const taskPacketSchema = z.preprocess(normalizeLegacyPacket, taskPacketShapeSchema);

export const taskPacketInputSchema = taskPacketShapeSchema.omit({ task_id: true }).partial({
  version: true,
  priority: true,
  status: true,
  created_at: true,
  updated_at: true,
  result: true,
});

export type TaskPacket = z.infer<typeof taskPacketSchema>;
export type TaskPacketStatus = z.infer<typeof taskPacketStatusSchema>;
export type TaskPacketPriority = z.infer<typeof taskPacketPrioritySchema>;
export type TaskTrigger = z.infer<typeof taskTriggerSchema>;
export type TaskPacketInput = z.infer<typeof taskPacketInputSchema>;

export function createTaskPacket(taskId: string, input: TaskPacketInput): TaskPacket {
  const now = nowIso();
  const normalized = {
    version: input.version ?? TASK_PACKET_VERSION,
    task_id: taskId,
    title: input.title,
    summary: input.summary,
    priority: input.priority ?? 'medium',
    status: input.status ?? 'active',
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    trigger: {
      condition: input.trigger?.condition ?? '',
      ...(input.trigger?.check_command ? { check_command: input.trigger.check_command } : {}),
      depends_on: input.trigger?.depends_on ?? [],
    },
    entry_points: input.entry_points ?? [],
    done_condition: input.done_condition ?? '',
    validation_command: input.validation_command ?? '',
    result: {
      summary: input.result?.summary ?? '',
      changed_files: input.result?.changed_files ?? [],
      validation_output: input.result?.validation_output ?? '',
      validated_at: input.result?.validated_at ?? null,
    },
  };

  return taskPacketSchema.parse(normalized);
}
