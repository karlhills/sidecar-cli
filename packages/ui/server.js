#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

function getArg(name) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const projectPath = path.resolve(getArg('--project') || process.cwd());
const port = Number.parseInt(getArg('--port') || '4310', 10);
const sidecarDir = path.join(projectPath, '.sidecar');
const dbPath = path.join(sidecarDir, 'sidecar.db');
const prefsPath = path.join(sidecarDir, 'preferences.json');
const summaryPath = path.join(sidecarDir, 'summary.md');
const taskPacketsPath = path.join(sidecarDir, 'tasks');
const runsPath = path.join(sidecarDir, 'runs');

if (!fs.existsSync(sidecarDir) || !fs.existsSync(dbPath)) {
  console.error('Sidecar UI error: selected project is not initialized (.sidecar/sidecar.db missing).');
  process.exit(1);
}

const db = new Database(dbPath);

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function nowIso() {
  return new Date().toISOString();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readPreferences() {
  if (!fs.existsSync(prefsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch {
    return null;
  }
}

function writePreferences(preferences) {
  const safe = preferences && typeof preferences === 'object' ? preferences : {};
  fs.writeFileSync(prefsPath, JSON.stringify(safe, null, 2) + '\n');
}

function readSummary() {
  if (!fs.existsSync(summaryPath)) return '';
  try {
    return fs.readFileSync(summaryPath, 'utf8');
  } catch {
    return '';
  }
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listJsonRecords(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();

  const rows = [];
  for (const filePath of files) {
    const parsed = readJsonFileSafe(filePath);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function loadTaskPackets() {
  return listJsonRecords(taskPacketsPath).map((task) => {
    if (task.status === 'open') task.status = 'draft';
    if (task.status === 'in_progress') task.status = 'running';
    return task;
  });
}

function loadRuns() {
  return listJsonRecords(runsPath).sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
}

function loadMission(statusFilter) {
  const tasks = loadTaskPackets();
  const runs = loadRuns();
  const latestRunByTask = new Map();
  for (const run of runs) {
    if (!latestRunByTask.has(run.task_id)) latestRunByTask.set(run.task_id, run);
  }

  const rows = tasks.map((task) => {
    const latestRun = latestRunByTask.get(task.task_id) ?? null;
    const lastUpdated =
      latestRun?.completed_at ||
      latestRun?.started_at ||
      task.tracking?.assigned_at ||
      task.result?.updated_at ||
      null;
    return {
      task_id: task.task_id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assigned_agent_role: task.tracking?.assigned_agent_role ?? null,
      assigned_runner: task.tracking?.assigned_runner ?? null,
      latest_run_id: latestRun?.run_id ?? null,
      latest_run_status: latestRun?.status ?? null,
      updated_at: lastUpdated,
    };
  });

  const filtered = statusFilter && statusFilter !== 'all' ? rows.filter((row) => row.status === statusFilter) : rows;
  return {
    statuses: ['ready', 'running', 'review', 'blocked', 'done'],
    tasks: filtered,
    counts: {
      total: rows.length,
      ready: rows.filter((row) => row.status === 'ready').length,
      running: rows.filter((row) => row.status === 'running').length,
      review: rows.filter((row) => row.status === 'review').length,
      blocked: rows.filter((row) => row.status === 'blocked').length,
      done: rows.filter((row) => row.status === 'done').length,
    },
  };
}

function loadTaskDetail(taskId) {
  const task = loadTaskPackets().find((row) => row.task_id === taskId);
  if (!task) return null;
  const runs = loadRuns().filter((run) => run.task_id === taskId);
  return {
    task,
    latest_run: runs[0] ?? null,
    runs,
  };
}

function loadRunDetail(runId) {
  const run = loadRuns().find((row) => row.run_id === runId);
  return run ?? null;
}

function resolveSidecarInvocation() {
  const cliJs = process.env.SIDECAR_CLI_JS;
  if (cliJs && fs.existsSync(cliJs)) {
    return { command: process.execPath, baseArgs: [cliJs] };
  }
  return { command: 'sidecar', baseArgs: [] };
}

function runSidecar(args) {
  const { command, baseArgs } = resolveSidecarInvocation();
  const fullArgs = [...baseArgs, ...args];
  const output = execFileSync(command, fullArgs, {
    cwd: projectPath,
    encoding: 'utf8',
    env: { ...process.env, SIDECAR_NO_BANNER: '1' },
  });
  return output.trim();
}

function runSidecarJson(args) {
  const output = runSidecar([...args, '--json']);
  if (!output) return null;
  return JSON.parse(output);
}

function parseEnvelope(payload) {
  if (payload && payload.ok === true) return payload.data;
  return payload;
}

function loadOverview() {
  const project = db.prepare('SELECT id, name, root_path, created_at, updated_at FROM projects ORDER BY id LIMIT 1').get();
  const projectId = project?.id;
  if (!projectId) return { project: null };

  const activeSession = db
    .prepare(`SELECT id, started_at, actor_type, actor_name FROM sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`)
    .get(projectId);

  const decisions = db
    .prepare(`SELECT id, title, summary, created_at FROM events WHERE project_id = ? AND type = 'decision' ORDER BY created_at DESC LIMIT 8`)
    .all(projectId);

  const worklogs = db
    .prepare(`SELECT id, title, summary, created_at FROM events WHERE project_id = ? AND type = 'worklog' ORDER BY created_at DESC LIMIT 8`)
    .all(projectId);

  const openTasks = db
    .prepare(`SELECT id, title, priority, status, updated_at FROM tasks WHERE project_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 12`)
    .all(projectId);

  const notes = db
    .prepare(`SELECT id, title, summary, created_at FROM events WHERE project_id = ? AND type = 'note' ORDER BY created_at DESC LIMIT 8`)
    .all(projectId);

  return {
    project,
    activeSession,
    recentDecisions: decisions,
    recentWorklogs: worklogs,
    openTasks,
    recentNotes: notes,
  };
}

function loadTimeline() {
  const project = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
  if (!project?.id) return [];
  return db
    .prepare(`SELECT id, type, title, summary, created_by, source, created_at FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(project.id);
}

function loadTasks() {
  const project = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
  if (!project?.id) return [];
  return db
    .prepare(`SELECT id, title, description, status, priority, created_at, updated_at, closed_at FROM tasks WHERE project_id = ? ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC`)
    .all(project.id);
}

function loadDecisions() {
  const project = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
  if (!project?.id) return [];
  return db
    .prepare(`SELECT id, title, summary, details_json, created_at FROM events WHERE project_id = ? AND type = 'decision' ORDER BY created_at DESC LIMIT 100`)
    .all(project.id);
}

function getProjectId() {
  const project = db.prepare('SELECT id FROM projects ORDER BY id LIMIT 1').get();
  return project?.id ?? null;
}

const addNoteTx = db.transaction((projectId, title, text) => {
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO events (project_id, type, title, summary, details_json, created_at, created_by, source, session_id)
       VALUES (?, 'note', ?, ?, ?, ?, 'human', 'generated', NULL)`
    )
    .run(projectId, title, text, JSON.stringify({ text }), ts);
  return Number(info.lastInsertRowid);
});

const addTaskTx = db.transaction((projectId, title, description, priority) => {
  const ts = nowIso();
  const taskInfo = db
    .prepare(
      `INSERT INTO tasks (project_id, title, description, status, priority, created_at, updated_at, closed_at, origin_event_id)
       VALUES (?, ?, ?, 'open', ?, ?, ?, NULL, NULL)`
    )
    .run(projectId, title, description ?? null, priority, ts, ts);

  const taskId = Number(taskInfo.lastInsertRowid);
  const eventInfo = db
    .prepare(
      `INSERT INTO events (project_id, type, title, summary, details_json, created_at, created_by, source, session_id)
       VALUES (?, 'task_created', ?, ?, ?, ?, 'human', 'generated', NULL)`
    )
    .run(
      projectId,
      `Task #${taskId} created`,
      title,
      JSON.stringify({ taskId, description: description ?? null, priority }),
      ts
    );
  const eventId = Number(eventInfo.lastInsertRowid);
  db.prepare(`UPDATE tasks SET origin_event_id = ? WHERE id = ?`).run(eventId, taskId);
  return { taskId, eventId };
});

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const ctype =
    ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.css'
        ? 'text/css; charset=utf-8'
        : ext === '.js'
          ? 'application/javascript; charset=utf-8'
          : 'application/octet-stream';
  res.writeHead(200, { 'content-type': ctype });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname === '/api/notes' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const text = String(body.text ?? '').trim();
          const title = String(body.title ?? '').trim() || 'Note';
          if (!text) return json(res, 400, { error: 'text is required' });
          const projectId = getProjectId();
          if (!projectId) return json(res, 400, { error: 'project not found' });
          const eventId = addNoteTx(projectId, title, text);
          return json(res, 201, { ok: true, eventId });
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/task-packets' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const title = String(body.title ?? '').trim();
          const summary = String(body.summary ?? '').trim();
          const goal = String(body.goal ?? '').trim();
          const priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium';
          const status = ['draft', 'ready', 'queued', 'running', 'review', 'blocked', 'done'].includes(body.status)
            ? body.status
            : 'draft';
          const tags = Array.isArray(body.tags) ? body.tags.join(',') : '';
          const targetAreas = Array.isArray(body.target_areas) ? body.target_areas.join(',') : '';
          const dependencies = Array.isArray(body.dependencies) ? body.dependencies.join(',') : '';
          if (!title) return json(res, 400, { error: 'title is required' });
          if (!summary) return json(res, 400, { error: 'summary is required' });
          if (!goal) return json(res, 400, { error: 'goal is required' });

          const payload = runSidecarJson([
            'task',
            'create',
            '--title',
            title,
            '--summary',
            summary,
            '--goal',
            goal,
            '--priority',
            priority,
            '--status',
            status,
            ...(tags ? ['--tags', tags] : []),
            ...(targetAreas ? ['--target-areas', targetAreas] : []),
            ...(dependencies ? ['--dependencies', dependencies] : []),
          ]);
          return json(res, 201, payload);
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/prompt/compile' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const taskId = String(body.task_id ?? '').trim().toUpperCase();
          const runner = ['codex', 'claude'].includes(body.runner) ? body.runner : 'codex';
          const agentRole = String(body.agent_role ?? 'builder-app');
          if (!taskId) return json(res, 400, { error: 'task_id is required' });
          const payload = runSidecarJson([
            'prompt',
            'compile',
            taskId,
            '--runner',
            runner,
            '--agent-role',
            agentRole,
          ]);
          return json(res, 200, payload);
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/run/start' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const taskId = String(body.task_id ?? '').trim().toUpperCase();
          const runner = ['codex', 'claude'].includes(body.runner) ? body.runner : null;
          const agentRole = body.agent_role ? String(body.agent_role) : null;
          const dryRun = Boolean(body.dry_run);
          if (!taskId) return json(res, 400, { error: 'task_id is required' });
          const payload = runSidecarJson([
            'run',
            taskId,
            ...(runner ? ['--runner', runner] : []),
            ...(agentRole ? ['--agent-role', agentRole] : []),
            ...(dryRun ? ['--dry-run'] : []),
          ]);
          return json(res, 200, payload);
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/run/approve' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const runId = String(body.run_id ?? '').trim().toUpperCase();
          const state = ['approved', 'needs_changes', 'merged'].includes(body.state) ? body.state : 'approved';
          const note = String(body.note ?? '');
          if (!runId) return json(res, 400, { error: 'run_id is required' });
          const payload = runSidecarJson(['run', 'approve', runId, '--state', state, ...(note ? ['--note', note] : [])]);
          return json(res, 200, payload);
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/run/block' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const runId = String(body.run_id ?? '').trim().toUpperCase();
          const note = String(body.note ?? '');
          if (!runId) return json(res, 400, { error: 'run_id is required' });
          const payload = runSidecarJson(['run', 'block', runId, ...(note ? ['--note', note] : [])]);
          return json(res, 200, payload);
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/task/create-followup' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const runId = String(body.run_id ?? '').trim().toUpperCase();
          if (!runId) return json(res, 400, { error: 'run_id is required' });
          const payload = runSidecarJson(['task', 'create-followup', runId]);
          return json(res, 200, payload);
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === '/api/preferences' && req.method === 'PUT') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return json(res, 400, { error: 'preferences payload must be a JSON object' });
          }
          writePreferences(body);
          return json(res, 200, { ok: true });
        })
        .catch((err) => json(res, 400, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/overview') return json(res, 200, loadOverview());
    if (req.method === 'GET' && url.pathname === '/api/timeline') return json(res, 200, loadTimeline());
    if (req.method === 'GET' && url.pathname === '/api/tasks') return json(res, 200, loadTasks());
    if (req.method === 'GET' && url.pathname === '/api/decisions') return json(res, 200, loadDecisions());
    if (req.method === 'GET' && url.pathname === '/api/mission')
      return json(res, 200, loadMission(url.searchParams.get('status')));
    if (req.method === 'GET' && url.pathname === '/api/task-packets')
      return json(res, 200, loadTaskPackets());
    if (req.method === 'GET' && url.pathname.startsWith('/api/task-packets/'))
      return json(res, 200, loadTaskDetail(url.pathname.split('/').pop() || ''));
    if (req.method === 'GET' && url.pathname === '/api/runs')
      return json(res, 200, loadRuns());
    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/'))
      return json(res, 200, loadRunDetail(url.pathname.split('/').pop() || ''));
    if (req.method === 'GET' && url.pathname === '/api/run-summary')
      return json(res, 200, parseEnvelope(runSidecarJson(['run', 'summary'])));
    if (req.method === 'GET' && url.pathname === '/api/preferences') return json(res, 200, readPreferences());
    if (req.method === 'GET' && url.pathname === '/api/summary') return json(res, 200, { markdown: readSummary() });

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveFile(res, path.join(publicDir, 'index.html'));
    }

    const candidate = path.normalize(path.join(publicDir, url.pathname));
    if (!candidate.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return serveFile(res, candidate);
    }

    return serveFile(res, path.join(publicDir, 'index.html'));
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Sidecar UI running at http://localhost:${port}`);
  console.log(`Project: ${projectPath}`);
});

process.on('SIGINT', () => {
  db.close();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  db.close();
  server.close(() => process.exit(0));
});
