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

export function compilePromptMarkdown(input: CompilePromptInput): string {
  const { task, run, runner, agentRole, linkedContext } = input;
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
  lines.push(section('In scope', bullets(task.scope.in_scope)));
  lines.push(section('Out of scope', bullets(task.scope.out_of_scope)));
  lines.push(section('Read these first', bullets(task.implementation.files_to_read)));
  lines.push(section('Avoid changing', bullets(task.implementation.files_to_avoid)));

  const relatedDecisions = linkedContext?.related_decisions ?? task.context.related_decisions;
  const relatedNotes = linkedContext?.related_notes ?? task.context.related_notes;
  lines.push(
    section('Linked context', [
      ...bullets(relatedDecisions, '- no related decisions'),
      ...bullets(relatedNotes, '- no related notes'),
    ])
  );

  lines.push(
    section('Constraints', [
      ...bullets(task.constraints.technical, '- no technical constraints'),
      ...bullets(task.constraints.design, '- no design constraints'),
    ])
  );
  lines.push(section('Validation', bullets(task.execution.commands.validation)));
  lines.push(section('Definition of done', bullets(task.definition_of_done)));
  lines.push(section('Runner guidance', runnerGuidance(runner)));
  lines.push(section('Final response format', finalResponseFormat(runner)));

  return `${lines.join('\n').trim()}\n`;
}

export function saveCompiledPrompt(rootPath: string, runId: string, markdown: string): string {
  const promptsPath = getSidecarPaths(rootPath).promptsPath;
  fs.mkdirSync(promptsPath, { recursive: true });
  const promptPath = path.join(promptsPath, `${runId}.md`);
  fs.writeFileSync(promptPath, markdown, 'utf8');
  return promptPath;
}
