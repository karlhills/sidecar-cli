import fs from 'node:fs';
import path from 'node:path';
import { nowIso, stringifyJson } from '../lib/format.js';
import { SidecarError } from '../lib/errors.js';
import { getSidecarPaths } from '../lib/paths.js';
import { taskPacketSchema, type TaskPacket, type TaskPacketStatus } from './task-packet.js';

const TASK_STATUS_FOLDERS: Record<TaskPacketStatus, string> = {
  active: 'active',
  blocked: 'blocked',
  done: 'done',
};

function parseTaskIdOrdinal(taskId: string): number {
  const match = /^T-(\d+)$/.exec(taskId);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export class TaskPacketRepository {
  constructor(private readonly rootPath: string) {}

  get tasksPath(): string {
    return getSidecarPaths(this.rootPath).tasksPath;
  }

  private statusPath(status: TaskPacketStatus): string {
    return path.join(this.tasksPath, TASK_STATUS_FOLDERS[status]);
  }

  ensureStorage(): void {
    fs.mkdirSync(this.tasksPath, { recursive: true });
    fs.mkdirSync(this.statusPath('active'), { recursive: true });
    fs.mkdirSync(this.statusPath('blocked'), { recursive: true });
    fs.mkdirSync(this.statusPath('done'), { recursive: true });
  }

  private allTaskFiles(): string[] {
    this.ensureStorage();
    const files: string[] = [];
    const roots = [this.tasksPath, this.statusPath('active'), this.statusPath('blocked'), this.statusPath('done')];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        files.push(path.join(root, entry.name));
      }
    }
    return Array.from(new Set(files)).sort();
  }

  generateNextTaskId(): string {
    const files = this.allTaskFiles();
    let max = 0;
    for (const filePath of files) {
      const name = path.basename(filePath);
      const id = name.slice(0, -'.json'.length);
      max = Math.max(max, parseTaskIdOrdinal(id));
    }
    return `T-${String(max + 1).padStart(3, '0')}`;
  }

  private findTaskFile(taskId: string): string | null {
    const candidateName = `${taskId}.json`;
    for (const filePath of this.allTaskFiles()) {
      if (path.basename(filePath) === candidateName) return filePath;
    }
    return null;
  }

  save(packet: TaskPacket): string {
    this.ensureStorage();
    const validated = taskPacketSchema.parse(packet);
    const now = nowIso();
    const withUpdatedAt = taskPacketSchema.parse({
      ...validated,
      created_at: validated.created_at || now,
      updated_at: now,
    });

    const destination = path.join(this.statusPath(withUpdatedAt.status), `${withUpdatedAt.task_id}.json`);
    const existing = this.findTaskFile(withUpdatedAt.task_id);
    if (existing && existing !== destination && fs.existsSync(existing)) {
      fs.unlinkSync(existing);
    }

    fs.writeFileSync(destination, `${stringifyJson(withUpdatedAt)}\n`, 'utf8');
    return destination;
  }

  get(taskId: string): TaskPacket {
    const filePath = this.findTaskFile(taskId);
    if (!filePath) throw new SidecarError(`Task not found: ${taskId}`);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      const parsed = taskPacketSchema.parse(raw);
      if (parsed.status === 'active' && filePath.startsWith(this.statusPath('blocked'))) {
        parsed.status = 'blocked';
      }
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SidecarError(`Invalid task packet at ${filePath}: ${message}`);
    }
  }

  list(): TaskPacket[] {
    const packets: TaskPacket[] = [];
    for (const filePath of this.allTaskFiles()) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        const parsed = taskPacketSchema.parse(raw);
        packets.push(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new SidecarError(`Invalid task packet at ${filePath}: ${message}`);
      }
    }
    return packets;
  }
}
