#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hasGitChanges() {
  try {
    const out = sh('git status --porcelain');
    if (!out) return false;
    return out
      .split('\n')
      .filter(Boolean)
      .some((line) => !line.includes('.sidecar/'));
  } catch {
    return false;
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
  console.log('Sidecar reminder: no .sidecar directory found.');
  process.exit(0);
}

if (!hasGitChanges()) {
  console.log('Sidecar reminder: no pending code changes detected.');
  process.exit(0);
}

const dbPath = path.join(root, '.sidecar', 'sidecar.db');
if (!fs.existsSync(dbPath)) {
  console.log('Sidecar reminder: .sidecar exists but sidecar.db is missing.');
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
const row = db
  .prepare(`SELECT type, created_at FROM events ORDER BY created_at DESC LIMIT 1`)
  .get();
db.close();

if (!row) {
  console.log('Sidecar reminder: code changed but no events recorded yet. Suggested: sidecar worklog record --done "..." --files ...');
  process.exit(0);
}

const lastTs = new Date(row.created_at).getTime();
const ageMinutes = (Date.now() - lastTs) / 60000;
if (Number.isFinite(ageMinutes) && ageMinutes > 30) {
  console.log(`Sidecar reminder: code changed and last Sidecar event is ${Math.round(ageMinutes)}m old (${row.type}). Suggested: record worklog + summary refresh.`);
} else {
  console.log(`Sidecar reminder: recent Sidecar event found (${row.type} at ${row.created_at}).`);
}
