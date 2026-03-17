#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { runInit } from './commands/init.js';
import { runRecord } from './commands/record.js';
import { parseTags } from './lib/validation.js';
import { runTaskAdd, runTaskDone, runTaskList } from './commands/task.js';
import { runContext } from './commands/context.js';
import { runSummary } from './commands/summary.js';
import type { EventType, OutputFormat } from './types.js';

const program = new Command();

program
  .name('sidecar')
  .description('Local-first project memory and recording CLI for humans and AI agents')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Sidecar in the current project')
  .option('-f, --force', 'Recreate or overwrite initial Sidecar files', false)
  .action((opts) => {
    runInit(Boolean(opts.force));
  });

program
  .command('record')
  .description('Record a structured project event')
  .requiredOption('--type <type>', 'Event type (note|worklog|decision|task_update|summary|context)')
  .requiredOption('--title <title>', 'Short event title')
  .requiredOption('--body <body>', 'Detailed event body')
  .option('--tags <tags>', 'Comma-separated tags', '')
  .action((opts) => {
    runRecord({
      type: opts.type as EventType,
      title: opts.title,
      body: opts.body,
      tags: parseTags(opts.tags),
    });
  });

const task = program.command('task').description('Manage project tasks');

task
  .command('add')
  .description('Add a task')
  .requiredOption('--title <title>', 'Task title')
  .option('--priority <priority>', 'Priority: low|medium|high', 'medium')
  .action((opts) => {
    runTaskAdd({ title: opts.title, priority: opts.priority });
  });

task
  .command('done')
  .description('Mark task as done')
  .requiredOption('--id <id>', 'Task id', (value) => Number.parseInt(value, 10))
  .action((opts) => {
    runTaskDone(opts.id);
  });

task
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'open|done|all', 'open')
  .action((opts) => {
    runTaskList(opts.status);
  });

program
  .command('context')
  .description('Generate current project context for a new session')
  .option('--format <format>', 'text|markdown|json', 'text')
  .action((opts) => {
    runContext(opts.format as OutputFormat);
  });

program
  .command('summary')
  .description('Generate work summary from recorded data')
  .option('--limit <limit>', 'How many recent events to include', (v) => Number.parseInt(v, 10), 25)
  .option('--format <format>', 'text|markdown|json', 'text')
  .action((opts) => {
    runSummary(opts.limit, opts.format as OutputFormat);
  });

program.configureOutput({
  outputError: (str, write) => write(chalk.red(str)),
});

try {
  program.parse(process.argv);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}
