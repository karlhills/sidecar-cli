export type ActorType = 'human' | 'agent';
export type CreatedByType = 'human' | 'agent' | 'system';
export type EventSource = 'cli' | 'imported' | 'generated';
export type TaskStatus = 'open' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ArtifactKind = 'file' | 'doc' | 'screenshot' | 'other';

export type EventType =
  | 'note'
  | 'decision'
  | 'worklog'
  | 'task_created'
  | 'task_completed'
  | 'summary_generated';

export interface SidecarConfig {
  schemaVersion: 1;
  project: {
    name: string;
    rootPath: string;
    createdAt: string;
  };
  defaults: {
    summary: {
      recentLimit: number;
    };
  };
  settings?: Record<string, unknown>;
}

export interface CliResult<T = unknown> {
  ok: boolean;
  data?: T;
  errors?: string[];
}
