import { nowIso } from '../lib/format.js';
import type { AgentRole } from '../runners/config.js';
import type { RunnerType } from '../runs/run-record.js';
import type { TaskPacket } from '../tasks/task-packet.js';
import { getTaskPacket, listTaskPackets, saveTaskPacket } from '../tasks/task-service.js';

export interface AssignmentDecision {
  task_id: string;
  agent_role: AgentRole;
  runner: RunnerType;
  reason: string;
}

export interface QueueDecision {
  task_id: string;
  queued: boolean;
  reason: string;
}

function hasUiSignal(task: TaskPacket): boolean {
  const joined = [
    ...task.tags,
    ...task.target_areas,
    ...task.implementation.files_to_read,
    ...task.implementation.files_to_avoid,
  ]
    .join(' ')
    .toLowerCase();
  return /(ui|frontend|css|html|react|view|component)/.test(joined);
}

function pickRole(task: TaskPacket): { role: AgentRole; reason: string } {
  if (task.type === 'research') return { role: 'planner', reason: 'task type is research' };
  if (task.tags.some((t) => t.toLowerCase() === 'test') || task.target_areas.some((a) => /test/i.test(a))) {
    return { role: 'tester', reason: 'tags/target_areas indicate testing' };
  }
  if (task.tags.some((t) => /review/i.test(t)) || task.type === 'bug') {
    return { role: 'reviewer', reason: 'bug/review signal present' };
  }
  if (hasUiSignal(task)) return { role: 'builder-ui', reason: 'ui/frontend signal detected' };
  return { role: 'builder-app', reason: 'default app implementation path' };
}

function defaultRunnerForRole(role: AgentRole): RunnerType {
  if (role === 'reviewer' || role === 'planner') return 'claude';
  return 'codex';
}

export function dependenciesMet(task: TaskPacket, tasksById: Map<string, TaskPacket>): { ok: boolean; missing: string[] } {
  const missing = task.dependencies.filter((depId) => tasksById.get(depId)?.status !== 'done');
  return { ok: missing.length === 0, missing };
}

export function assignTask(
  rootPath: string,
  taskId: string,
  override?: { role?: AgentRole; runner?: RunnerType }
): AssignmentDecision {
  const task = getTaskPacket(rootPath, taskId);
  const auto = pickRole(task);
  const role = override?.role ?? auto.role;
  const runner = override?.runner ?? defaultRunnerForRole(role);
  const reason = override?.role || override?.runner ? 'manual override' : auto.reason;

  const updated: TaskPacket = {
    ...task,
    tracking: {
      ...task.tracking,
      assigned_agent_role: role,
      assigned_runner: runner,
      assignment_reason: reason,
      assigned_at: nowIso(),
    },
  };

  saveTaskPacket(rootPath, updated);
  return { task_id: task.task_id, agent_role: role, runner, reason };
}

export function queueReadyTasks(rootPath: string): QueueDecision[] {
  const tasks = listTaskPackets(rootPath);
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const decisions: QueueDecision[] = [];

  for (const task of tasks) {
    if (task.status !== 'ready') continue;

    const dep = dependenciesMet(task, byId);
    if (!dep.ok) {
      saveTaskPacket(rootPath, { ...task, status: 'blocked' });
      decisions.push({ task_id: task.task_id, queued: false, reason: `blocked by dependencies: ${dep.missing.join(', ')}` });
      continue;
    }

    const assignment: { role: AgentRole; runner: RunnerType } =
      task.tracking.assigned_agent_role && task.tracking.assigned_runner
        ? {
            role: task.tracking.assigned_agent_role,
            runner: task.tracking.assigned_runner,
          }
        : (() => {
            const decided = assignTask(rootPath, task.task_id);
            return { role: decided.agent_role, runner: decided.runner };
          })();

    const latest = getTaskPacket(rootPath, task.task_id);
    saveTaskPacket(rootPath, {
      ...latest,
      status: 'queued',
      tracking: {
        ...latest.tracking,
        assigned_agent_role: assignment.role,
        assigned_runner: assignment.runner,
      },
    });
    decisions.push({
      task_id: task.task_id,
      queued: true,
      reason: `queued for ${assignment.role} via ${assignment.runner}`,
    });
  }

  return decisions;
}
