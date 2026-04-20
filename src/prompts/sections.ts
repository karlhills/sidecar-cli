// Runner-agnostic, packet-agnostic prompt compiler.
//
// A section is either a block of raw text (`kind: 'text'`) or a bulleted list
// (`kind: 'list'`). Each section carries a stable `id` so callers — and the
// `--section-policy`/`--explain` CLI surfaces — can reference it without
// depending on the rendered title. The core does three jobs: (1) render to
// markdown, (2) apply per-section trim policies under a token budget,
// (3) produce a trace explaining what happened to each section.
//
// The `TaskPacket` adapter lives in `packet-sections.ts` and re-uses this
// primitive. Freestanding `.yaml`/`.json` spec files use the same type surface
// via `prompt-spec.ts`.

export type TrimPolicy = 'keep' | 'trim-last' | 'drop';

export interface SectionTrim {
  policy: TrimPolicy;
  // For 'trim-last', cap the list at this many items on the first trim pass.
  limit?: number;
  // Stricter cap for the safety-valve pass when we're still over budget_max.
  limit_strict?: number;
  // Rendered as "+ N more <label>" when items are truncated. If omitted and
  // trimming occurs, no overflow line is emitted.
  overflow_label?: string;
}

export interface TextSection {
  id: string;
  title: string;
  kind: 'text';
  content: string[]; // each element is one line of text under the heading
  // text sections can be dropped under budget pressure, but never partially trimmed
  trim?: Extract<TrimPolicy, 'keep' | 'drop'>;
}

export interface ListSection {
  id: string;
  title: string;
  kind: 'list';
  items: string[];
  // Rendered when items[] is empty; defaults to '- none'.
  empty_placeholder?: string;
  trim?: SectionTrim;
}

export type Section = TextSection | ListSection;

export interface CompileSectionsInput {
  // Lines rendered before any section, verbatim. Followed by a blank line.
  header?: string[];
  sections: Section[];
  budget: { target: number; max: number };
  // Overrides `trim.policy` for sections by id. Invalid ids are ignored.
  policy_overrides?: Record<string, TrimPolicy>;
}

export interface SectionTrace {
  id: string;
  title: string;
  kind: 'text' | 'list';
  policy_applied: TrimPolicy;
  total_items?: number;
  kept_items?: number;
  was_trimmed: boolean;
  was_dropped: boolean;
  estimated_tokens: number;
}

export interface CompileSectionsMetadata {
  estimated_tokens_before: number;
  estimated_tokens_after: number;
  budget_target: number;
  budget_max: number;
  trimmed_sections: string[]; // section ids
  dropped_sections: string[]; // section ids
  sections: SectionTrace[];
}

