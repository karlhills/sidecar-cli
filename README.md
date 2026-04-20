[■]─[▪]  sidecar

project memory for your work

# Sidecar CLI

Sidecar is a local-first, CLI-first project memory and recording tool for human developers and AI coding agents.

Documentation website: [usesidecar.dev](https://usesidecar.dev/)

## Why Sidecar exists

- Keep project memory structured and local.
- Make session handoffs easier for humans and agents.
- Record decisions, work logs, tasks, notes, sessions, and artifacts in one stable CLI.
- Generate deterministic context and summary outputs from local project data.

## Install

Install globally (stable):

```bash
npm install -g sidecar-cli
```

Install beta:

```bash
npm install -g sidecar-cli@beta
```

Install rc:

```bash
npm install -g sidecar-cli@rc
```

Install with Homebrew (stable):

```bash
brew tap karlhills/sidecar
brew install sidecar
```

Or run without install:

```bash
npx sidecar-cli --help
npx sidecar-cli@beta --help
```

Update Homebrew install:

```bash
brew update
brew upgrade sidecar
```

Requirements:

- Node.js 22+ (Sidecar uses the built-in `node:sqlite` module)
- npm

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run locally in dev mode:

```bash
npm run dev -- --help
```

## Quick start

1. Initialize in a project directory:

```bash
sidecar init
```

2. (Optional) Define shared instruction templates once:

```bash
mkdir -p ~/.sidecar-cli/instructions
```

Create template files such as:

- `~/.sidecar-cli/instructions/web-app.md`
- `~/.sidecar-cli/instructions/desktop-app.md`

3. Initialize with a shared template (writes project `instructions.md`):

```bash
sidecar init --instructions-template web-app
```

Or load directly from a specific file:

```bash
sidecar init --instructions-file /absolute/path/to/instructions.md
```

Notes:

- `--instructions-template <name>` resolves to `~/.sidecar-cli/instructions/<name>.md`.
- Use either `--instructions-template` or `--instructions-file` (not both).
- If `instructions.md` already exists, Sidecar will not overwrite it unless `--force` is used.

This creates:

- `.sidecar/sidecar.db`
- `.sidecar/config.json`
- `.sidecar/preferences.json`
- `.sidecar/AGENTS.md`
- `.sidecar/summary.md`
- `AGENTS.md` (repo root)
- `CLAUDE.md` (repo root)
- `instructions.md` (repo root, only when `--instructions-template` or `--instructions-file` is provided)

Use `--force` to overwrite Sidecar-managed files.

## Two namespaces: `log` and `work`

Sidecar is one CLI that does two jobs: capture local project memory, and run AI coding agents against that memory. Each job has a namespace:

- **`sidecar log <cmd>`** — memory: `worklog`, `decision`, `note`, `recent`, `context`, `summary`, `session`, `event`, `artifact`
- **`sidecar work <cmd>`** — runner: `task`, `run`, `prompt`, `hooks`

The underlying verbs still work directly, so `sidecar worklog record ...` and `sidecar log worklog record ...` are equivalent. Pick the form that reads best in your workflow.

```bash
sidecar log worklog record --done "..." --files src/a.ts
sidecar log decision record --title "..." --summary "..."
sidecar log context --format markdown
sidecar log summary refresh

sidecar work task create --title "..."
sidecar work run T-001
sidecar work prompt compile ./prompt.yaml
```

Run `sidecar log --help` or `sidecar work --help` for the full listing.

## Core commands

Global:

- `sidecar init [--force] [--name <project-name>] [--instructions-template <name>] [--instructions-file <path>] [--json]`
- `sidecar demo [--cleanup] [--json]`
- `sidecar status [--json]`
- `sidecar preferences show [--json]`
- `sidecar ui [--no-open] [--port <port>] [--install-only] [--project <path>] [--reinstall]`
- `sidecar capabilities --json`
- `sidecar event add ... [--json]`
- `sidecar export [--format json|jsonl] [--output <path>]`
- `sidecar help`

Runner and prompts:

- `sidecar run <task-id> [--runner codex|claude|codex,claude] [--agent-role <role>] [--dry-run] [--json]`
- `sidecar run replay <run-id> [--runner <r>] [--agent-role <role>] [--reason <text>] [--edit-prompt] [--dry-run] [--json]`
- `sidecar run list [--task <task-id>] [--json]` · `sidecar run show <run-id> [--json]`
- `sidecar run queue [--json]` · `sidecar run start-ready [--dry-run] [--json]`
- `sidecar prompt compile <task-or-file> [--runner <r>] [--agent-role <role>] [--budget <n>] [--section-policy ...] [--explain] [--format json] [-o <path>]`
- `sidecar hooks print` · `sidecar hook <session-start|session-end|file-edit|user-prompt> [--actor-name <name>] [--json]`

Context and summary:

- `sidecar context [--limit <n>] [--format text|markdown|json] [--json]`
- `sidecar summary refresh [--limit <n>] [--json]`
- `sidecar recent [--type <event-type>] [--limit <n>] [--json]`

Notes, decisions, worklogs:

- `sidecar note "<text>" [--title <title>] [--by human|agent] [--session <id>] [--json]`
- `sidecar decision record --title <title> --summary <summary> [--details <details>] [--by human|agent] [--session <id>] [--json]`
- `sidecar worklog record --done <summary> [--goal <goal>] [--files a,b] [--risks <text>] [--next <text>] [--by human|agent] [--session <id>] [--json]`

Tasks:

- `sidecar task add "<title>" [--description <text>] [--priority low|medium|high] [--by human|agent] [--json]`
- `sidecar task done <task-id> [--by human|agent] [--json]`
- `sidecar task list [--status open|done|all] [--format table|json] [--json]`

Sessions:

- `sidecar session start [--actor human|agent] [--name <actor-name>] [--json]`
- `sidecar session end [--summary <text>] [--json]`
- `sidecar session current [--json]`
- `sidecar session verify [--json]`
- `sidecar doctor [--json]` (alias)

Artifacts:

- `sidecar artifact add <path> [--kind file|doc|screenshot|other] [--note <text>] [--json]`
- `sidecar artifact list [--json]`

## Validation kinds and auto-approve

Task packets describe post-run validation commands under `execution.commands.validation`. Each entry is tagged with a **kind** so Sidecar can route the result intelligently, apply a sensible default timeout, and surface the outcome in the UI and CLI.

### Kinds

| Kind | Default timeout | Intended for |
| --- | --- | --- |
| `typecheck` | 3 min | `tsc --noEmit`, `mypy`, `pyright` |
| `lint` | 3 min | `eslint`, `ruff`, `golangci-lint` |
| `test` | 10 min | unit/integration suites |
| `build` | 10 min | bundlers, compilers, image builds |
| `custom` | 5 min | anything else (the legacy default) |

### Authoring

On the CLI, prefix a command with `kind:`. Entries without a prefix default to `custom`.

```bash
sidecar task create \
  --title "Add import flow" \
  --summary "..." --goal "..." \
  --validate-cmds "typecheck:tsc --noEmit,lint:eslint .,test:npm test"
```

In a task packet JSON file, use the object form:

```json
"execution": {
  "commands": {
    "validation": [
      { "kind": "typecheck", "command": "tsc --noEmit" },
      { "kind": "test", "command": "npm test", "timeout_ms": 900000 },
      "bash scripts/smoke.sh"
    ]
  }
}
```

String entries are accepted for back-compat (promoted to `{ kind: "custom", command }` on load).

### Auto-approve on all-green

When every validation step passes for a run, Sidecar can auto-approve the run so you don't have to click through the review queue for a strictly-green outcome. It's opt-in:

```json
// .sidecar/preferences.json
{ "review": { "autoApproveOnAllGreen": true } }
```

Behavior when enabled:

- The run's `review_state` flips to `approved`, `reviewed_by` is set to `sidecar:auto`, and the review note records how many steps passed.
- Runs with zero configured validation steps are **not** auto-approved — a runner-only success still requires a human click.
- Any failing step blocks the run as today (task moves to `blocked`, blocker message includes the kind).

## Dual-runner pipelines

Pass a comma-separated list to `--runner` and Sidecar runs each runner sequentially on the same task, feeding the previous run's summary into the next runner's compiled prompt as linked context.

```bash
sidecar run T-001 --runner codex,claude
sidecar run T-001 --runner codex,claude --agent-role builder-app --dry-run
```

Each step produces its own run record linked back to the first run in the pipeline via `parent_run_id`. The CLI prints a one-line summary per step (runner, agent role, run id, status, duration, changed file count), and the full pipeline envelope is available with `--json`. Use this to pair a planner/builder runner with a reviewer runner, or to compare runners head-to-head on the same task.

## Replay a run

When a run finishes (whether ok, blocked, or failed) you can kick off a fresh run with the **same task** and a link back to the original via `sidecar run replay`. It's the fastest way to try a different runner, re-run after fixing a blocker, or fork a green run into an experiment without losing the audit trail.

```bash
sidecar run replay R-001 --reason "retry with claude after codex blocker"
sidecar run replay R-001 --runner claude --agent-role builder-app --edit-prompt
sidecar run replay R-001 --reason "dry-run with new validation" --dry-run
```

Flags:

- `--runner codex|claude` — override the parent's runner (defaults to parent's runner).
- `--agent-role <role>` — override the parent's agent role.
- `--reason "<text>"` — stored on the new run as `replay_reason`; surfaced in CLI and UI.
- `--edit-prompt` — opens the compiled prompt in `$VISUAL`/`$EDITOR` before the runner starts so you can tweak it.
- `--dry-run` — compile the prompt and create the run record without executing the runner.
- `--json` — machine-readable envelope output.

