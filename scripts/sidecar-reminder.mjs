#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const enforce = args.includes('--enforce');
const stagedOnly = args.includes('--staged');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function isDocPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('.sidecar/')) return true;
  if (normalized.startsWith('docs/')) return true;
  if (normalized.startsWith('.github/')) return true;
  if (normalized === 'LICENSE' || normalized === 'LICENSE.md') return true;
  return /\.(md|mdx|txt|rst|adoc)$/i.test(normalized);
}

function getChangedFiles() {
  try {
    const cmd = stagedOnly
      ? 'git diff --cached --name-only --diff-filter=ACMR'
      : 'git status --porcelain';
    const out = sh(cmd);
    if (!out) return [];

    if (stagedOnly) {
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    }

    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findSidecarRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    const sidecar = path.join(current, '.sidecar');
    if (fs.existsSync(sidecar) && fs.statSync(sidecar).isDirectory()) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const root = findSidecarRoot();
if (!root) {
  const message = 'Sidecar reminder: no .sidecar directory found.';
  if (enforce) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const changedFiles = getChangedFiles().filter((filePath) => !isDocPath(filePath));
if (changedFiles.length === 0) {
  console.log('Sidecar reminder: no non-doc code changes detected.');
  process.exit(0);
}

const dbPath = path.join(root, '.sidecar', 'sidecar.db');
if (!fs.existsSync(dbPath)) {
  const message = 'Sidecar reminder: .sidecar exists but sidecar.db is missing.';
  if (enforce) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
const lastCommitAt = (() => {
  try {
    const ts = sh('git log -1 --format=%cI');
    return ts || '1970-01-01T00:00:00.000Z';
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
})();

const worklogSinceCommit = db
  .prepare(`SELECT id, created_at FROM events WHERE type = 'worklog' AND created_at >= ? ORDER BY created_at DESC LIMIT 1`)
  .get(lastCommitAt);
const summarySinceCommit = db
  .prepare(`SELECT id, created_at FROM events WHERE type = 'summary_generated' AND created_at >= ? ORDER BY created_at DESC LIMIT 1`)
  .get(lastCommitAt);
const lastEvent = db
  .prepare(`SELECT type, created_at FROM events ORDER BY created_at DESC LIMIT 1`)
  .get();

db.close();

const missingWorklog = !worklogSinceCommit;
const missingSummary = !summarySinceCommit;

if (enforce && (missingWorklog || missingSummary)) {
  console.error('Sidecar guard: non-doc staged code changes detected without required Sidecar updates.');
  if (missingWorklog) {
    console.error('- Missing worklog since last commit.');
    console.error('  Run: sidecar worklog record --done "<what changed>" --files <paths> --by human');
  }
  if (missingSummary) {
    console.error('- Missing summary refresh since last commit.');
    console.error('  Run: sidecar summary refresh');
  }
  console.error('Then retry commit.');
  process.exit(1);
}

if (!lastEvent) {
  console.log('Sidecar reminder: code changed but no events recorded yet. Suggested: sidecar worklog record --done "..." --files ...');
  process.exit(0);
}

const lastTs = new Date(lastEvent.created_at).getTime();
const ageMinutes = (Date.now() - lastTs) / 60000;
if (Number.isFinite(ageMinutes) && ageMinutes > 30) {
  console.log(
    `Sidecar reminder: code changed and last Sidecar event is ${Math.round(ageMinutes)}m old (${lastEvent.type}). Suggested: record worklog + summary refresh.`
  );
} else {
  console.log(`Sidecar reminder: recent Sidecar event found (${lastEvent.type} at ${lastEvent.created_at}).`);
}
