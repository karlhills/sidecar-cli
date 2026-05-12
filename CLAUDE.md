# Sidecar

Claude-specific note: treat this as required workflow, not advisory context.

Sidecar is this repo's decision log and worklog. Git already records
what changed; Sidecar exists to record why — and only when "why" is
non-obvious from the code or the diff.

If invoked without a specific instruction ("do the next thing", loop mode,
or autonomous mode), go straight to **Picking up the next task** below and
follow those rules exactly.

## Read before you write

Before any non-trivial change — infra, schema, moderation rules, queue
config, routing, anything that touches a past architectural choice —
check the decisions log:

`sidecar context --format markdown`

If a recent decision constrains your change, follow it or surface it to
the user before overriding it. Do not silently re-litigate prior choices.

If your change reverses a prior decision, record a new decision that
references the old one. Do not edit history.

## Record a decision when…

A decision is worth recording when a future agent reading the same code
would plausibly make a different call without this context. The bar is:
non-obvious, load-bearing, and unlikely to be re-derived from the code.

Good decisions name the alternative that was rejected and why.

Record:
- Trade-offs with a clear loser ("X over Y because Z")
- Deliberate non-actions ("did NOT add apex→www at the LB because…")
- Choices that look wrong at first glance
- Constraints imposed by external systems (cert SANs, RDS VPC, etc.)

Don't record:
- Style or naming
- Anything obvious from reading the touched file
- Restatement of the diff
- "Added X" — that's a worklog, not a decision

## Record a worklog when…

A worklog is worth recording for multi-step or cross-cutting work where
the shape of the change isn't obvious from any single commit.

One-line fixes, typo corrections, and dependency bumps usually don't need
a worklog in general. But for this repo policy: if files changed, record
a worklog.

## Tasks

Create a task only when all of these are explicit:
- Trigger
- Entry points (1-3 files)
- Done condition
- Validation command

Otherwise: surface the follow-up inline and let it die, or record it as a
decision if the call is "we're not doing this."

On task completion: write the worklog and decision entries the task
produced, then move the file to `tasks/done/`. No manual archival step.

## Picking up the next task

When an agent is invoked without a specific instruction ("do the next
thing", "/loop", autonomous mode), follow this precedence exactly:

1. List `tasks/active/`.
2. For each task, verify the trigger is satisfied against current
   state (run the query, check the dependency, read the threshold). Do
   not assume — a trigger written months ago may have already fired or
   may have been invalidated.
3. Filter to tasks whose trigger is satisfied right now.
4. From that filtered set, pick the highest `priority`. Ties broken by
   oldest `created_at` (FIFO — prevents agents from re-prioritizing the
   queue each run).
5. Execute that one task. Do not batch multiple tasks per invocation
   unless explicitly told to.

## When nothing is ready, ask — do not invent work

If step 3 above returns an empty set:

- Ask the user. Surface the active task list with each task's
  trigger and why it's not satisfied. Let the user pick, override a
  trigger, or send you elsewhere.
- Do not pick the "closest" task and start anyway.
- Do not pick a task whose trigger is almost satisfied and satisfy it
  yourself as a side quest.
- Do not create a new task on the spot to give yourself something to
  do. Task creation requires the same trigger + entry points + done
  condition + validation command bar as everything else; you cannot
  bypass it by self-assigning.
- Do not start unsolicited refactoring, "cleanup", doc edits, or
  speculative work to fill the gap.

If the user is unreachable (true autonomous mode, no human in loop):
exit cleanly with a status message naming the empty queue. Idle is a
valid outcome. Inventing work is not.

If a trigger requires information you can verify cheaply (a SQL count,
a `git log` check, a file existence test), verify it yourself. If it
requires information only the user has (a stakeholder commitment, a
business threshold), ask — don't guess.

## Repo-required sequence for code changes

If you changed code, run:
1. `sidecar context --format markdown`
2. `sidecar worklog record --done "<what changed>" --files <paths> --by agent`
3. if behavior/design/architecture changed:
   `sidecar decision record --title "<decision>" --summary "<why + rejected alternative>" --by agent`
4. if follow-up exists and it meets task criteria:
   `sidecar task create --title "<follow-up>" --summary "<summary>" --trigger "<trigger>" --entry-points <path1,path2> --done-condition "<done>" --validate-cmd "<cmd>" --priority medium`
5. `sidecar summary refresh`

Run `sidecar summary refresh` only after you actually recorded something.

## Command reference

`sidecar context --format markdown`
`sidecar worklog record --done "<what changed>" --files <paths> --by agent`
`sidecar decision record --title "<title>" --summary "<why + rejected alternative>" --by agent`
`sidecar task create --title "<follow-up>" --summary "<summary>" --trigger "<trigger>" --entry-points <paths> --done-condition "<done>" --validate-cmd "<cmd>" --priority medium`
`sidecar task set-status <task-id> --to active|blocked|done --reason "<why>" --by agent`
`sidecar summary refresh`

## Optional hygiene reminder

Run this before final response to catch missed Sidecar logging:

- `npm run sidecar:reminder`

Project: sidecar-cli.
