import { TaskPacketRepository } from './task-repository.js';
import {
  createTaskPacket,
  type TaskPacket,
  type TaskPacketInput,
  type TaskPacketPriority,
  type TaskPacketStatus,
} from './task-packet.js';

export interface CreateTaskPacketInput {
  title: string;
  summary: string;
  priority?: TaskPacketPriority;
  status?: TaskPacketStatus;
  trigger_condition: string;
  trigger_check_command?: string;
  trigger_depends_on?: string[];
  entry_points: string[];
  done_condition: string;
  validation_command: string;
}

export function createTaskPacketRecord(rootPath: string, input: CreateTaskPacketInput): { task: TaskPacket; path: string } {
  const repo = new TaskPacketRepository(rootPath);
  const taskId = repo.generateNextTaskId();

  const packetInput: TaskPacketInput = {
    title: input.title,
    summary: input.summary,
    priority: input.priority,
    status: input.status,
    trigger: {
      condition: input.trigger_condition,
      ...(input.trigger_check_command ? { check_command: input.trigger_check_command } : {}),
      depends_on: (input.trigger_depends_on ?? []).map((v) => v.toUpperCase()),
    },
    entry_points: input.entry_points,
    done_condition: input.done_condition,
    validation_command: input.validation_command,
  };

  const packet = createTaskPacket(taskId, packetInput);
  const filePath = repo.save(packet);
  return { task: packet, path: filePath };
}

export function listTaskPackets(rootPath: string): TaskPacket[] {
  const repo = new TaskPacketRepository(rootPath);
  const order: Record<TaskPacketStatus, number> = {
    active: 0,
    blocked: 1,
    done: 2,
  };

  return repo
    .list()
    .slice()
    .sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) return byStatus;
      return a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id, undefined, { numeric: true });
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
