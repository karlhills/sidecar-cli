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
sidecar task create \
  --title "Add user profile settings page" \
  --summary "Create settings UI and persistence wiring" \
  --trigger "After profile API contract is approved" \
  --entry-points src/profile/routes.ts,src/profile/controller.ts \
  --done-condition "Settings save and reload work end-to-end" \
  --validate-cmd "npm test -- profile-settings" \
  --priority medium
```

List active tasks:

```bash
sidecar task list --status active
```

Mark a task done:

```bash
sidecar task set-status <task-id> --to done --reason "Completed and verified" --by human
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
sidecar task create \
  --title "Add integration test for failed settings save" \
  --summary "Cover failed-save UI path and retry" \
  --trigger "After settings retry UX ships" \
  --entry-points tests/integration/profile-settings.test.ts \
  --done-condition "Failed-save path has integration coverage" \
  --validate-cmd "npm test -- profile-settings" \
  --priority medium
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
sidecar task create --title "<follow-up>" --summary "<short summary>" --trigger "<trigger>" --entry-points <path1,path2> --done-condition "<specific outcome>" --validate-cmd "<cmd>" --priority medium
sidecar summary refresh
```

That is the default workflow most teams need day to day.
