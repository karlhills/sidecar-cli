import type { ArtifactKind, EventType, TaskPriority, TaskStatus } from './models.js';

export interface ApiEvent {
  id: number;
  project_id?: number;
  type: EventType;
  title: string;
  summary: string;
  details_json?: Record<string, unknown> | string;
  created_at?: string;
  created_by?: 'human' | 'agent' | 'system';
  source?: 'cli' | 'imported' | 'generated';
  session_id?: number | null;
}

export interface ApiDecision extends ApiEvent {
  type: 'decision';
}

export interface ApiWorklog extends ApiEvent {
  type: 'worklog';
}

export interface ApiTask {
  id: number;
  project_id?: number;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority?: TaskPriority | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  origin_event_id?: number | null;
}

export interface ApiArtifact {
  id: number;
  project_id?: number;
  path: string;
  kind: ArtifactKind;
  note?: string | null;
  created_at?: string;
}

export type ApiPreferences = Record<string, unknown>;

export interface ApiContext {
  generatedAt: string;
  projectName: string;
  projectPath: string;
  activeSession: Record<string, unknown> | null;
  recentDecisions: Array<Pick<ApiDecision, 'title' | 'summary' | 'created_at'>>;
  recentWorklogs: Array<Pick<ApiWorklog, 'title' | 'summary' | 'created_at'>>;
  notableNotes: Array<Pick<ApiEvent, 'title' | 'summary' | 'created_at'>>;
  openTasks: ApiTask[];
  recentArtifacts: ApiArtifact[];
}
