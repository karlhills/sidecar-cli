function renderSharedGuide(projectName: string, heading: string): string {
  return `# Sidecar Agent Guide

${heading}

Sidecar is the local project memory tool for this repository.

## MUST before final response

If you changed code, you MUST run these commands in order:

1. \`sidecar context --format markdown\`
2. \`sidecar worklog record --done "<what changed>" --files <paths> --by agent\`
3. if behavior/design/architecture changed: \`sidecar decision record --title "<decision>" --summary "<why>" --by agent\`
4. if follow-up exists: \`sidecar task add "<follow-up>" --priority medium --by agent\`
5. \`sidecar summary refresh\`

## Required workflow

For any code change, run these in order before final response:

1. \`sidecar context --format markdown\`
2. implement changes
3. \`sidecar worklog record ...\`
4. if behavior/design/architecture changed: \`sidecar decision record ...\`
5. \`sidecar summary refresh\`

## Scope rules

- If files changed: always record a worklog.
- If behavior/design choice changed: record a decision.
- If follow-up work exists: add a task.
- Never skip summary refresh after recording work.

## Definition of Done

- [ ] Context reviewed
  - \`sidecar context --format markdown\`
- [ ] Work recorded
  - \`sidecar worklog record --done "<what changed>" --files <paths> --by agent\`
- [ ] Decision recorded when needed
  - \`sidecar decision record --title "<decision>" --summary "<why>" --by agent\`
- [ ] Follow-up task created when needed
  - \`sidecar task add "<follow-up>" --priority medium --by agent\`
- [ ] Summary refreshed
  - \`sidecar summary refresh\`

## Command patterns

- Context: \`sidecar context --format markdown\`
- Worklog: \`sidecar worklog record --done "<what changed>" --files src/a.ts,src/b.ts --by agent\`
- Decision: \`sidecar decision record --title "<title>" --summary "<summary>" --by agent\`
- Task: \`sidecar task add "<follow-up>" --priority medium --by agent\`
- Summary: \`sidecar summary refresh\`

## Example: small feature build

\`\`\`bash
sidecar context --format markdown
# implement small todo app feature in src/app.ts and src/todo.ts
sidecar worklog record --goal "todo feature" --done "Added todo CRUD handlers and wired routes" --files src/app.ts,src/todo.ts --by agent
sidecar decision record --title "Use in-memory store for v1" --summary "Keeps implementation simple for initial feature" --by agent
sidecar task add "Persist todos to sqlite" --priority medium --by agent
sidecar summary refresh
\`\`\`

## Optional hygiene reminder

Run this before final response to catch missed Sidecar logging:

- \`npm run sidecar:reminder\`

Project: ${projectName}.
`;
}

export function renderAgentsMarkdown(projectName: string): string {
  return renderSharedGuide(projectName, 'Use this guide for AI coding agents in this repository.');
}

export function renderClaudeMarkdown(projectName: string): string {
  return renderSharedGuide(
    projectName,
    'Claude-specific note: treat this as required workflow, not advisory context.'
  );
}
