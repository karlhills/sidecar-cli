import fs from 'node:fs';
import path from 'node:path';
import { getSidecarPaths } from '../lib/paths.js';
import { SidecarError } from '../lib/errors.js';
import { stringifyJson } from '../lib/format.js';
import { taskPacketSchema, type TaskPacket } from './task-packet.js';

function taskFilePath(tasksPath: string, taskId: string): string {
  return path.join(tasksPath, `${taskId}.json`);
}

function parseTaskIdOrdinal(taskId: string): number {
  const match = /^T-(\d+)$/.exec(taskId);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export class TaskPacketRepository {
  constructor(private readonly rootPath: string) {}

  get tasksPath(): string {
    return getSidecarPaths(this.rootPath).tasksPath;
  }

  ensureStorage(): void {
    fs.mkdirSync(this.tasksPath, { recursive: true });
  }

  generateNextTaskId(): string {
    this.ensureStorage();
    const files = fs.readdirSync(this.tasksPath, { withFileTypes: true });
    let max = 0;
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      const id = file.name.slice(0, -'.json'.length);
      max = Math.max(max, parseTaskIdOrdinal(id));
    }
    return `T-${String(max + 1).padStart(3, '0')}`;
  }

  save(packet: TaskPacket): string {
    this.ensureStorage();
    const validated = taskPacketSchema.parse(packet);
    const filePath = taskFilePath(this.tasksPath, validated.task_id);
    fs.writeFileSync(filePath, `${stringifyJson(validated)}\n`, 'utf8');
    return filePath;
  }

  get(taskId: string): TaskPacket {
    const filePath = taskFilePath(this.tasksPath, taskId);
    if (!fs.existsSync(filePath)) {
      throw new SidecarError(`Task not found: ${taskId}`);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      return taskPacketSchema.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SidecarError(`Invalid task packet at ${filePath}: ${message}`);
    }
  }

  list(): TaskPacket[] {
    this.ensureStorage();
    const files = fs
      .readdirSync(this.tasksPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(this.tasksPath, entry.name))
      .sort();

    const packets: TaskPacket[] = [];
    for (const filePath of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        packets.push(taskPacketSchema.parse(raw));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new SidecarError(`Invalid task packet at ${filePath}: ${message}`);
      }
    }
    return packets;
  }
}