export interface CompileSectionsResult {
  markdown: string;
  metadata: CompileSectionsMetadata;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function dedupeList(items: string[]): string[] {
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

function renderSection(section: Section, items?: string[]): string {
  if (section.kind === 'text') {
    const lines = [`## ${section.title}`, ...section.content, ''];
    return lines.join('\n');
  }
  const rendered = items ?? section.items;
  const empty = section.empty_placeholder ?? '- none';
  const body = rendered.length === 0 ? [empty] : rendered.map((v) => (v.startsWith('- ') ? v : `- ${v}`));
  return [`## ${section.title}`, ...body, ''].join('\n');
}

function renderAll(input: CompileSectionsInput, listItemsById: Map<string, string[]>, droppedIds: Set<string>): string {
  const lines: string[] = [];
  if (input.header && input.header.length > 0) {
    lines.push(...input.header);
    lines.push('');
  }
  for (const section of input.sections) {
    if (droppedIds.has(section.id)) continue;
    if (section.kind === 'list') {
      lines.push(renderSection(section, listItemsById.get(section.id) ?? section.items));
    } else {
      lines.push(renderSection(section));
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

function applyListTrim(section: ListSection, limit: number | undefined): string[] {
  const deduped = dedupeList(section.items);
  if (limit == null || deduped.length <= limit) return deduped;
  const kept = deduped.slice(0, limit);
  const overflow = deduped.length - kept.length;
  if (overflow > 0 && section.trim?.overflow_label) {
    kept.push(`+ ${overflow} more ${section.trim.overflow_label} (see task packet for full list)`);
  }
  return kept;
}

function sectionTokens(section: Section, items?: string[]): number {
  return estimateTokens(renderSection(section, items));
}

function effectivePolicy(section: Section, overrides?: Record<string, TrimPolicy>): TrimPolicy {
  const override = overrides?.[section.id];
  if (override) return override;
  if (section.kind === 'text') return section.trim ?? 'keep';
  return section.trim?.policy ?? 'keep';
}

export function compileSections(input: CompileSectionsInput): CompileSectionsResult {
  const { target, max } = input.budget;

  // Pass 1 — baseline: dedupe lists, no trimming.
  const baseItems = new Map<string, string[]>();
  for (const section of input.sections) {
    if (section.kind === 'list') baseItems.set(section.id, dedupeList(section.items));
  }
  const baselineMarkdown = renderAll(input, baseItems, new Set());
  const baselineTokens = estimateTokens(baselineMarkdown);

  // Fast path — fits within target, nothing to trim.
  if (baselineTokens <= target) {
    const traces: SectionTrace[] = input.sections.map((section) => {
      const items = section.kind === 'list' ? baseItems.get(section.id) ?? [] : undefined;
      return {
        id: section.id,
        title: section.title,
        kind: section.kind,
        policy_applied: effectivePolicy(section, input.policy_overrides),
        ...(section.kind === 'list' ? { total_items: dedupeList(section.items).length, kept_items: items?.length ?? 0 } : {}),
        was_trimmed: false,
        was_dropped: false,
        estimated_tokens: sectionTokens(section, items),
      };
    });
    return {
      markdown: baselineMarkdown,
      metadata: {
        estimated_tokens_before: baselineTokens,
        estimated_tokens_after: baselineTokens,
        budget_target: target,
        budget_max: max,
        trimmed_sections: [],
        dropped_sections: [],
        sections: traces,
      },
    };
  }

  // Pass 2 — target trim: apply `limit` to each trim-last list (except keep).
  const passItems = new Map<string, string[]>();
  const droppedIds = new Set<string>();
  for (const section of input.sections) {
    if (section.kind !== 'list') continue;
    const policy = effectivePolicy(section, input.policy_overrides);
    if (policy === 'keep') {
      passItems.set(section.id, dedupeList(section.items));
    } else if (policy === 'drop') {
      // leave droppedIds decision for the strict pass
      passItems.set(section.id, dedupeList(section.items));
    } else {
      // trim-last
      passItems.set(section.id, applyListTrim(section, section.trim?.limit));
    }
  }
  let markdown = renderAll(input, passItems, droppedIds);
  let tokens = estimateTokens(markdown);

  // Pass 3 — strict pass: apply limit_strict, then drop `drop`-policy sections.
  if (tokens > max) {
    for (const section of input.sections) {
      const policy = effectivePolicy(section, input.policy_overrides);
      if (policy === 'drop') {
        droppedIds.add(section.id);
        continue;
      }
      if (section.kind === 'list' && policy === 'trim-last') {
        passItems.set(section.id, applyListTrim(section, section.trim?.limit_strict ?? section.trim?.limit));
      }
    }
    markdown = renderAll(input, passItems, droppedIds);
    tokens = estimateTokens(markdown);
  }

  const traces: SectionTrace[] = input.sections.map((section) => {
    const policy = effectivePolicy(section, input.policy_overrides);
    const isDropped = droppedIds.has(section.id);
    if (section.kind === 'list') {
      const total = dedupeList(section.items).length;
      const kept = isDropped ? 0 : passItems.get(section.id)?.length ?? 0;
      const overflowLine = section.trim?.overflow_label ? 1 : 0;
      const realKept = Math.max(0, kept - overflowLine);
      return {
        id: section.id,
        title: section.title,
        kind: 'list',
        policy_applied: policy,
        total_items: total,
        kept_items: realKept,
        was_trimmed: !isDropped && realKept < total,
        was_dropped: isDropped,
        estimated_tokens: isDropped ? 0 : sectionTokens(section, passItems.get(section.id)),
      };
    }
    return {
      id: section.id,
      title: section.title,
      kind: 'text',
      policy_applied: policy,
      was_trimmed: false,
      was_dropped: isDropped,
      estimated_tokens: isDropped ? 0 : sectionTokens(section),
    };
  });

  return {
    markdown,
    metadata: {
      estimated_tokens_before: baselineTokens,
      estimated_tokens_after: tokens,
      budget_target: target,
      budget_max: max,
      trimmed_sections: traces.filter((t) => t.was_trimmed).map((t) => t.id),
      dropped_sections: traces.filter((t) => t.was_dropped).map((t) => t.id),
      sections: traces,
    },
  };
}
