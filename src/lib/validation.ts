import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'note',
  'worklog',
  'decision',
  'task_update',
  'summary',
  'context',
]);

export const taskPrioritySchema = z.enum(['low', 'medium', 'high']);

export const addEventSchema = z.object({
  type: eventTypeSchema,
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const addTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  priority: taskPrioritySchema.default('medium'),
});

export const completeTaskSchema = z.object({
  id: z.number().int().positive(),
});

export function parseTags(input?: string): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
