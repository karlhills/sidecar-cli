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

Install beta:

```bash
npm install -g sidecar-cli@beta
```

Install rc:

```bash
npm install -g sidecar-cli@rc
```

Or run without install:

```bash
npx sidecar-cli --help
npx sidecar-cli@beta --help
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

Initialize in a project directory:

```bash
sidecar init
```

This creates:

- `.sidecar/sidecar.db`
- `.sidecar/config.json`
- `.sidecar/preferences.json`
- `.sidecar/AGENTS.md`
- `.sidecar/summary.md`
- `AGENTS.md` (repo root)
- `CLAUDE.md` (repo root)

Use `--force` to overwrite Sidecar-managed files.

## Core commands

Global:

- `sidecar init [--force] [--name <project-name>] [--json]`
- `sidecar status [--json]`
- `sidecar capabilities --json`
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

This installs a non-blocking pre-commit reminder that runs `npm run sidecar:reminder`.
If a pre-commit hook already exists, Sidecar will not overwrite it unless you run:

```bash
npm run install:hooks -- --force
```

Agents can discover the CLI surface programmatically with:

```bash
sidecar capabilities --json
```

## Local storage details

All data is local in `.sidecar/sidecar.db` (SQLite).

Primary tables:

- `projects`
- `events`
- `tasks`
- `sessions`
- `artifacts`

No network dependency is required for normal operation.

## JSON output

Most commands support `--json` and return structured output:

- `ok`
- `command`
- `data`
- `errors`

This makes Sidecar easy to automate from scripts and AI agents.

## Release and distribution

See [RELEASE.md](./RELEASE.md) for publishing/release details.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for code structure and contribution guidelines.
