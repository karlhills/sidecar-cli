import { spawnSync } from 'node:child_process';
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
  const joined = [task.title, task.summary, ...task.entry_points].join(' ').toLowerCase();
  return /(ui|frontend|css|html|react|view|component)/.test(joined);
}

function pickRole(task: TaskPacket): { role: AgentRole; reason: string } {
  if (/test|qa|verification|validate/i.test(task.title) || /test|qa|verification|validate/i.test(task.summary)) {
    return { role: 'tester', reason: 'testing signal in title/summary' };
  }
  if (/review|audit|risk|regression/i.test(task.title) || /review|audit|risk|regression/i.test(task.summary)) {
    return { role: 'reviewer', reason: 'review signal in title/summary' };
  }
  if (hasUiSignal(task)) return { role: 'builder-ui', reason: 'ui/frontend signal detected' };
  return { role: 'builder-app', reason: 'default app implementation path' };
}

function defaultRunnerForRole(role: AgentRole): RunnerType {
  if (role === 'reviewer' || role === 'planner') return 'claude';
  return 'codex';
}

export function dependenciesMet(task: TaskPacket, tasksById: Map<string, TaskPacket>): { ok: boolean; missing: string[] } {
  const deps = task.trigger.depends_on ?? [];
  const missing = deps.filter((depId) => tasksById.get(depId)?.status !== 'done');
  return { ok: missing.length === 0, missing };
}

function triggerCommandSatisfied(rootPath: string, command: string): { ok: boolean; reason: string } {
  const proc = spawnSync(command, {
    cwd: rootPath,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const ok = proc.status === 0;
  const stderr = (proc.stderr || '').trim();
  const stdout = (proc.stdout || '').trim();
  if (ok) return { ok: true, reason: `trigger check passed: ${command}` };
  const details = stderr || stdout || `exit ${String(proc.status ?? '1')}`;
  return { ok: false, reason: `trigger check failed: ${command} (${details})` };
}

export function evaluateTrigger(
  rootPath: string,
  task: TaskPacket,
  tasksById: Map<string, TaskPacket>
): { ok: boolean; reason: string } {
  const dep = dependenciesMet(task, tasksById);
  if (!dep.ok) return { ok: false, reason: `dependencies not done: ${dep.missing.join(', ')}` };

  const checkCommand = task.trigger.check_command?.trim();
  if (checkCommand) return triggerCommandSatisfied(rootPath, checkCommand);

  if (task.trigger.depends_on.length > 0) {
    return { ok: true, reason: 'dependency trigger satisfied' };
  }

  return { ok: false, reason: 'trigger requires user confirmation (no check command)' };
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
  return { task_id: task.task_id, agent_role: role, runner, reason };
}

export function queueReadyTasks(rootPath: string): QueueDecision[] {
  const tasks = listTaskPackets(rootPath);
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const decisions: QueueDecision[] = [];

  for (const task of tasks) {
    if (task.status !== 'active') continue;

    const trigger = evaluateTrigger(rootPath, task, byId);
    if (!trigger.ok) {
      if (task.trigger.depends_on.length > 0) {
        saveTaskPacket(rootPath, { ...task, status: 'blocked' });
      }
      decisions.push({ task_id: task.task_id, queued: false, reason: trigger.reason });
      continue;
    }

    decisions.push({ task_id: task.task_id, queued: true, reason: trigger.reason });
  }

  return decisions;
}