The new run record carries `parent_run_id: "R-001"` plus your `replay_reason`. `sidecar run show <id>` renders the lineage both ways:

- The parent shows **Replayed as:** with each child run id.
- Each child shows **Replay of:** with the parent id and reason.

The UI's Run Detail panel mirrors this: `Replay of:` links back to the parent; `Replays:` lists every child with its status. Both are clickable for one-hop navigation through a lineage.

## Ambient capture via Claude Code hooks

Sidecar can capture an ongoing Claude Code session into worklog/session records **without any explicit `sidecar worklog record` calls**. Once you wire Claude Code's hook system to `sidecar hook <event>`, every session start, file edit, and session end flows into your project memory automatically.

Print the ready-to-paste settings block:

```bash
sidecar hooks print
```

Paste the `hooks` object into `.claude/settings.json` (project) or `~/.claude/settings.json` (user). Claude Code merges hook arrays across scopes, so user-level and project-level hooks compose.

The template wires four events:

| Claude Code event  | Sidecar hook           | Effect                                                             |
| ------------------ | ---------------------- | ------------------------------------------------------------------ |
| `SessionStart`     | `sidecar hook session-start` | Opens a Sidecar session (`actor=agent`, name `claude-code:<sid>`). Idempotent. |
| `SessionEnd`       | `sidecar hook session-end`   | Closes the active session. Safe to call when none is open.          |
| `PostToolUse` (Edit\|Write\|MultiEdit\|NotebookEdit) | `sidecar hook file-edit`     | Records a worklog `"Edited <path> via <tool>"` and links the file as an artifact. Lazy-opens a session if none is active. |
| `UserPromptSubmit` | `sidecar hook user-prompt`   | Records the first 200 chars of the prompt as a note.                |

