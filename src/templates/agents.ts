export function renderAgentsMarkdown(projectName: string): string {
  return `# Sidecar Agent Guide

Sidecar is the local project memory tool for this repository.

## Required workflow

1. Run \`sidecar context --format markdown\`.
2. Do the work.
3. Record updates:
   - decision: \`sidecar decision record ...\`
   - worklog: \`sidecar worklog record ...\`
   - follow-up task: \`sidecar task add ...\`
4. Run \`sidecar summary refresh\`.

## Commands to use

- Context: \`sidecar context --format markdown\`
- Decision: \`sidecar decision record --title "<title>" --summary "<summary>" --by agent\`
- Worklog: \`sidecar worklog record --done "<what changed>" --files src/a.ts,src/b.ts --by agent\`
- Task: \`sidecar task add "<follow-up>" --priority medium --by agent\`
- Summary: \`sidecar summary refresh\`

## Example workflow

\`\`\`bash
sidecar context --format markdown
sidecar session start --actor agent --name codex
sidecar decision record --title "Choose SQLite" --summary "Local, deterministic storage" --by agent
sidecar worklog record --goal "Refactor context output" --done "Improved markdown and json context payload" --files src/cli.ts,src/services/context-service.ts --by agent
sidecar task add "Add integration test for context output" --priority medium --by agent
sidecar summary refresh
sidecar session end --summary "Context and summary updates complete"
\`\`\`

Project: ${projectName}.
`;
}
