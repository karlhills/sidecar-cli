// Adapter from TaskPacket → CompileSectionsInput. Mirrors the legacy packet
// layout exactly so `sidecar run <task-id>` produces byte-identical prompts
// after the compiler refactor. Snapshot-guarded in `prompts.compat.test`.

import { nowIso } from '../lib/format.js';
import { PROMPT_PREFERENCE_DEFAULTS, type PromptPreferences } from '../runners/config.js';
import type { RunnerType, RunRecord } from '../runs/run-record.js';
import type { TaskPacket } from '../tasks/task-packet.js';
import type { CompileSectionsInput, ListSection, Section, TextSection } from './sections.js';

export interface PreviousRunSummary {
  run_id: string;
  runner: string;
  agent_role: string;
  status: string;
  summary?: string;
  changed_files?: string[];
  validation_summary?: string;
  log_tail?: string;
}

export interface PromptLinkedContext {
  related_decisions?: string[];
  related_notes?: string[];
  previous_runs?: PreviousRunSummary[];
}

export interface PacketAdapterInput {
  task: TaskPacket;
  run: RunRecord;
  runner: RunnerType;
  agentRole: string;
  linkedContext?: PromptLinkedContext;
  budget?: PromptPreferences;
}

function finalResponseFormat(runner: RunnerType): string[] {
  if (runner === 'codex') {
    return [
      '- Start with a one-line outcome summary.',
      '- List files changed with concise reasons.',
      '- Include validation commands run and their results.',
      '- Note risks, blockers, or follow-up tasks.',
    ];
  }
  return [
    '- Use a brief plan -> implementation -> summary structure.',
    '- Call out assumptions and tradeoffs explicitly.',
    '- List changed files and validation results.',
    '- End with remaining risks and next steps if any.',
  ];
}

function runnerGuidance(runner: RunnerType): string[] {
  if (runner === 'codex') {
    return [
      'Work directly in this repository and keep changes tightly scoped to the task.',
      'Prefer existing project helpers and patterns over introducing new abstractions.',
      'Keep final reporting concise and implementation-focused.',
    ];
  }
  return [
    'Begin with a short plan, then execute changes in small coherent steps.',
    'Explain implementation choices and tradeoffs briefly as you go.',
    'Provide a clear summary with validation and follow-up notes at the end.',
  ];
}

function textSection(id: string, title: string, content: string[]): TextSection {
  return { id, title, kind: 'text', content, trim: 'keep' };
}

function listSection(
  id: string,
  title: string,
  items: string[],
  options?: {
    empty_placeholder?: string;
    trim?: ListSection['trim'];
  },
): ListSection {
  return {
    id,
    title,
    kind: 'list',
    items,
    ...(options?.empty_placeholder ? { empty_placeholder: options.empty_placeholder } : {}),
    ...(options?.trim ? { trim: options.trim } : { trim: { policy: 'keep' } }),
  };
}

function validationLine(v: { kind: string; command: string; name?: string }): string {
  const label = v.name ? `${v.kind}:${v.name}` : v.kind;
  return v.kind === 'custom' ? v.command : `${label} — \`${v.command}\``;
}

// Linked context uses two sub-lists (decisions + notes) under one heading. The
// legacy layout merged them so we render as a single `text` section whose
// content is the pre-formatted bullet list, and trim by hand before handing it
// to the core. That keeps byte-identical output without teaching the core
// about multi-list sections.
function renderLinkedContext(
  relatedDecisions: string[],
  relatedNotes: string[],
  mode: 'full' | 'trim' | 'strict',
): string[] {
  const lines: string[] = [];
  const decisions = mode === 'full'
    ? relatedDecisions
    : mode === 'trim'
      ? sliceWithOverflow(relatedDecisions, 3, 'decisions')
      : sliceWithOverflow(relatedDecisions, 1, 'decisions');
  const notes = mode === 'full'
    ? relatedNotes
    : mode === 'trim'
      ? sliceWithOverflow(relatedNotes, 2, 'notes')
      : sliceWithOverflow(relatedNotes, 0, 'notes');

  if (decisions.length === 0) lines.push('- no related decisions');
  else for (const d of decisions) lines.push(`- ${d}`);
  if (notes.length === 0) lines.push('- no related notes');
  else for (const n of notes) lines.push(`- ${n}`);
  return lines;
}

function sliceWithOverflow(items: string[], limit: number, label: string): string[] {
  if (items.length <= limit) return items;
  const kept = items.slice(0, limit);
  kept.push(`+ ${items.length - limit} more ${label} (see task packet for full list)`);
  return kept;
}

