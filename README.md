[■]─[▪]  sidecar

project memory for your work

# Sidecar CLI

Sidecar is a local-first, CLI-first project memory and recording tool for human developers and AI coding agents.

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

Note on npm deprecation warnings:

- You may see a transitive warning for `prebuild-install@7.1.3` during install.
- This currently comes from `better-sqlite3` (Sidecar's SQLite dependency), not from Sidecar code directly.
- Sidecar still installs/works normally; we will update when upstream dependency chain moves off it.

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

- Node.js 20+
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

## Core commands

Global:

- `sidecar init [--force] [--name <project-name>] [--instructions-template <name>] [--instructions-file <path>] [--json]`
- `sidecar status [--json]`
- `sidecar preferences show [--json]`
- `sidecar ui [--no-open] [--port <port>] [--install-only] [--project <path>] [--reinstall]`
- `sidecar capabilities --json`
- `sidecar event add ... [--json]`
- `sidecar export [--format json|jsonl] [--output <path>]`
- `sidecar help`

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

Initial UI screens:

- Overview: project info, active session, recent decisions/worklogs, open tasks, recent notes
- Timeline: recent events in chronological order
- Tasks: open and completed tasks
- Decisions: decision records with summary and timestamps
- Preferences: `.sidecar/preferences.json` and `.sidecar/summary.md`

UI write support (v1):

- Add notes from Overview
- Add open tasks from Overview
- Edit `.sidecar/preferences.json` from Preferences
  - `output.humanTime` controls timestamp style in human-readable CLI output:
    - `true`: friendly local times (for example `3/18/2026, 11:51 AM`)
    - `false`: raw ISO-style timestamps

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
