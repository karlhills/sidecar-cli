import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from '../lib/format.js';
import { getSidecarPaths } from '../lib/paths.js';
import type { RunnerType, RunRecord } from '../runs/run-record.js';
import type { TaskPacket } from '../tasks/task-packet.js';

export interface PromptLinkedContext {
  related_decisions?: string[];
  related_notes?: string[];
}

export interface CompilePromptInput {
  task: TaskPacket;
  run: RunRecord;
  runner: RunnerType;
  agentRole: string;
  linkedContext?: PromptLinkedContext;
}

export interface CompiledPromptMetadata {
  estimated_tokens_before: number;
  estimated_tokens_after: number;
  budget_target: number;
  budget_max: number;
  trimmed_sections: string[];
}

export interface CompiledPromptResult {
  markdown: string;
  metadata: CompiledPromptMetadata;
}

type PromptLists = {
  inScope: string[];
  outOfScope: string[];
  filesToRead: string[];
  filesToAvoid: string[];
  relatedDecisions: string[];
  relatedNotes: string[];
  technicalConstraints: string[];
  designConstraints: string[];
  validationCommands: string[];
  definitionOfDone: string[];
};

const PROMPT_BUDGET_TARGET = 1200;
const PROMPT_BUDGET_MAX = 1500;

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines, ''].join('\n');
}

function bullets(items: string[], empty = '- none'): string[] {
  if (items.length === 0) return [empty];
  return items.map((item) => `- ${item}`);
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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.map((v) => v.trim()).filter(Boolean)) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function withOverflow(items: string[], fullCount: number, label: string): string[] {
  const overflow = fullCount - items.length;
  if (overflow <= 0) return items;
  return [...items, `+ ${overflow} more ${label} (see task packet for full list)`];
}

function buildPromptLists(input: CompilePromptInput): PromptLists {
  const { task, linkedContext } = input;
  return {
    inScope: dedupe(task.scope.in_scope),
    outOfScope: dedupe(task.scope.out_of_scope),
    filesToRead: dedupe(task.implementation.files_to_read),
    filesToAvoid: dedupe(task.implementation.files_to_avoid),
    relatedDecisions: dedupe(linkedContext?.related_decisions ?? task.context.related_decisions),
    relatedNotes: dedupe(linkedContext?.related_notes ?? task.context.related_notes),
    technicalConstraints: dedupe(task.constraints.technical),
    designConstraints: dedupe(task.constraints.design),
    validationCommands: dedupe(task.execution.commands.validation),
    definitionOfDone: dedupe(task.definition_of_done),
  };
}

function renderPrompt(input: CompilePromptInput, lists: PromptLists): string {
  const { task, run, runner, agentRole } = input;
  const lines: string[] = [];

  lines.push('# Sidecar Execution Brief');
  lines.push('');
  lines.push(`Runner: ${runner}`);
  lines.push(`Agent role: ${agentRole}`);
  lines.push(`Run id: ${run.run_id}`);
  lines.push(`Task id: ${task.task_id}`);
  lines.push(`Compiled at: ${nowIso()}`);
  lines.push('');

  lines.push(
    section('Task', [
      `- ${task.title}`,
      `- Type: ${task.type}`,
      `- Priority: ${task.priority}`,
      `- Status: ${task.status}`,
    ])
  );
  lines.push(section('Objective', [task.goal]));
  lines.push(section('Why this matters', [task.summary]));
  lines.push(section('In scope', bullets(lists.inScope)));
  lines.push(section('Out of scope', bullets(lists.outOfScope)));
  lines.push(section('Read these first', bullets(lists.filesToRead)));
  lines.push(section('Avoid changing', bullets(lists.filesToAvoid)));

  lines.push(
    section('Linked context', [
      ...bullets(lists.relatedDecisions, '- no related decisions'),
      ...bullets(lists.relatedNotes, '- no related notes'),
    ])
  );

  lines.push(
    section('Constraints', [
      ...bullets(lists.technicalConstraints, '- no technical constraints'),
      ...bullets(lists.designConstraints, '- no design constraints'),
    ])
  );
  lines.push(section('Validation', bullets(lists.validationCommands)));
  lines.push(section('Definition of done', bullets(lists.definitionOfDone)));
  lines.push(section('Runner guidance', runnerGuidance(runner)));
  lines.push(section('Final response format', finalResponseFormat(runner)));

  return `${lines.join('\n').trim()}\n`;
}

