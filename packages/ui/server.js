#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
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

    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      readBody(req)
        .then((raw) => {
          const body = raw ? JSON.parse(raw) : {};
          const title = String(body.title ?? '').trim();
          const description = String(body.description ?? '').trim() || null;
          const priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium';
          if (!title) return json(res, 400, { error: 'title is required' });
          const projectId = getProjectId();
          if (!projectId) return json(res, 400, { error: 'project not found' });
          const result = addTaskTx(projectId, title, description, priority);
          return json(res, 201, { ok: true, ...result });
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
