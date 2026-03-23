const state = {
  view: 'mission',
  missionStatus: 'all',
  selectedTaskId: null,
  selectedRunId: null,
  cache: {},
};

const content = document.getElementById('content');
const navButtons = [...document.querySelectorAll('.nav-btn')];
const noteModalBtn = document.getElementById('open-note-modal');
const taskModalBtn = document.getElementById('open-task-modal');
const decisionModalBtn = document.getElementById('open-decision-modal');

let modalRoot = null;
let modalBody = null;

for (const btn of navButtons) {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    if (!view) return;
    state.view = view;
    navButtons.forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
}

function ensureModal() {
  if (modalRoot) return;
  modalRoot = document.createElement('div');
  modalRoot.className = 'modal-root hidden';
  modalRoot.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 id="modal-title">Add</h3>
        <button id="modal-close" class="icon-btn" type="button" aria-label="Close">×</button>
      </div>
      <div id="modal-body"></div>
    </div>
  `;
  document.body.appendChild(modalRoot);
  modalBody = modalRoot.querySelector('#modal-body');
  modalRoot.addEventListener('click', (event) => {
    if (event.target === modalRoot) closeModal();
  });
  modalRoot.querySelector('#modal-close').addEventListener('click', closeModal);
}

function closeModal() {
  if (!modalRoot) return;
  modalRoot.classList.add('hidden');
  modalBody.innerHTML = '';
}

function openModal(title, bodyHtml) {
  ensureModal();
  modalRoot.querySelector('#modal-title').textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalRoot.classList.remove('hidden');
}

function fmt(ts) {
  if (!ts) return 'n/a';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function badge(status) {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

async function load(key, endpoint, force = false) {
  if (!force && state.cache[key]) return state.cache[key];
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Failed to load ${key}`);
  const data = await res.json();
  state.cache[key] = data;
  return data;
}

