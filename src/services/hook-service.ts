import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { startSession, endSession, currentSession } from './session-service.js';
import { addWorklog, addNote, getActiveSessionId } from './event-service.js';
import { addArtifact } from './artifact-service.js';

export const HOOK_EVENTS = ['session-start', 'session-end', 'file-edit', 'user-prompt'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];
export const hookEventSchema = z.enum(HOOK_EVENTS);

// Claude Code hook payload — all fields optional since the hook can be triggered by different
// events and other sources (Codex) may supply a subset.
export const hookPayloadSchema = z
  .object({
    session_id: z.string().optional(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.record(z.string(), z.unknown()).optional(),
    tool_response: z.record(z.string(), z.unknown()).optional(),
    prompt: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type HookPayload = z.infer<typeof hookPayloadSchema>;

export interface HandleHookInput {
  db: DatabaseSync;
  projectId: number;
  projectRoot: string;
  event: HookEvent;
  payload: HookPayload;
  actorName?: string;
}

export interface HookResult {
  ok: true;
  event: HookEvent;
  action: string;
  detail?: string;
  session_id?: number | null;
  event_id?: number | null;
}

const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_PROMPT_LEN = 200;

function deriveActorName(payload: HookPayload, override?: string): string {
  if (override && override.trim()) return override.trim();
  const sid = typeof payload.session_id === 'string' ? payload.session_id.slice(0, 8) : '';
  return sid ? `claude-code:${sid}` : 'claude-code';
}

function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function toRelativePath(projectRoot: string, filePath: string): string {
  try {
    const rel = path.relative(canonical(projectRoot), canonical(filePath));
    if (rel && !rel.startsWith('..')) return rel.replaceAll('\\', '/');
  } catch {
    // fall through
  }
  return filePath;
}

// Lazy-open an agent session when an ambient event fires with no active one.
// Keeps ambient capture working even if SessionStart never ran (e.g. hooks installed
// mid-session). Returns the resolved session id (existing or newly created).
function ensureSession(db: DatabaseSync, projectId: number, actorName: string): number | null {
  const existing = getActiveSessionId(db, projectId);
  if (existing) return existing;
  const started = startSession(db, { projectId, actor: 'agent', name: actorName });
  if (!started.ok) return null;
  return started.sessionId;
}

export function handleHookEvent(input: HandleHookInput): HookResult {
  const { db, projectId, projectRoot, event, payload } = input;
  const actorName = deriveActorName(payload, input.actorName);

  if (event === 'session-start') {
    const active = currentSession(db, projectId) as { id: number } | undefined;
    if (active) {
      return { ok: true, event, action: 'noop', detail: 'session already active', session_id: active.id };
    }
    const started = startSession(db, { projectId, actor: 'agent', name: actorName });
    if (!started.ok) {
      return { ok: true, event, action: 'noop', detail: started.reason };
    }
    return { ok: true, event, action: 'started', session_id: started.sessionId };
  }

  if (event === 'session-end') {
    const active = currentSession(db, projectId) as { id: number } | undefined;
    if (!active) {
      return { ok: true, event, action: 'noop', detail: 'no active session' };
    }
    const summary = typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : `Hook: session ended (${actorName})`;
    const ended = endSession(db, { projectId, summary });
    if (!ended.ok) {
      return { ok: true, event, action: 'noop', detail: ended.reason };
    }
    return { ok: true, event, action: 'ended', session_id: ended.sessionId };
  }

  if (event === 'file-edit') {
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    if (toolName && !EDIT_TOOL_NAMES.has(toolName)) {
      return { ok: true, event, action: 'noop', detail: `ignored tool: ${toolName}` };
    }
    const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
    const rawPath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    if (!rawPath) {
      return { ok: true, event, action: 'noop', detail: 'no file_path in tool_input' };
    }
    const relPath = toRelativePath(projectRoot, rawPath);
    const sessionId = ensureSession(db, projectId, actorName);
    const { eventId } = addWorklog(db, {
      projectId,
      done: `Edited ${relPath} via ${toolName || 'Claude Code'}`,
      files: relPath,
      by: 'agent',
      sessionId,
    });
    addArtifact(db, { projectId, path: relPath, kind: 'file' });
    return { ok: true, event, action: 'recorded', session_id: sessionId, event_id: eventId };
  }

  if (event === 'user-prompt') {
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      return { ok: true, event, action: 'noop', detail: 'empty prompt' };
    }
    const truncated = prompt.length > MAX_PROMPT_LEN ? `${prompt.slice(0, MAX_PROMPT_LEN)}…` : prompt;
    const sessionId = ensureSession(db, projectId, actorName);
    const eventId = addNote(db, {
      projectId,
      title: 'User prompt',
      text: truncated,
      by: 'agent',
      sessionId,
    });
    return { ok: true, event, action: 'recorded', session_id: sessionId, event_id: eventId };
  }

  return { ok: true, event, action: 'noop', detail: 'unknown event' };
}
