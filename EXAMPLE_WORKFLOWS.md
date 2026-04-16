# Sidecar CLI: Simple Workflow Examples

This guide shows a normal, practical flow for using Sidecar with an AI coding agent.
It is intentionally minimal and focuses on the core commands.

## 1) Start a task with your agent

Example prompt to your agent:

```text
We need to add a new feature. Before coding, run `sidecar context --format markdown`, then implement changes, record worklog, record a decision if behavior changed, add a follow-up task if needed, and refresh summary.
```

Why this helps:
- Agent gets project context first.
- Agent leaves a clear memory trail when work is done.

## 2) Check project context

```bash
sidecar context --format markdown
```

Use this at the start of work to see:
- Recent decisions
- Recent worklogs
- Open tasks
- Recent notes/artifacts

## 3) Track tasks while working

Add a task:

```bash
sidecar task add "Add user profile settings page" --priority medium --by human
```

List open tasks:

```bash
sidecar task list --status open
```

Mark a task done:

```bash
sidecar task done <task-id> --by human
```

## 4) Capture quick notes during implementation

```bash
sidecar note "Need to revisit validation edge case for empty display name" --title "Profile settings follow-up" --by human
```

Use notes for quick findings, reminders, and debugging context.

## 5) Record what changed after coding

Record work completed:

```bash
sidecar worklog record --done "Added profile settings UI and save flow" --files src/profile.ts,src/ui/settings.ts --by agent
```

If behavior/design changed, record a decision:

```bash
sidecar decision record --title "Use optimistic save for settings" --summary "Improves perceived speed and keeps rollback simple" --by agent
```

If follow-up work remains, add a task:

```bash
sidecar task add "Add integration test for failed settings save" --priority medium --by agent
```

Refresh project summary:

```bash
sidecar summary refresh
```

## 6) Copy/paste "standard flow" for agent-driven coding

```bash
sidecar context --format markdown
# agent implements changes
sidecar worklog record --done "<what changed>" --files <paths> --by agent
# if behavior/design changed:
sidecar decision record --title "<decision>" --summary "<why>" --by agent
# if follow-up exists:
sidecar task add "<follow-up>" --priority medium --by agent
sidecar summary refresh
```

That is the default workflow most teams need day to day.
