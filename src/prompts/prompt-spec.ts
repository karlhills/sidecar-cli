// Freestanding prompt spec loader. Parses a `.yaml`/`.yml`/`.json` file into
// the `CompileSectionsInput` shape used by the core compiler — no TaskPacket
// required. Intended for quick prompt iteration (`sidecar prompt compile
// prompt.yaml`) and as an agent-facing primitive for composing prompts
// programmatically.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PROMPT_PREFERENCE_DEFAULTS } from '../runners/config.js';
import type { CompileSectionsInput, ListSection, Section, TextSection, TrimPolicy } from './sections.js';

const trimPolicySchema = z.enum(['keep', 'trim-last', 'drop']);

const trimConfigSchema = z
  .object({
    policy: trimPolicySchema.optional(),
    limit: z.number().int().positive().optional(),
    limit_strict: z.number().int().positive().optional(),
    overflow_label: z.string().optional(),
  })
  .strict();

// `content` accepts either a text block (string or string[]) or a list
// (`list: []`). A section is a text section when `content` is a string or
// single-item array without `list`; a list section when `list` is present.
const sectionSpecSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1),
    required: z.boolean().optional(),
    // text content:
    content: z.union([z.string(), z.array(z.string())]).optional(),
    // list content:
    list: z.array(z.string()).optional(),
    empty_placeholder: z.string().optional(),
    trim: z.union([trimPolicySchema, trimConfigSchema]).optional(),
  })
  .strict();

const budgetSchema = z
  .object({
    target: z.number().int().positive().optional(),
    max: z.number().int().positive().optional(),
  })
  .strict();

export const promptSpecSchema = z
  .object({
    header: z.union([z.string(), z.array(z.string())]).optional(),
    sections: z.array(sectionSpecSchema).min(1),
    budget: budgetSchema.optional(),
    policy_overrides: z.record(z.string(), trimPolicySchema).optional(),
  })
  .strict();

export type PromptSpec = z.infer<typeof promptSpecSchema>;

function toLines(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return value.split('\n').map((l) => l.replace(/\s+$/, ''));
  return value;
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'section';
}

function resolveTrim(entry: z.infer<typeof sectionSpecSchema>, isList: boolean): {
  policy: TrimPolicy;
  config?: Exclude<z.infer<typeof trimConfigSchema>, undefined>;
} {
  if (entry.required) return { policy: 'keep' };
  const t = entry.trim;
  if (t == null) return { policy: 'keep' };
  if (typeof t === 'string') return { policy: t };
  const policy: TrimPolicy = t.policy ?? (isList ? 'trim-last' : 'keep');
  return { policy, config: t };
}

function toSection(entry: z.infer<typeof sectionSpecSchema>, index: number): Section {
  const id = entry.id?.trim() || `${slugifyTitle(entry.title)}_${index + 1}`;
  const isList = entry.list != null;
  const trim = resolveTrim(entry, isList);

  if (isList) {
    const items = entry.list ?? [];
    const section: ListSection = {
      id,
      title: entry.title,
      kind: 'list',
      items,
      ...(entry.empty_placeholder ? { empty_placeholder: entry.empty_placeholder } : {}),
      trim: {
        policy: trim.policy,
        ...(trim.config?.limit ? { limit: trim.config.limit } : {}),
        ...(trim.config?.limit_strict ? { limit_strict: trim.config.limit_strict } : {}),
        ...(trim.config?.overflow_label ? { overflow_label: trim.config.overflow_label } : {}),
      },
    };
    return section;
  }

  const section: TextSection = {
    id,
    title: entry.title,
    kind: 'text',
    content: toLines(entry.content),
    ...(trim.policy === 'keep' || trim.policy === 'drop' ? { trim: trim.policy } : { trim: 'keep' }),
  };
  return section;
}

export function specToCompileInput(spec: PromptSpec): CompileSectionsInput {
  const header = toLines(spec.header);
  const sections = spec.sections.map((s, i) => toSection(s, i));
  const target = spec.budget?.target ?? PROMPT_PREFERENCE_DEFAULTS.budget_target;
  const max = spec.budget?.max ?? Math.max(target, PROMPT_PREFERENCE_DEFAULTS.budget_max);
  return {
    ...(header.length > 0 ? { header } : {}),
    sections,
    budget: { target, max },
    ...(spec.policy_overrides ? { policy_overrides: spec.policy_overrides } : {}),
  };
}

export function parsePromptSpec(raw: string, format: 'yaml' | 'json'): PromptSpec {
  const parsed = format === 'json' ? JSON.parse(raw) : parseYaml(raw);
  return promptSpecSchema.parse(parsed);
}

export function loadPromptSpec(specPath: string): { spec: PromptSpec; input: CompileSectionsInput } {
  const abs = path.resolve(specPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  const format = ext === '.json' ? 'json' : 'yaml';
  const spec = parsePromptSpec(raw, format);
  return { spec, input: specToCompileInput(spec) };
}
