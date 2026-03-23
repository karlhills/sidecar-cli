import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createEvent } from './event-service.js';
import type { EventType } from '../types/models.js';
import type { ApiEvent } from '../types/api.js';

const eventTypeSchema = z.enum([
  'note',
  'decision',
  'worklog',
  'task_created',
  'task_completed',
  'summary_generated',
]);

const createdBySchema = z.enum(['human', 'agent', 'system']).default('system');
const sourceSchema = z.enum(['cli', 'imported', 'generated']).default('cli');

export const eventIngestSchema = z
  .object({
    type: eventTypeSchema,
    title: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    details_json: z.record(z.string(), z.unknown()).optional(),
    created_by: createdBySchema.optional(),
    source: sourceSchema.optional(),
    session_id: z.number().int().positive().nullable().optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.type === 'decision') {
      if (!payload.title) ctx.addIssue({ code: 'custom', path: ['title'], message: 'title is required for decision events' });
      if (!payload.summary) ctx.addIssue({ code: 'custom', path: ['summary'], message: 'summary is required for decision events' });
      return;
    }

    if (payload.type === 'summary_generated') return;

    if (!payload.summary) {
      ctx.addIssue({ code: 'custom', path: ['summary'], message: `summary is required for ${payload.type} events` });
    }
  });

export type EventIngestPayload = z.infer<typeof eventIngestSchema>;

export function ingestEvent(db: DatabaseSync, input: { project_id: number; payload: EventIngestPayload }): ApiEvent {
  const payload = eventIngestSchema.parse(input.payload);

  const title =
    payload.title ??
    (payload.type === 'note'
      ? 'Note'
      : payload.type === 'worklog'
        ? 'Worklog entry'
        : payload.type === 'task_created'
          ? 'Task created'
          : payload.type === 'task_completed'
            ? 'Task completed'
            : payload.type === 'summary_generated'
              ? 'Summary refreshed'
              : 'Event');

  const summary = payload.summary ?? '';

  const eventId = createEvent(db, {
    projectId: input.project_id,
    type: payload.type as EventType,
    title,
    summary,
    details: payload.details_json ?? {},
    createdBy: payload.created_by ?? 'system',
    source: payload.source ?? 'cli',
    sessionId: payload.session_id ?? null,
  });

  return {
    id: eventId,
    type: payload.type,
    title,
    summary,
    details_json: payload.details_json ?? {},
    created_by: payload.created_by ?? 'system',
    source: payload.source ?? 'cli',
    session_id: payload.session_id ?? null,
  };
}
