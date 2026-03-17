export function renderSummaryMarkdown(input: {
  projectName: string;
  projectPath: string;
  generatedAt: string;
  activeSession: { id: number; started_at: string; actor_type: 'human' | 'agent'; actor_name: string | null } | null;
  recentEventCount: number;
  decisions: Array<{ created_at: string; title: string; summary: string }>;
  worklogs: Array<{ created_at: string; title: string; summary: string }>;
  notes: Array<{ created_at: string; title: string; summary: string }>;
  openTasks: Array<{ id: number; title: string; priority: string | null; updated_at: string }>;
  artifacts: Array<{ path: string; kind: string; note: string | null; created_at: string }>;
}): string {
  const lines: string[] = [];
  lines.push('# Project Summary');
  lines.push('');
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push('');

  lines.push('## Overview');
  lines.push(`- Project: ${input.projectName}`);
  lines.push(`- Path: ${input.projectPath}`);
  lines.push(`- Events in last 7 days: ${input.recentEventCount}`);
  lines.push(`- Open tasks: ${input.openTasks.length}`);
  lines.push('');

  lines.push('## Active Session');
  if (!input.activeSession) {
    lines.push('- None');
  } else {
    lines.push(
      `- #${input.activeSession.id} (${input.activeSession.actor_type}${
        input.activeSession.actor_name ? `: ${input.activeSession.actor_name}` : ''
      }) started ${input.activeSession.started_at}`
    );
  }
  lines.push('');

  lines.push('## Recent Decisions');
  if (input.decisions.length === 0) lines.push('- None');
  for (const d of input.decisions) lines.push(`- ${d.created_at} | ${d.title}: ${d.summary}`);
  lines.push('');

  lines.push('## Recent Work');
  if (input.worklogs.length === 0) lines.push('- None');
  for (const w of input.worklogs) lines.push(`- ${w.created_at} | ${w.title}: ${w.summary}`);
  lines.push('');

  lines.push('## Open Tasks');
  if (input.openTasks.length === 0) lines.push('- None');
  for (const t of input.openTasks) lines.push(`- #${t.id} [${t.priority ?? 'n/a'}] ${t.title}`);
  lines.push('');

  lines.push('## Recent Notes');
  if (input.notes.length === 0) lines.push('- None');
  for (const n of input.notes) lines.push(`- ${n.created_at} | ${n.title}: ${n.summary}`);
  lines.push('');

  lines.push('## Artifacts');
  if (input.artifacts.length === 0) lines.push('- None');
  for (const a of input.artifacts) lines.push(`- ${a.created_at} | ${a.kind} | ${a.path}${a.note ? ` - ${a.note}` : ''}`);
  lines.push('');

  return lines.join('\n');
}