Each hook:

- Reads its payload JSON from stdin (Claude Code supplies it automatically).
- **Always exits 0** — hooks never block the caller, even on internal errors.
- Accepts `--actor-name <name>` to override the default actor name.
- Accepts `--json` to emit a structured envelope (useful when testing).

Quick manual smoke test:

```bash
echo '{"session_id":"abc"}' | sidecar hook session-start
echo '{"tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/README.md"}}' | sidecar hook file-edit
sidecar hook session-end
sidecar recent --type worklog --limit 3
```

Codex users can invoke the same CLI from any shell hook or wrapper script — the payload schema is permissive, so a minimal `{"tool_input":{"file_path":"..."}}` works.

## Automatic prompt token budgeting

When Sidecar compiles task prompts (`sidecar prompt compile` and run execution flows), it automatically applies a token budget to reduce context size without degrading execution quality.

Current behavior:

- Keeps required sections intact (task, objective, constraints, validation, definition of done).
- Deduplicates repeated list items.
- Trims only optional high-volume sections when needed (for example: in-scope lists, linked notes/decisions, long file lists).
- Adds compact overflow lines such as `+ N more ... (see task packet for full list)`.

Current defaults:

- Target budget: ~1200 estimated tokens
- Safety ceiling: ~1500 estimated tokens

