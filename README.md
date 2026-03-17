[■]─[▪]  sidecar

project memory for your work

# Sidecar CLI

Sidecar is a local-first, CLI-first project memory and recording tool for human developers and AI coding agents.

## Why Sidecar exists

- Keep project memory structured and local.
- Make session handoffs easier for humans and agents.
- Record decisions, work logs, tasks, notes, sessions, and artifacts in one stable CLI.
- Generate deterministic context and summary outputs without any cloud or LLM dependency.

## v1 scope

- No cloud sync
- No remote server
- No GUI
- No MCP server
- No passive prompt capture

## Install

Install globally:

```bash
npm install -g sidecar-cli
```

Or run without install:

```bash
npx sidecar-cli --help
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
npm run dev -- init
```

This creates:

- `.sidecar/sidecar.db`
- `.sidecar/config.json`
- `.sidecar/AGENTS.md`
- `.sidecar/summary.md`

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

That file explains:

- this repo uses Sidecar
- required workflow for agents
- when to record notes, decisions, worklogs, and tasks
- recommended commands
- a practical session checklist and example

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

Sidecar uses tag-based GitHub Actions releases.

Tag formats:

- stable: `v1.2.3`
- beta: `v1.2.3-beta.1`
- rc: `v1.2.3-rc.1`

Behavior:

- stable tags publish npm `latest`
- beta tags publish npm `beta`
- rc tags publish npm `rc`
- all release tags create GitHub Releases and upload tarball assets
- Homebrew tap updates are stable-only (beta/rc intentionally skipped)

Workflows:

- CI: `.github/workflows/ci.yml`
- Release: `.github/workflows/release.yml`

Required configuration:

- `NPM_TOKEN` (secret)
- `HOMEBREW_TAP_REPO` (variable, optional)
- `HOMEBREW_TAP_GITHUB_TOKEN` (secret, optional)

See [RELEASE.md](./RELEASE.md) for full release steps and examples.

Quick preflight:

```bash
npm run release_check -- --tag v1.2.3
```

One-command release:

```bash
npm run release:stable -- --version 1.2.3
npm run release:beta -- --version 1.2.3 --pre 1
npm run release:rc -- --version 1.2.3 --pre 1

# preview only (no commit/tag/push)
npm run release:beta -- --version 1.2.3 --pre 1 --dry-run
```
