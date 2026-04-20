import { TaskPacketRepository } from './task-repository.js';
import {
  createTaskPacket,
  type TaskPacket,
  type TaskPacketInput,
  type TaskPacketPriority,
  type TaskPacketStatus,
  type TaskPacketType,
  type ValidationStepInput,
} from './task-packet.js';
import { normalizeValidationStep } from '../runs/capture.js';

export interface CreateTaskPacketInput {
  title: string;
  summary: string;
  goal: string;
  type?: TaskPacketType;
  status?: TaskPacketStatus;
  priority?: TaskPacketPriority;
  scope_in_scope?: string[];
  scope_out_of_scope?: string[];
  related_decisions?: string[];
  related_notes?: string[];
  files_to_read?: string[];
  files_to_avoid?: string[];
  technical_constraints?: string[];
  design_constraints?: string[];
  validation_commands?: Array<string | ValidationStepInput>;
  dependencies?: string[];
  tags?: string[];
  target_areas?: string[];
  definition_of_done?: string[];
  branch?: string;
  worktree?: string;
}

export function createTaskPacketRecord(rootPath: string, input: CreateTaskPacketInput): { task: TaskPacket; path: string } {
  const repo = new TaskPacketRepository(rootPath);
  const taskId = repo.generateNextTaskId();

  const packetInput: TaskPacketInput = {
    title: input.title,
    summary: input.summary,
    goal: input.goal,
    type: input.type,
    status: input.status,
    priority: input.priority,
    scope: {
      in_scope: input.scope_in_scope ?? [],
      out_of_scope: input.scope_out_of_scope ?? [],
    },
    context: {
      related_decisions: input.related_decisions ?? [],
      related_notes: input.related_notes ?? [],
    },
    implementation: {
      files_to_read: input.files_to_read ?? [],
      files_to_avoid: input.files_to_avoid ?? [],
    },
    constraints: {
      technical: input.technical_constraints ?? [],
      design: input.design_constraints ?? [],
    },
    execution: {
      commands: {
        validation: (input.validation_commands ?? [])
          .map((v) => normalizeValidationStep(v))
          .filter((v): v is ValidationStepInput => v !== null),
      },
    },
    dependencies: input.dependencies ?? [],
    tags: input.tags ?? [],
    target_areas: input.target_areas ?? [],
    definition_of_done: input.definition_of_done ?? [],
    tracking: {
      branch: input.branch ?? '',
      worktree: input.worktree ?? '',
      assigned_agent_role: null,
      assigned_runner: null,
      assignment_reason: '',
      assigned_at: null,
    },
  };

  const packet = createTaskPacket(taskId, packetInput);
  const filePath = repo.save(packet);
  return { task: packet, path: filePath };
}

export function listTaskPackets(rootPath: string): TaskPacket[] {
  const repo = new TaskPacketRepository(rootPath);
  const order: Record<TaskPacketStatus, number> = {
    draft: 0,
    ready: 1,
    queued: 2,
    running: 3,
    review: 4,
    blocked: 5,
    done: 6,
  };

  return repo
    .list()
    .slice()
    .sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) return byStatus;
      return a.task_id.localeCompare(b.task_id, undefined, { numeric: true });
    });
}

export function getTaskPacket(rootPath: string, taskId: string): TaskPacket {
  const repo = new TaskPacketRepository(rootPath);
  return repo.get(taskId);
}

export function saveTaskPacket(rootPath: string, task: TaskPacket): string {
  const repo = new TaskPacketRepository(rootPath);
  return repo.save(task);
}
