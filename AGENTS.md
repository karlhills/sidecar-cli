# Agent Rules (Repository Level)

This repository uses Sidecar as required project memory for code changes.

## MUST for any code change

Before your final response, run in this exact order:

1. `sidecar context --format markdown`
2. `sidecar worklog record --done "<what changed>" --files <paths> --by agent`
3. If behavior/design/architecture changed: `sidecar decision record --title "<decision>" --summary "<why>" --by agent`
4. If follow-up exists: `sidecar task add "<follow-up>" --priority medium --by agent`
5. `sidecar summary refresh`

## Minimum checklist

- [ ] Context captured
- [ ] Worklog recorded
- [ ] Decision recorded (if needed)
- [ ] Follow-up task recorded (if needed)
- [ ] Summary refreshed

## Enforcement reminder

Run `npm run sidecar:reminder` before final response.

Optional local guard:

```bash
npm run install:hooks
```

This installs a git pre-commit hook that runs the Sidecar reminder.
