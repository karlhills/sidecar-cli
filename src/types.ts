export type EventType =
  | 'note'
  | 'worklog'
  | 'decision'
  | 'task_update'
  | 'summary'
  | 'context';

export type OutputFormat = 'text' | 'markdown' | 'json';

export interface SidecarConfig {
  version: 1;
  createdAt: string;
  projectName: string;
}

export interface TaskRow {
  id: number;
  title: string;
  status: 'open' | 'done';
  priority: 'low' | 'medium' | 'high';
  created_at: string;
  updated_at: string;
}