async function postJson(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

async function putJson(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function invalidateMission() {
  state.cache.mission = null;
  state.cache.taskDetail = null;
  state.cache.runDetail = null;
  state.cache.reviewSummary = null;
}

function renderMission(mission, taskDetail, runDetail, reviewSummary) {
  const tasks = mission?.tasks ?? [];
  const selectedTask = taskDetail?.task ?? null;
  const latestRun = taskDetail?.latest_run ?? null;
  const selectedRun = runDetail ?? latestRun;

  return `
    <div class="mission-shell">
      <section class="card">
        <h3>Review Summary</h3>
        <div class="kv-grid">
          <div><span class="muted">Completed Runs</span><br/><strong>${reviewSummary?.completed_runs ?? 0}</strong></div>
          <div><span class="muted">Blocked Runs</span><br/><strong>${reviewSummary?.blocked_runs ?? 0}</strong></div>
          <div><span class="muted">Suggested Follow-ups</span><br/><strong>${reviewSummary?.suggested_follow_ups ?? 0}</strong></div>
          <div><span class="muted">Recently Merged</span><br/><strong>${reviewSummary?.recently_merged?.length ?? 0}</strong></div>
        </div>
      </section>

      <section class="mission-board card">
        <div class="board-header">
          <div>
            <h3>Mission Control</h3>
            <p class="muted">Track assignments, runs, and outcomes in one place.</p>
          </div>
          <div class="pill-row">
            <span class="pill">total ${mission?.counts?.total ?? 0}</span>
            <span class="pill">ready ${mission?.counts?.ready ?? 0}</span>
            <span class="pill">running ${mission?.counts?.running ?? 0}</span>
            <span class="pill">review ${mission?.counts?.review ?? 0}</span>
            <span class="pill">blocked ${mission?.counts?.blocked ?? 0}</span>
            <span class="pill">done ${mission?.counts?.done ?? 0}</span>
          </div>
        </div>

        <div class="filter-row">
          ${['all', 'ready', 'running', 'review', 'blocked', 'done']
            .map(
              (status) =>
                `<button class="chip ${state.missionStatus === status ? 'active' : ''}" data-status="${status}">${status}</button>`
            )
            .join('')}
        </div>

        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Role</th>
                <th>Runner</th>
                <th>Run</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${
                tasks.length
                  ? tasks
                      .map(
                        (task) => `
                      <tr class="clickable ${state.selectedTaskId === task.task_id ? 'selected' : ''}" data-task-id="${escapeHtml(task.task_id)}">
                        <td><strong>${escapeHtml(task.task_id)}</strong><br /><span class="muted">${escapeHtml(task.title)}</span></td>
                        <td>${badge(task.status)}</td>
                        <td>${escapeHtml(task.assigned_agent_role || 'unassigned')}</td>
                        <td>${escapeHtml(task.assigned_runner || 'n/a')}</td>
                        <td>${task.latest_run_id ? `<button class="link-btn" data-run-id="${escapeHtml(task.latest_run_id)}">${escapeHtml(task.latest_run_id)}</button>` : '<span class="muted">none</span>'}</td>
                        <td>${fmt(task.updated_at)}</td>
                        <td>
                          <div class="row">
                            <button class="button secondary mini icon-only" type="button" title="${task.is_packet ? 'Compile prompt' : 'Convert to task packet to compile'}" aria-label="Compile prompt" data-task-action="compile" data-task-id="${escapeHtml(task.task_id)}" ${task.is_packet ? '' : 'disabled'}>⧉</button>
                            <button class="button mini icon-only" type="button" title="${task.is_packet ? 'Run task' : 'Convert to task packet to run'}" aria-label="Run task" data-task-action="run" data-task-id="${escapeHtml(task.task_id)}" ${task.is_packet ? '' : 'disabled'}>▶</button>
                            ${task.latest_run_id ? `<button class="button secondary mini icon-only" type="button" title="View latest run" aria-label="View latest run" data-task-action="view-run" data-run-id="${escapeHtml(task.latest_run_id)}">↗</button>` : ''}
                          </div>
                        </td>
                      </tr>
                    `
                      )
                      .join('')
                  : '<tr><td colspan="7" class="muted">No tasks in this filter.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="mission-detail">
        <article class="card detail-card">
          <h3>Task Detail</h3>
          ${
            !selectedTask
              ? '<div class="empty">Select a task from Mission Control.</div>'
              : `
              <div class="detail-head">
                <strong>${escapeHtml(selectedTask.task_id)} · ${escapeHtml(selectedTask.title)}</strong>
                ${badge(selectedTask.status)}
              </div>
              <div class="kv"><strong>Summary:</strong> ${escapeHtml(selectedTask.summary)}</div>
              <div class="kv"><strong>Objective:</strong> ${escapeHtml(selectedTask.goal)}</div>
              <div class="split">
                <div>
                  <h4>Scope</h4>
                  <ul>${(selectedTask.scope?.in_scope ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
                </div>
                <div>
                  <h4>Out of Scope</h4>
                  <ul>${(selectedTask.scope?.out_of_scope ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
                </div>
              </div>
              <div class="split">
                <div>
                  <h4>Constraints</h4>
                  <ul>${[...(selectedTask.constraints?.technical ?? []), ...(selectedTask.constraints?.design ?? [])].map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
                </div>
                <div>
                  <h4>Linked Decisions/Notes</h4>
                  <ul>${[...(selectedTask.context?.related_decisions ?? []), ...(selectedTask.context?.related_notes ?? [])].map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
                </div>
              </div>
              <h4>Tracking</h4>
              <div class="kv-grid">
                <div><span class="muted">Agent</span><br/>${escapeHtml(selectedTask.tracking?.assigned_agent_role || 'unassigned')}</div>
                <div><span class="muted">Runner</span><br/>${escapeHtml(selectedTask.tracking?.assigned_runner || 'n/a')}</div>
                <div><span class="muted">Branch</span><br/>${escapeHtml(selectedTask.tracking?.branch || 'n/a')}</div>
                <div><span class="muted">Worktree</span><br/>${escapeHtml(selectedTask.tracking?.worktree || 'n/a')}</div>
              </div>
              <h4>Latest Run Result</h4>
              ${
                latestRun
                  ? `<div class="kv"><strong>${escapeHtml(latestRun.run_id)}</strong> · ${badge(latestRun.status)} · ${fmt(latestRun.completed_at || latestRun.started_at)}</div>
                     <div class="kv muted">${escapeHtml(latestRun.summary || '')}</div>`
                  : '<div class="muted">No run yet.</div>'
              }
            `
          }
        </article>

        <article class="card detail-card">
          <h3>Run Detail</h3>
          ${
            !selectedRun
              ? '<div class="empty">Select a run from the board or task panel.</div>'
              : `
              <div class="detail-head">
                <strong>${escapeHtml(selectedRun.run_id)} · ${escapeHtml(selectedRun.task_id)}</strong>
                ${badge(selectedRun.status)}
              </div>
              <div class="kv"><strong>Prompt:</strong> <code>${escapeHtml(selectedRun.prompt_path || 'n/a')}</code></div>
              <div class="kv"><strong>Lifecycle:</strong> started ${fmt(selectedRun.started_at)} · completed ${fmt(selectedRun.completed_at)}</div>
              <div class="kv"><strong>Review:</strong> ${escapeHtml(selectedRun.review_state || 'pending')}</div>
              <div class="row">
                <button class="button" data-run-action="approve" data-run-id="${escapeHtml(selectedRun.run_id)}">Approve</button>
                <button class="button secondary" data-run-action="needs_changes" data-run-id="${escapeHtml(selectedRun.run_id)}">Needs changes</button>
                <button class="button secondary" data-run-action="block" data-run-id="${escapeHtml(selectedRun.run_id)}">Mark blocked</button>
                <button class="button secondary" data-run-action="merged" data-run-id="${escapeHtml(selectedRun.run_id)}">Mark merged</button>
                <button class="button secondary" data-run-action="followup" data-run-id="${escapeHtml(selectedRun.run_id)}">Create follow-up task</button>
              </div>
              <h4>Changed Files</h4>
              <ul>${(selectedRun.changed_files ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Commands Run</h4>
              <ul>${(selectedRun.commands_run ?? []).map((v) => `<li><code>${escapeHtml(v)}</code></li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Validation Results</h4>
              <ul>${(selectedRun.validation_results ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Blockers</h4>
              <ul>${(selectedRun.blockers ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Follow-ups</h4>
              <ul>${(selectedRun.follow_ups ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
            `
          }
        </article>
      </section>

      <section class="card actions-card">
        <h3>Actions</h3>
        <div class="actions-grid">
          <div>
            <h4>Task Actions</h4>
            <p class="help">Use the buttons on each task row to compile prompts and launch runs directly from the list.</p>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderSimpleTable(items, cols) {
  if (!items?.length) return '<div class="empty">No records yet.</div>';
  return `
    <table class="table">
      <thead><tr>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${items
          .map((item) => `<tr>${cols.map((c) => `<td>${escapeHtml(c.get(item))}</td>`).join('')}</tr>`)
          .join('')}
      </tbody>
    </table>
  `;
}

function renderOverview(data) {
  if (!data?.project) return '<div class="empty">No project data found in this Sidecar database.</div>';

  const openTasks = data.openTasks || [];
  const highPriorityOpen = openTasks.filter((t) => String(t.priority || '').toLowerCase() === 'high').length;
  const activeSessionText = data.activeSession
    ? `${data.activeSession.actor_type}${data.activeSession.actor_name ? ` · ${data.activeSession.actor_name}` : ''}`
    : 'none';

  const compactList = (rows, emptyLabel, renderRow) =>
    rows?.length ? `<div class="overview-list">${rows.map(renderRow).join('')}</div>` : `<div class="empty small">${escapeHtml(emptyLabel)}</div>`;

  return `
    <div class="overview-shell">
      <article class="card overview-hero">
        <div class="overview-hero-head">
          <div>
            <h3>Project Overview</h3>
            <div class="overview-project-name">${escapeHtml(data.project.name)}</div>
            <div class="overview-project-path">${escapeHtml(data.project.root_path)}</div>
          </div>
          <div class="overview-session ${data.activeSession ? 'live' : ''}">
            <span class="dot"></span>
            Active session: ${escapeHtml(activeSessionText)}
          </div>
        </div>
      </article>

      <section class="overview-stats">
        <article class="card stat-card">
          <div class="stat-label">Open Tasks</div>
          <div class="stat-value">${openTasks.length}</div>
          <div class="stat-sub">${highPriorityOpen} high priority</div>
        </article>
        <article class="card stat-card">
          <div class="stat-label">Recent Decisions</div>
          <div class="stat-value">${(data.recentDecisions || []).length}</div>
          <div class="stat-sub">last recorded choices</div>
        </article>
        <article class="card stat-card">
          <div class="stat-label">Recent Worklogs</div>
          <div class="stat-value">${(data.recentWorklogs || []).length}</div>
          <div class="stat-sub">progress updates</div>
        </article>
        <article class="card stat-card">
          <div class="stat-label">Recent Notes</div>
          <div class="stat-value">${(data.recentNotes || []).length}</div>
          <div class="stat-sub">context capture</div>
        </article>
      </section>

      <section class="overview-main overview-main-top">
        <article class="card">
          <h3>Open Tasks</h3>
          ${compactList(
            openTasks,
            'No open tasks.',
            (t) => `
              <div class="overview-item">
                <div class="overview-item-head">
                  <span><strong>#${t.id}</strong> ${escapeHtml(t.title)}</span>
                  <span class="priority-pill priority-${escapeHtml((t.priority || 'none').toLowerCase())}">${escapeHtml(t.priority || 'n/a')}</span>
                </div>
                <div class="overview-item-meta">${fmt(t.updated_at)}</div>
              </div>
            `
          )}
        </article>

        <article class="card">
          <h3>Recent Decisions</h3>
          ${compactList(
            data.recentDecisions || [],
            'No decisions recorded yet.',
            (r) => `
              <div class="overview-item">
                <div class="overview-item-head"><strong>${escapeHtml(r.title || 'Decision')}</strong></div>
                <div class="overview-item-summary">${escapeHtml(r.summary || '')}</div>
                <div class="overview-item-meta">${fmt(r.created_at)}</div>
              </div>
            `
          )}
        </article>
        <article class="card">
          <h3>Recent Worklogs</h3>
          ${compactList(
            data.recentWorklogs || [],
            'No worklogs recorded yet.',
            (r) => `
              <div class="overview-item">
                <div class="overview-item-head"><strong>${escapeHtml(r.title || 'Worklog')}</strong></div>
                <div class="overview-item-summary">${escapeHtml(r.summary || '')}</div>
                <div class="overview-item-meta">${fmt(r.created_at)}</div>
              </div>
            `
          )}
        </article>
      </section>

      <section class="overview-main overview-main-bottom">
        <article class="card">
          <h3>Recent Notes</h3>
          ${compactList(
            data.recentNotes || [],
            'No notes recorded yet.',
            (n) => `
              <div class="overview-item">
                <div class="overview-item-head"><strong>${escapeHtml(n.title || 'Note')}</strong></div>
                <div class="overview-item-summary">${escapeHtml(n.summary || '')}</div>
                <div class="overview-item-meta">${fmt(n.created_at)}</div>
              </div>
            `
          )}
        </article>
      </section>
    </div>
  `;
}

function renderTimeline(items) {
  if (!items?.length) return '<div class="empty">No events yet.</div>';

  const byDay = new Map();
  for (const item of items) {
    const dayKey = String(item.created_at || '').slice(0, 10) || 'unknown';
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(item);
  }

  const daySections = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, rows]) => {
      const label = day === 'unknown' ? 'Unknown date' : new Date(`${day}T00:00:00`).toLocaleDateString();
      return `
      <section class="timeline-day">
        <div class="timeline-day-label">${escapeHtml(label)}</div>
        <div class="timeline-events">
          ${rows
            .map((e) => {
              const type = String(e.type || 'event');
              const title = String(e.title || type);
              const summary = String(e.summary || '').trim();
              const meta = [e.created_by ? `by ${e.created_by}` : null, e.source ? `source ${e.source}` : null, e.id ? `#${e.id}` : null]
                .filter(Boolean)
                .join(' • ');
              return `
                <article class="timeline-item">
                  <div class="timeline-dot"></div>
                  <div class="timeline-card">
                    <div class="timeline-card-head">
                      <span class="timeline-time">${escapeHtml(fmt(e.created_at))}</span>
                      <span class="timeline-type timeline-type-${escapeHtml(type)}">${escapeHtml(type.replaceAll('_', ' '))}</span>
                    </div>
                    <div class="timeline-title">${escapeHtml(title)}</div>
                    ${summary ? `<div class="timeline-summary">${escapeHtml(summary)}</div>` : ''}
                    ${meta ? `<div class="timeline-meta">${escapeHtml(meta)}</div>` : ''}
                  </div>
                </article>
              `;
            })
            .join('')}
        </div>
      </section>
      `;
    })
    .join('');

  return `
    <div class="timeline-shell">
      <section class="card">
        <h3>Timeline</h3>
        <div class="kv muted">Scroll through the full project history in recorded order.</div>
        <div class="timeline-scroll">${daySections}</div>
      </section>
    </div>
  `;
}

function renderPreferences(data, summary) {
  const prefsText = JSON.stringify(data ?? {}, null, 2);
  return `
    <div class="grid">
      <article class="card">
        <h3>Preferences</h3>
        <textarea id="preferences-editor" class="textarea" style="min-height:240px;">${escapeHtml(prefsText)}</textarea>
        <div class="row">
          <button id="preferences-save" class="button" type="button">Save preferences</button>
          <button id="preferences-reload" class="button secondary" type="button">Reload</button>
        </div>
      </article>
      <article class="card">
        <h3>Summary.md</h3>
        <pre class="code">${escapeHtml(summary?.markdown || '')}</pre>
      </article>
    </div>
  `;
}

function invalidateGlobalData() {
  state.cache.overview = null;
  state.cache.timeline = null;
  state.cache.tasks = null;
  invalidateMission();
}

function openNoteModal() {
  openModal(
    'Add Note',
    `
    <form id="modal-note-form">
      <input class="input" name="title" placeholder="Title (optional)" />
      <textarea class="textarea" name="text" placeholder="Capture context for future sessions..." required></textarea>
      <div class="modal-footer">
        <button class="button secondary" data-close-modal type="button">Cancel</button>
        <button class="button" type="submit">Add note</button>
      </div>
    </form>
  `
  );

  const form = document.getElementById('modal-note-form');
  form.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await postJson('/api/notes', { title: data.get('title'), text: data.get('text') });
      closeModal();
      invalidateGlobalData();
      await render();
    } catch (err) {
      alert(`Could not add note: ${err.message}`);
    }
  });
}

function openTaskModal() {
  openModal(
    'Add Task',
    `
    <form id="modal-task-form">
      <input class="input" name="title" placeholder="Task title" required />
      <textarea class="textarea" name="description" placeholder="Summary / goal"></textarea>
      <select class="select" name="priority">
        <option value="low">low</option>
        <option value="medium" selected>medium</option>
        <option value="high">high</option>
      </select>
      <div class="modal-footer">
        <button class="button secondary" data-close-modal type="button">Cancel</button>
        <button class="button" type="submit">Add task</button>
      </div>
    </form>
  `
  );

  const form = document.getElementById('modal-task-form');
  form.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const title = String(data.get('title') || '').trim();
      const description = String(data.get('description') || '').trim();
      const summary = description || title;
      const goal = description || `Complete: ${title}`;
      await postJson('/api/task-packets', {
        title,
        summary,
        goal,
        status: 'ready',
        priority: data.get('priority'),
        tags: [],
      });
      closeModal();
      invalidateGlobalData();
      await render();
    } catch (err) {
      alert(`Could not add task: ${err.message}`);
    }
  });
}

function openDecisionModal() {
  openModal(
    'Add Decision',
    `
    <form id="modal-decision-form">
      <input class="input" name="title" placeholder="Decision title" required />
      <textarea class="textarea" name="summary" placeholder="Why this decision was made..." required></textarea>
      <textarea class="textarea" name="details" placeholder="Details (optional)"></textarea>
      <div class="modal-footer">
        <button class="button secondary" data-close-modal type="button">Cancel</button>
        <button class="button" type="submit">Record decision</button>
      </div>
    </form>
  `
  );

  const form = document.getElementById('modal-decision-form');
  form.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await postJson('/api/decisions', {
        title: data.get('title'),
        summary: data.get('summary'),
        details: data.get('details'),
      });
      closeModal();
      invalidateGlobalData();
      await render();
    } catch (err) {
      alert(`Could not add decision: ${err.message}`);
    }
  });
}

async function renderMissionView() {
  const mission = await load('mission', `/api/mission?status=${encodeURIComponent(state.missionStatus)}`, true);
  if (!state.selectedTaskId && mission.tasks?.length) state.selectedTaskId = mission.tasks[0].task_id;
  const taskDetail = state.selectedTaskId
    ? await load('taskDetail', `/api/task-packets/${encodeURIComponent(state.selectedTaskId)}`, true)
    : null;
  if (!state.selectedRunId && taskDetail?.latest_run?.run_id) state.selectedRunId = taskDetail.latest_run.run_id;
  const runDetail = state.selectedRunId
    ? await load('runDetail', `/api/runs/${encodeURIComponent(state.selectedRunId)}`, true)
    : null;

  const reviewSummary = await load('reviewSummary', '/api/run-summary', true);
  content.innerHTML = renderMission(mission, taskDetail, runDetail, reviewSummary);
  attachMissionHandlers();
}

async function render() {
  content.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (state.view === 'mission') {
      await renderMissionView();
      return;
    }
    if (state.view === 'overview') {
      content.innerHTML = renderOverview(await load('overview', '/api/overview'));
      return;
    }
    if (state.view === 'timeline') {
      content.innerHTML = renderTimeline(await load('timeline', '/api/timeline'));
      return;
    }
    if (state.view === 'preferences') {
      const [preferences, summary] = await Promise.all([
        load('preferences', '/api/preferences'),
        load('summary', '/api/summary'),
      ]);
      content.innerHTML = renderPreferences(preferences, summary);
      attachPreferencesMutations();
      return;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty">Failed to load view: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

if (noteModalBtn) noteModalBtn.addEventListener('click', openNoteModal);
if (taskModalBtn) taskModalBtn.addEventListener('click', openTaskModal);
if (decisionModalBtn) decisionModalBtn.addEventListener('click', openDecisionModal);

function attachMissionHandlers() {
  document.querySelectorAll('[data-status]').forEach((el) => {
    el.addEventListener('click', async () => {
      state.missionStatus = el.getAttribute('data-status') || 'all';
      invalidateMission();
      await render();
    });
  });

  document.querySelectorAll('[data-task-id]').forEach((el) => {
    el.addEventListener('click', async () => {
      state.selectedTaskId = el.getAttribute('data-task-id');
      state.selectedRunId = null;
      state.cache.taskDetail = null;
      state.cache.runDetail = null;
      await render();
    });
  });

  document.querySelectorAll('[data-run-id]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.stopPropagation();
      state.selectedRunId = el.getAttribute('data-run-id');
      state.cache.runDetail = null;
      await render();
    });
  });

  document.querySelectorAll('[data-task-action]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = el.getAttribute('data-task-action');
      const taskId = el.getAttribute('data-task-id');
      const runId = el.getAttribute('data-run-id');
      try {
        if (action === 'view-run' && runId) {
          state.selectedRunId = runId;
        } else if (action === 'compile' && taskId) {
          const detail = await load('taskDetail', `/api/task-packets/${encodeURIComponent(taskId)}`, true);
          const task = detail?.task || {};
          const res = await postJson('/api/prompt/compile', {
            task_id: taskId,
            runner: task?.tracking?.assigned_runner || 'codex',
            agent_role: task?.tracking?.assigned_agent_role || 'builder-app',
          });
          alert(`Prompt compiled: ${res?.data?.prompt_path || 'done'}`);
        } else if (action === 'run' && taskId) {
          const detail = await load('taskDetail', `/api/task-packets/${encodeURIComponent(taskId)}`, true);
          const task = detail?.task || {};
          const res = await postJson('/api/run/start', {
            task_id: taskId,
            runner: task?.tracking?.assigned_runner || null,
            agent_role: task?.tracking?.assigned_agent_role || null,
            dry_run: false,
          });
          const newRunId = res?.data?.run_id;
          if (newRunId) state.selectedRunId = newRunId;
        }
        invalidateMission();
        await render();
      } catch (err) {
        alert(`Task action failed: ${err.message}`);
      }
    });
  });

  document.querySelectorAll('[data-run-action]').forEach((el) => {
    el.addEventListener('click', async () => {
      const action = el.getAttribute('data-run-action');
      const runId = el.getAttribute('data-run-id');
      if (!runId || !action) return;
      try {
        if (action === 'approve' || action === 'needs_changes' || action === 'merged') {
          await postJson('/api/run/approve', { run_id: runId, state: action });
        } else if (action === 'block') {
          await postJson('/api/run/block', { run_id: runId });
        } else if (action === 'followup') {
          const res = await postJson('/api/task/create-followup', { run_id: runId });
          alert(`Follow-up task created: ${res?.data?.task_id || 'done'}`);
        }
        invalidateMission();
        state.cache.reviewSummary = null;
        await render();
      } catch (err) {
        alert(`Run action failed: ${err.message}`);
      }
    });
  });
}

function attachPreferencesMutations() {
  const save = document.getElementById('preferences-save');
  const reload = document.getElementById('preferences-reload');
  const editor = document.getElementById('preferences-editor');
  if (!(save && reload && editor)) return;

  save.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(editor.value || '{}');
      await putJson('/api/preferences', parsed);
      state.cache.preferences = parsed;
      alert('Preferences saved.');
    } catch (err) {
      alert(`Could not save preferences: ${err.message}`);
    }
  });

  reload.addEventListener('click', async () => {
    try {
      state.cache.preferences = null;
      const prefs = await load('preferences', '/api/preferences', true);
      editor.value = JSON.stringify(prefs ?? {}, null, 2);
    } catch (err) {
      alert(`Could not reload preferences: ${err.message}`);
    }
  });
}

render();