function renderPreviousRuns(runs: PreviousRunSummary[]): string[] {
  const lines: string[] = [];
  runs.forEach((prev, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`### ${prev.run_id} — ${prev.runner} (${prev.agent_role})`);
    lines.push(`- Status: ${prev.status}`);
    if (prev.validation_summary) lines.push(`- Validation: ${prev.validation_summary}`);
    if (prev.summary) lines.push(`- Summary: ${prev.summary}`);
    if (prev.changed_files && prev.changed_files.length > 0) {
      const limited = prev.changed_files.slice(0, 12);
      lines.push(`- Changed files (${prev.changed_files.length}):`);
      for (const f of limited) lines.push(`  - ${f}`);
      if (prev.changed_files.length > limited.length) {
        lines.push(`  - + ${prev.changed_files.length - limited.length} more (see run record)`);
      }
    }
    if (prev.log_tail) {
      lines.push('- Log tail:');
      lines.push('```');
      for (const line of prev.log_tail.split('\n')) lines.push(line);
      lines.push('```');
    }
  });
  return lines;
}

function renderConstraints(technical: string[], design: string[]): string[] {
  const lines: string[] = [];
  if (technical.length === 0) lines.push('- no technical constraints');
  else for (const t of technical) lines.push(`- ${t}`);
  if (design.length === 0) lines.push('- no design constraints');
  else for (const d of design) lines.push(`- ${d}`);
  return lines;
}

export function packetToCompileInput(input: PacketAdapterInput): CompileSectionsInput {
  const { task, run, runner, agentRole, linkedContext, budget } = input;
  const pref = budget ?? PROMPT_PREFERENCE_DEFAULTS;

  const header: string[] = [
    '# Sidecar Execution Brief',
    '',
    `Runner: ${runner}`,
    `Agent role: ${agentRole}`,
    `Run id: ${run.run_id}`,
    `Task id: ${task.task_id}`,
    `Compiled at: ${nowIso()}`,
  ];

  const relatedDecisions = linkedContext?.related_decisions ?? task.context.related_decisions;
  const relatedNotes = linkedContext?.related_notes ?? task.context.related_notes;

  const sections: Section[] = [
    textSection('task', 'Task', [
      `- ${task.title}`,
      `- Type: ${task.type}`,
      `- Priority: ${task.priority}`,
      `- Status: ${task.status}`,
    ]),
    textSection('objective', 'Objective', [task.goal]),
    textSection('why', 'Why this matters', [task.summary]),
    listSection('in_scope', 'In scope', task.scope.in_scope, {
      trim: { policy: 'trim-last', limit: 8, limit_strict: 8, overflow_label: 'in-scope items' },
    }),
    listSection('out_of_scope', 'Out of scope', task.scope.out_of_scope, {
      trim: { policy: 'trim-last', limit: 5, limit_strict: 3, overflow_label: 'out-of-scope items' },
    }),
    listSection('files_to_read', 'Read these first', task.implementation.files_to_read, {
      trim: { policy: 'trim-last', limit: 10, limit_strict: 10, overflow_label: 'read-first files' },
    }),
    listSection('files_to_avoid', 'Avoid changing', task.implementation.files_to_avoid, {
      trim: { policy: 'trim-last', limit: 5, limit_strict: 3, overflow_label: 'avoid files' },
    }),
    // Linked context stays a text section so the "no related X" placeholders stay where they were.
    textSection('linked_context', 'Linked context', renderLinkedContext(relatedDecisions, relatedNotes, 'full')),
    // Previous runner context — only when this run is a later step in a pipeline.
    ...(linkedContext?.previous_runs && linkedContext.previous_runs.length > 0
      ? [textSection('previous_runs', 'Previous runner context', renderPreviousRuns(linkedContext.previous_runs))]
      : []),
    textSection('constraints', 'Constraints', renderConstraints(task.constraints.technical, task.constraints.design)),
    listSection(
      'validation',
      'Validation',
      task.execution.commands.validation.map(validationLine),
    ),
    listSection('definition_of_done', 'Definition of done', task.definition_of_done),
    textSection('runner_guidance', 'Runner guidance', runnerGuidance(runner)),
    textSection('final_response_format', 'Final response format', finalResponseFormat(runner)),
  ];

  return {
    header,
    sections,
    budget: { target: pref.budget_target, max: pref.budget_max },
  };
}

// Legacy metadata expects `trimmed_sections: string[]` using the historical names.
// Map the new core metadata back for back-compat.
export const LEGACY_TRIM_IDS: readonly string[] = [
  'in_scope',
  'out_of_scope',
  'files_to_read',
  'files_to_avoid',
  'related_decisions',
  'related_notes',
];

// Rebuild linked_context lines under a trim mode. The core compileSections()
// can't partially trim a text section, so we run the full pipeline twice in
// prompt-compiler.ts: first with full linked_context, and again with trimmed
// linked_context if the baseline is over budget. See prompt-compiler.ts for
// the wrapper that orchestrates this.
export function linkedContextForMode(
  relatedDecisions: string[],
  relatedNotes: string[],
  mode: 'full' | 'trim' | 'strict',
): string[] {
  return renderLinkedContext(relatedDecisions, relatedNotes, mode);
}
