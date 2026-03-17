import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { openDb, migrate, ensureSidecarDir } from '../lib/db.js';
import { getPaths } from '../lib/paths.js';
import { nowIso } from '../lib/format.js';
import type { SidecarConfig } from '../types.js';

function renderAgentFile(projectName: string): string {
  return `# Sidecar Agent Guide

This project uses Sidecar for local project memory.

## Always available CLI commands

- \`sidecar record --type <type> --title <title> --body <body> [--tags a,b]\`
- \`sidecar task add --title <title> [--priority low|medium|high]\`
- \`sidecar task done --id <id>\`
- \`sidecar task list\`
- \`sidecar context [--format text|markdown|json]\`
- \`sidecar summary [--limit <n>] [--format text|markdown|json]\`

## Suggested usage for AI coding agents

1. At session start, run \`sidecar context --format markdown\`.
2. During work, add key notes and decisions with \`sidecar record\`.
3. Track tasks via \`sidecar task add|done\`.
4. End sessions by generating \`sidecar summary --format markdown\`.

## Event types

- \`note\`: small context note
- \`worklog\`: what changed during implementation
- \`decision\`: architectural/product decision
- \`task_update\`: task-level state or blocker
- \`summary\`: session recap entry
- \`context\`: imported/derived context event

Project: ${projectName}
Initialized: ${nowIso()}
`;
}

export function runInit(force = false): void {
  const paths = getPaths();
  ensureSidecarDir(paths.sidecarDir);

  if (!force && fs.existsSync(paths.dbPath)) {
    console.log(chalk.yellow('Sidecar is already initialized in this directory.'));
    return;
  }

  const db = openDb(paths.dbPath);
  migrate(db);
  db.close();

  const config: SidecarConfig = {
    version: 1,
    createdAt: nowIso(),
    projectName: path.basename(paths.cwd),
  };

  fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(paths.agentPath, renderAgentFile(config.projectName));

  console.log(chalk.green('Sidecar initialized.'));
  console.log(`- DB: ${paths.dbPath}`);
  console.log(`- Config: ${paths.configPath}`);
  console.log(`- Agent guide: ${paths.agentPath}`);
}
