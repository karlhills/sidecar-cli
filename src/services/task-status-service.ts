import { SidecarError } from '../lib/errors.js';
import type { TaskPacketStatus } from '../tasks/task-packet.js';
import { getTaskPacket, saveTaskPacket } from '../tasks/task-service.js';

const TASK_STATUS_TRANSITIONS: Record<TaskPacketStatus, TaskPacketStatus[]> = {
  draft: ['ready', 'blocked', 'done'],
  ready: ['draft', 'queued', 'blocked', 'done'],
  queued: ['ready', 'running', 'blocked'],
  running: ['ready', 'review', 'blocked'],
  review: ['ready', 'blocked', 'done'],
  blocked: ['ready', 'done'],
  done: ['review'],
};

export interface TaskStatusTransitionResult {
  task_id: string;
  from_status: TaskPacketStatus;
  to_status: TaskPacketStatus;
  path: string;
}

export function allowedTaskStatusTransitions(fromStatus: TaskPacketStatus): TaskPacketStatus[] {
  return TASK_STATUS_TRANSITIONS[fromStatus];
}

export function transitionTaskStatus(
  rootPath: string,
  taskId: string,
  toStatus: TaskPacketStatus
): TaskStatusTransitionResult {
  const task = getTaskPacket(rootPath, taskId);
  const fromStatus = task.status;

  if (fromStatus === toStatus) {
    throw new SidecarError(`Task ${task.task_id} is already '${toStatus}'`);
  }

  const allowed = allowedTaskStatusTransitions(fromStatus);
  if (!allowed.includes(toStatus)) {
    throw new SidecarError(
      `Invalid status transition for ${task.task_id}: ${fromStatus} -> ${toStatus}. Allowed: ${allowed.join(', ')}`
    );
  }

  const updated = { ...task, status: toStatus };
  const filePath = saveTaskPacket(rootPath, updated);

  return {
    task_id: task.task_id,
    from_status: fromStatus,
    to_status: toStatus,
    path: filePath,
  };
}
