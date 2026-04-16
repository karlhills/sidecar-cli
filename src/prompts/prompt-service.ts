import { createRunRecordEntry, updateRunRecordEntry } from '../runs/run-service.js';
import type { RunnerType } from '../runs/run-record.js';
import { getTaskPacket } from '../tasks/task-service.js';
import { compilePromptMarkdown, saveCompiledPrompt, type PromptLinkedContext } from './prompt-compiler.js';

export interface CompileTaskPromptInput {
  rootPath: string;
  taskId: string;
  runner: RunnerType;
  agentRole: string;
  linkedContext?: PromptLinkedContext;
}

export interface CompileTaskPromptResult {
  run_id: string;
  task_id: string;
  runner_type: RunnerType;
  agent_role: string;
  prompt_path: string;
  prompt_markdown: string;
  prompt_optimization: {
    estimated_tokens_before: number;
    estimated_tokens_after: number;
    budget_target: number;
    budget_max: number;
    trimmed_sections: string[];
  };
}

export function compileTaskPrompt(input: CompileTaskPromptInput): CompileTaskPromptResult {
  const task = getTaskPacket(input.rootPath, input.taskId);

  const created = createRunRecordEntry(input.rootPath, {
    task_id: task.task_id,
    runner_type: input.runner,
    agent_role: input.agentRole,
    status: 'preparing',
    branch: task.tracking.branch,
    worktree: task.tracking.worktree,
  });

  const compiledPrompt = compilePromptMarkdown({
    task,
    run: created.run,
    runner: input.runner,
    agentRole: input.agentRole,
    linkedContext: input.linkedContext,
  });

  const promptPath = saveCompiledPrompt(input.rootPath, created.run.run_id, compiledPrompt.markdown);
  updateRunRecordEntry(input.rootPath, created.run.run_id, {
    status: 'queued',
    prompt_path: promptPath,
    prompt_tokens_estimated_before: compiledPrompt.metadata.estimated_tokens_before,
    prompt_tokens_estimated_after: compiledPrompt.metadata.estimated_tokens_after,
    prompt_budget_target: compiledPrompt.metadata.budget_target,
    prompt_trimmed_sections: compiledPrompt.metadata.trimmed_sections,
    summary: `Compiled prompt for task ${task.task_id} (${compiledPrompt.metadata.estimated_tokens_before} -> ${compiledPrompt.metadata.estimated_tokens_after} est. tokens)`,
  });

  return {
    run_id: created.run.run_id,
    task_id: task.task_id,
    runner_type: input.runner,
    agent_role: input.agentRole,
    prompt_path: promptPath,
    prompt_markdown: compiledPrompt.markdown,
    prompt_optimization: compiledPrompt.metadata,
  };
}