function applyPromptBudget(input: CompilePromptInput): {
  optimizedLists: PromptLists;
  metadata: CompiledPromptMetadata;
} {
  const baseline = buildPromptLists(input);
  const baselineMarkdown = renderPrompt(input, baseline);
  const baselineTokens = estimateTokens(baselineMarkdown);
  if (baselineTokens <= PROMPT_BUDGET_TARGET) {
    return {
      optimizedLists: baseline,
      metadata: {
        estimated_tokens_before: baselineTokens,
        estimated_tokens_after: baselineTokens,
        budget_target: PROMPT_BUDGET_TARGET,
        budget_max: PROMPT_BUDGET_MAX,
        trimmed_sections: [],
      },
    };
  }

  const optimized: PromptLists = {
    ...baseline,
    inScope: withOverflow(baseline.inScope.slice(0, 8), baseline.inScope.length, 'in-scope items'),
    outOfScope: withOverflow(baseline.outOfScope.slice(0, 5), baseline.outOfScope.length, 'out-of-scope items'),
    filesToRead: withOverflow(baseline.filesToRead.slice(0, 10), baseline.filesToRead.length, 'read-first files'),
    filesToAvoid: withOverflow(baseline.filesToAvoid.slice(0, 5), baseline.filesToAvoid.length, 'avoid files'),
    relatedDecisions: withOverflow(baseline.relatedDecisions.slice(0, 3), baseline.relatedDecisions.length, 'decisions'),
    relatedNotes: withOverflow(baseline.relatedNotes.slice(0, 2), baseline.relatedNotes.length, 'notes'),
  };

  let optimizedMarkdown = renderPrompt(input, optimized);
  let optimizedTokens = estimateTokens(optimizedMarkdown);

  // Safety valve for unusually large tasks: preserve must-have sections and thin optional context further.
  if (optimizedTokens > PROMPT_BUDGET_MAX) {
    optimized.relatedDecisions = withOverflow(baseline.relatedDecisions.slice(0, 1), baseline.relatedDecisions.length, 'decisions');
    optimized.relatedNotes = withOverflow([], baseline.relatedNotes.length, 'notes');
    optimized.outOfScope = withOverflow(baseline.outOfScope.slice(0, 3), baseline.outOfScope.length, 'out-of-scope items');
    optimized.filesToAvoid = withOverflow(baseline.filesToAvoid.slice(0, 3), baseline.filesToAvoid.length, 'avoid files');
    optimizedMarkdown = renderPrompt(input, optimized);
    optimizedTokens = estimateTokens(optimizedMarkdown);
  }

  const trimmedSections: string[] = [];
  if (optimized.inScope.length < baseline.inScope.length) trimmedSections.push('in_scope');
  if (optimized.outOfScope.length < baseline.outOfScope.length) trimmedSections.push('out_of_scope');
  if (optimized.filesToRead.length < baseline.filesToRead.length) trimmedSections.push('files_to_read');
  if (optimized.filesToAvoid.length < baseline.filesToAvoid.length) trimmedSections.push('files_to_avoid');
  if (optimized.relatedDecisions.length < baseline.relatedDecisions.length) trimmedSections.push('related_decisions');
  if (optimized.relatedNotes.length < baseline.relatedNotes.length) trimmedSections.push('related_notes');

  return {
    optimizedLists: optimized,
    metadata: {
      estimated_tokens_before: baselineTokens,
      estimated_tokens_after: optimizedTokens,
      budget_target: PROMPT_BUDGET_TARGET,
      budget_max: PROMPT_BUDGET_MAX,
      trimmed_sections: trimmedSections,
    },
  };
}

export function compilePromptMarkdown(input: CompilePromptInput): CompiledPromptResult {
  const optimized = applyPromptBudget(input);
  return {
    markdown: renderPrompt(input, optimized.optimizedLists),
    metadata: optimized.metadata,
  };
}

export function saveCompiledPrompt(rootPath: string, runId: string, markdown: string): string {
  const promptsPath = getSidecarPaths(rootPath).promptsPath;
  fs.mkdirSync(promptsPath, { recursive: true });
  const promptPath = path.join(promptsPath, `${runId}.md`);
  fs.writeFileSync(promptPath, markdown, 'utf8');
  return promptPath;
}