Prompt optimization data is included in compile output and stored on run records:

- `prompt_tokens_estimated_before`
- `prompt_tokens_estimated_after`
- `prompt_budget_target`
- `prompt_trimmed_sections`

## Freestanding prompt specs

`sidecar prompt compile` also accepts a `.yaml`/`.yml`/`.json` spec file — no TaskPacket required. This lets you iterate on prompts directly, or compose them programmatically from another tool.

```bash
sidecar prompt compile ./my-prompt.yaml
sidecar prompt compile ./my-prompt.yaml --explain
sidecar prompt compile ./my-prompt.yaml --budget 1500 --budget-max 2000
sidecar prompt compile ./my-prompt.yaml --section-policy notes=drop,examples=trim-last
sidecar prompt compile ./my-prompt.yaml -o out.md
sidecar prompt compile ./my-prompt.yaml --format json
```

Spec schema:

```yaml
header:
  - "# My Prompt"
  - "Optional preamble rendered verbatim."

sections:
  - id: objective           # optional — auto-slugified from title if omitted
    title: Objective
    required: true          # forces policy=keep (never trimmed or dropped)
    content: |              # text section: string or string[]
      Describe the goal in one or two sentences.

  - title: Notes
    list:                   # list section
      - First note
      - Second note
      - Third note
    empty_placeholder: "- no notes yet"
    trim:
      policy: trim-last     # keep | trim-last | drop
      limit: 2              # target-pass cap
      limit_strict: 1       # safety-valve cap
      overflow_label: notes # renders "+ N more notes (see task packet for full list)"

budget:
  target: 1200              # soft target
  max: 1500                 # hard ceiling before strict pass

policy_overrides:
  notes: keep               # override per-section trim policies by id
```

Trim policies:

- `keep` — never trim or drop (default for text sections and `required: true`)
- `trim-last` — apply `limit` on the target pass, `limit_strict` on the strict pass (lists only)
- `drop` — remove the whole section on the strict pass when still over budget

`--explain` prints a per-section trace (policy applied, tokens, items kept/total) to stderr. `--format json` emits the standard envelope with `markdown` + full `metadata.sections` trace for programmatic use.

## Example workflow

```bash
sidecar context --format markdown
sidecar session start --actor agent --name codex
sidecar decision record --title "Use SQLite" --summary "Local-first persistence"
sidecar worklog record --goal "init flow" --done "Implemented schema and command surface" --files src/cli.ts,src/db/schema.ts
sidecar task add "Add integration tests" --priority medium --by agent
sidecar summary refresh
sidecar session end --summary "Initialization and recording flow implemented"
```

## AI agent usage

Sidecar generates `.sidecar/AGENTS.md` during `init`.
This repo also includes a root `AGENTS.md` so the policy is visible before any `.sidecar` lookup.

Required minimum for any code change:

1. `sidecar context --format markdown`
2. `sidecar worklog record --done "<what changed>" --files <paths> --by agent`
3. if behavior/design changed: `sidecar decision record ...`
4. if follow-up exists: `sidecar task add ...`
5. `sidecar summary refresh`

Optional local enforcement:

```bash
npm run install:hooks
```

This is optional and per-repository clone. `sidecar init` does not install git hooks automatically.

This installs a pre-commit guard that checks staged non-doc code changes.
If staged code changes are present, commit is blocked unless both are recorded since the last commit:

- a `worklog` event
- a `summary refresh` event

The guard command is:

- `npm run sidecar:reminder -- --staged --enforce`

If a pre-commit hook already exists, Sidecar will not overwrite it unless you run:

```bash
npm run install:hooks -- --force
```

Agents can discover the CLI surface programmatically with:

```bash
sidecar capabilities --json
```

## Repo policy

When changes are made in this repo, document them in Sidecar:

