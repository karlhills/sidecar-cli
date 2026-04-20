import fs from 'node:fs';
import path from 'node:path';
import { getSidecarPaths } from '../lib/paths.js';
import { PROMPT_PREFERENCE_DEFAULTS, type PromptPreferences } from '../runners/config.js';
import type { RunnerType, RunRecord } from '../runs/run-record.js';
import type { TaskPacket } from '../tasks/task-packet.js';
import { compileSections, type CompileSectionsInput, type Section } from './sections.js';
import {
  linkedContextForMode,
  packetToCompileInput,
  type PacketAdapterInput,
  type PromptLinkedContext,
} from './packet-sections.js';

export type { PromptLinkedContext } from './packet-sections.js';

export interface CompilePromptInput {
  task: TaskPacket;
  run: RunRecord;
  runner: RunnerType;
  agentRole: string;
  linkedContext?: PromptLinkedContext;
  budget?: PromptPreferences;
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

// Rebuild the packet adapter output with a specific linked_context trim mode.
// Linked context mixes two sub-lists under a single heading, which the core
// compiler treats as a text section (can't partial-trim), so the wrapper owns
// the two-pass escalation the legacy compiler used.
function packetInputForMode(adapterInput: PacketAdapterInput, mode: 'full' | 'trim' | 'strict'): CompileSectionsInput {
  const baseline = packetToCompileInput(adapterInput);
  if (mode === 'full') return baseline;

  const relatedDecisions = adapterInput.linkedContext?.related_decisions ?? adapterInput.task.context.related_decisions;
  const relatedNotes = adapterInput.linkedContext?.related_notes ?? adapterInput.task.context.related_notes;
  const linkedLines = linkedContextForMode(relatedDecisions, relatedNotes, mode);

  const sections: Section[] = baseline.sections.map((section) => {
    if (section.id !== 'linked_context') return section;
    return { ...section, content: linkedLines };
  });
  return { ...baseline, sections };
}

// Preserve the legacy trimmed_sections names (include related_decisions /
// related_notes) since downstream run records use these keys.
function buildLegacyTrimmed(
  adapterInput: PacketAdapterInput,
  listTrimmed: string[],
  mode: 'full' | 'trim' | 'strict',
): string[] {
  const out = new Set(listTrimmed);
  if (mode !== 'full') {
    const decisions = adapterInput.linkedContext?.related_decisions ?? adapterInput.task.context.related_decisions;
    const notes = adapterInput.linkedContext?.related_notes ?? adapterInput.task.context.related_notes;
    if (mode === 'trim') {
      if (decisions.length > 3) out.add('related_decisions');
      if (notes.length > 2) out.add('related_notes');
    } else {
      if (decisions.length > 1) out.add('related_decisions');
      if (notes.length > 0) out.add('related_notes');
    }
  }
  return [...out];
}

// `policy_overrides` with every list id → 'keep' forces compileSections to
// render the untrimmed baseline. The legacy compiler chose to trim based on
// THIS baseline, not the partially-trimmed first pass, so we do the same to
// preserve byte-identical output for downstream consumers.
function allKeepOverrides(fullInput: CompileSectionsInput): Record<string, 'keep'> {
  const out: Record<string, 'keep'> = {};
  for (const s of fullInput.sections) if (s.kind === 'list') out[s.id] = 'keep';
  return out;
}

export function compilePromptMarkdown(input: CompilePromptInput): CompiledPromptResult {
  const pref = input.budget ?? PROMPT_PREFERENCE_DEFAULTS;
  const adapterInput: PacketAdapterInput = {
    task: input.task,
    run: input.run,
    runner: input.runner,
    agentRole: input.agentRole,
    ...(input.linkedContext ? { linkedContext: input.linkedContext } : {}),
    ...(input.budget ? { budget: input.budget } : {}),
  };

  const fullInput = packetInputForMode(adapterInput, 'full');
  const untrimmed = compileSections({ ...fullInput, policy_overrides: allKeepOverrides(fullInput) });

  // Fast path — the fully untrimmed render fits within the target budget.
  if (untrimmed.metadata.estimated_tokens_after <= pref.budget_target) {
    return {
      markdown: untrimmed.markdown,
      metadata: {
        estimated_tokens_before: untrimmed.metadata.estimated_tokens_before,
        estimated_tokens_after: untrimmed.metadata.estimated_tokens_after,
        budget_target: pref.budget_target,
        budget_max: pref.budget_max,
        trimmed_sections: [],
      },
    };
  }

  // Target pass — trim lists + linked_context.
  const trimInput = packetInputForMode(adapterInput, 'trim');
  const trim = compileSections(trimInput);

  // Strict pass (safety valve) if still over max.
  if (trim.metadata.estimated_tokens_after > pref.budget_max) {
    const strictInput = packetInputForMode(adapterInput, 'strict');
    const strict = compileSections(strictInput);
    return {
      markdown: strict.markdown,
      metadata: {
        estimated_tokens_before: untrimmed.metadata.estimated_tokens_before,
        estimated_tokens_after: strict.metadata.estimated_tokens_after,
        budget_target: pref.budget_target,
        budget_max: pref.budget_max,
        trimmed_sections: buildLegacyTrimmed(adapterInput, strict.metadata.trimmed_sections, 'strict'),
      },
    };
  }

  return {
    markdown: trim.markdown,
    metadata: {
      estimated_tokens_before: untrimmed.metadata.estimated_tokens_before,
      estimated_tokens_after: trim.metadata.estimated_tokens_after,
      budget_target: pref.budget_target,
      budget_max: pref.budget_max,
      trimmed_sections: buildLegacyTrimmed(adapterInput, trim.metadata.trimmed_sections, 'trim'),
    },
  };
}

export function saveCompiledPrompt(rootPath: string, runId: string, markdown: string): string {
  const promptsPath = getSidecarPaths(rootPath).promptsPath;
  fs.mkdirSync(promptsPath, { recursive: true });
  const promptPath = path.join(promptsPath, `${runId}.md`);
  fs.writeFileSync(promptPath, markdown, 'utf8');
  return promptPath;
}
