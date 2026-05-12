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

function finalResponseFormat(runner: RunnerType): string[] {
  if (runner === 'codex') {
    return [
      '- Start with a one-line outcome summary.',
      '- List files changed with concise reasons.',
      '- Include validation command output.',
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

function renderLinkedContext(
  relatedDecisions: string[],
  relatedNotes: string[],
  mode: 'full' | 'trim' | 'strict',
): string[] {
  const lines: string[] = [];
  const decisions = mode === 'full'
    ? relatedDecisions
    : mode === 'trim'
      ? relatedDecisions.slice(0, 3)
      : relatedDecisions.slice(0, 1);
  const notes = mode === 'full'
    ? relatedNotes
    : mode === 'trim'
      ? relatedNotes.slice(0, 2)
      : [];

  if (decisions.length > 0) {
    lines.push('Decisions:');
    for (const d of decisions) lines.push(`- ${d}`);
  }
  if (notes.length > 0) {
    lines.push('Notes:');
    for (const n of notes) lines.push(`- ${n}`);
  }
  if (lines.length === 0) lines.push('- no linked context');
  return lines;
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
      if (prev.changed_files.length > limited.length) lines.push(`  - + ${prev.changed_files.length - limited.length} more`);
    }
  });
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

  const relatedDecisions = linkedContext?.related_decisions ?? [];
  const relatedNotes = linkedContext?.related_notes ?? [];

  const sections: Section[] = [
    textSection('task', 'Task', [
      `- ${task.title}`,
      `- Priority: ${task.priority}`,
      `- Status: ${task.status}`,
      `- Created: ${task.created_at}`,
    ]),
    textSection('objective', 'Objective', [task.summary]),
    textSection('trigger', 'Trigger', [
      `- Condition: ${task.trigger.condition}`,
      ...(task.trigger.check_command ? [`- Verify: \`${task.trigger.check_command}\``] : []),
      ...(task.trigger.depends_on.length > 0 ? [`- Depends on: ${task.trigger.depends_on.join(', ')}`] : []),
    ]),
    listSection('entry_points', 'Entry points', task.entry_points, {
      trim: { policy: 'trim-last', limit: 3, limit_strict: 3, overflow_label: 'entry points' },
    }),
    textSection('definition_of_done', 'Definition of done', [task.done_condition]),
    textSection('validation', 'Validation command', [`\`${task.validation_command}\``]),
    textSection('linked_context', 'Linked context', renderLinkedContext(relatedDecisions, relatedNotes, 'full')),
    ...(linkedContext?.previous_runs && linkedContext.previous_runs.length > 0
      ? [textSection('previous_runs', 'Previous runner context', renderPreviousRuns(linkedContext.previous_runs))]
      : []),
    textSection('runner_guidance', 'Runner guidance', runnerGuidance(runner)),
    textSection('final_response_format', 'Final response format', finalResponseFormat(runner)),
  ];

  return {
    header,
    sections,
    budget: { target: pref.budget_target, max: pref.budget_max },
  };
}

export function linkedContextForMode(
  relatedDecisions: string[],
  relatedNotes: string[],
  mode: 'full' | 'trim' | 'strict',
): string[] {
  return renderLinkedContext(relatedDecisions, relatedNotes, mode);
}