1. `sidecar context --format markdown`
2. `sidecar worklog record --done "<what changed>" --files <paths> --by human|agent`
3. `sidecar decision record ...` when behavior/design changes
4. `sidecar task add ...` for follow-up work
5. `sidecar summary refresh`

## Local storage details

All data is local in `.sidecar/sidecar.db` (SQLite).

Primary tables:

- `projects`
- `events`
- `tasks`
- `sessions`
- `artifacts`

No network dependency is required for normal operation.

## Optional local UI

`sidecar ui` launches a local browser UI for the selected Sidecar project.

Lazy-install behavior:

1. `sidecar ui` resolves the nearest `.sidecar` project root (or uses `--project`).
2. Sidecar checks for `@sidecar/ui` in `~/.sidecar/ui`.
3. If missing/incompatible, Sidecar installs or updates it automatically.
4. Sidecar starts a local UI server and opens the browser (unless `--no-open`).

UI runtime location:

- `~/.sidecar/ui`
- the CLI installs `@sidecar/ui` here (not in your project repo)

Version compatibility rule:

- CLI and UI must share the same major version.
- If majors differ, `sidecar ui` auto-reinstalls/updates UI.

Common examples:

```bash
sidecar ui
sidecar ui --no-open --port 4311
sidecar ui --install-only
sidecar ui --project ../other-repo
sidecar ui --reinstall
```

UI screens:

- **Mission Control**: open tasks, ready queue, runs in flight, pipelines, and run review queue — the main operational surface.
- **Run Detail**: compiled prompt and runner log viewers, typed validation results (kind badges, exit code, duration, snippet), replay lineage (`Replay of:` / `Replays:`), and auto-approval markers.
- **Overview**: project info, active session, recent decisions/worklogs, open tasks, recent notes, and counts.
- **Timeline**: paginated event stream (load-more).
- **Tasks** and **Decisions**: list views with summary and timestamps.
- **Preferences**: edit `.sidecar/preferences.json` and view `.sidecar/summary.md`.

UI write support:

- Add notes and open tasks from Overview.
- Trigger `run replay` with optional reason, runner override, and agent-role override from Run Detail.
- Edit `.sidecar/preferences.json` from Preferences.
  - `output.humanTime` controls timestamp style in human-readable CLI output:
    - `true`: friendly local times (for example `3/18/2026, 11:51 AM`)
    - `false`: raw ISO-style timestamps
  - `review.autoApproveOnAllGreen` — auto-approve runs when every validation step passes (see "Validation kinds and auto-approve").

See [packages/ui/UI.md](packages/ui/UI.md) for the full UI reference (state model, views, modals, HTTP API, accessibility).

## JSON output

Most commands support `--json` and return structured output:

- `ok`
- `command`
- `data`
- `errors`

This makes Sidecar easy to automate from scripts and AI agents.

## Integration API

Sidecar CLI is the first integration API for scripts, agents, and local tooling.

Standard JSON envelope:

```json
{
  "ok": true,
  "version": "1.0",
  "command": "task add",
  "data": {},
  "errors": []
}
```

Failure envelope:

```json
{
  "ok": false,
  "version": "1.0",
  "command": "task add",
  "data": null,
  "errors": ["..."]
}
```

Generic event ingest:

```bash
sidecar event add --type decision --title "Use SQLite" --summary "Simple local storage for v1" --created-by agent --source cli --json
sidecar event add --json-input '{"type":"note","summary":"Captured context","created_by":"agent"}' --json
cat event.json | sidecar event add --stdin --json
```

Capabilities metadata:

```bash
sidecar capabilities --json
```

Includes:

- `cli_version`
- `json_contract_version`
- `features`
- command and option metadata

Export project memory:

```bash
sidecar export --format json
sidecar export --format json --output ./exports/sidecar.json
sidecar export --format jsonl > sidecar-events.jsonl
```

JSONL note:

- JSONL export currently emits events only, one JSON object per line.
- each JSONL line includes `"version": "1.0"` and `"record_type": "event"`.

## Release and distribution

See [RELEASE.md](./RELEASE.md) for publishing/release details.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for code structure and contribution guidelines.
