const state = {
  view: 'mission',
  missionStatus: 'all',
  selectedTaskId: null,
  selectedRunId: null,
  cache: {},
};

const content = document.getElementById('content');
const navButtons = [...document.querySelectorAll('.nav-btn')];

for (const btn of navButtons) {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    if (!view) return;
    state.view = view;
    navButtons.forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
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
                      </tr>
                    `
                      )
                      .join('')
                  : '<tr><td colspan="6" class="muted">No tasks in this filter.</td></tr>'
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
          <form id="create-task-form">
            <h4>Create Task</h4>
            <input class="input" name="title" placeholder="Title" required />
            <input class="input" name="summary" placeholder="Summary" required />
            <input class="input" name="goal" placeholder="Goal" required />
            <div class="row">
              <select class="select" name="status">
                <option value="draft">draft</option>
                <option value="ready" selected>ready</option>
              </select>
              <select class="select" name="priority">
                <option value="low">low</option>
                <option value="medium" selected>medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <input class="input" name="tags" placeholder="tags (comma-separated)" />
            <button class="button" type="submit">Create task</button>
          </form>

          <form id="compile-prompt-form">
            <h4>Compile Prompt</h4>
            <input class="input" name="task_id" placeholder="Task ID (e.g. T-001)" value="${escapeHtml(state.selectedTaskId || '')}" required />
            <div class="row">
              <select class="select" name="runner">
                <option value="codex">codex</option>
                <option value="claude">claude</option>
              </select>
              <input class="input" name="agent_role" placeholder="agent role" value="builder-app" />
            </div>
            <button class="button" type="submit">Compile prompt</button>
          </form>

          <form id="run-task-form">
            <h4>Run Task</h4>
            <input class="input" name="task_id" placeholder="Task ID (e.g. T-001)" value="${escapeHtml(state.selectedTaskId || '')}" required />
            <div class="row">
              <select class="select" name="runner">
                <option value="">auto</option>
                <option value="codex">codex</option>
                <option value="claude">claude</option>
              </select>
              <input class="input" name="agent_role" placeholder="agent role override" />
            </div>
            <label class="check"><input type="checkbox" name="dry_run" checked /> dry run</label>
            <button class="button" type="submit">Run task</button>
          </form>

          <div>
            <h4>View Latest Run</h4>
            <p class="muted">Jump from the selected task to its latest run report.</p>
            <button id="view-latest-run" class="button secondary" type="button" ${latestRun ? '' : 'disabled'}>View latest run</button>
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
      const data = await load('overview', '/api/overview');
      content.innerHTML = `<div class="card"><h3>Overview</h3><pre class="code">${escapeHtml(JSON.stringify(data, null, 2))}</pre></div>`;
      return;
    }
    if (state.view === 'timeline') {
      const rows = await load('timeline', '/api/timeline');
      content.innerHTML = renderSimpleTable(rows, [
        { label: 'Time', get: (r) => fmt(r.created_at) },
        { label: 'Type', get: (r) => r.type || '' },
        { label: 'Title', get: (r) => r.title || '' },
        { label: 'Summary', get: (r) => r.summary || '' },
      ]);
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

  const viewLatest = document.getElementById('view-latest-run');
  if (viewLatest) {
    viewLatest.addEventListener('click', async () => {
      const detail = await load('taskDetail', `/api/task-packets/${encodeURIComponent(state.selectedTaskId)}`, true);
      state.selectedRunId = detail?.latest_run?.run_id || null;
      state.cache.runDetail = null;
      await render();
    });
  }

  const createTaskForm = document.getElementById('create-task-form');
  if (createTaskForm) {
    createTaskForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(createTaskForm);
      try {
        await postJson('/api/task-packets', {
          title: form.get('title'),
          summary: form.get('summary'),
          goal: form.get('goal'),
          status: form.get('status'),
          priority: form.get('priority'),
          tags: String(form.get('tags') || '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        });
        invalidateMission();
        await render();
      } catch (err) {
        alert(`Could not create task: ${err.message}`);
      }
    });
  }

  const compileForm = document.getElementById('compile-prompt-form');
  if (compileForm) {
    compileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(compileForm);
      try {
        const res = await postJson('/api/prompt/compile', {
          task_id: form.get('task_id'),
          runner: form.get('runner'),
          agent_role: form.get('agent_role'),
        });
        alert(`Prompt compiled: ${res?.data?.prompt_path || 'done'}`);
        invalidateMission();
        await render();
      } catch (err) {
        alert(`Could not compile prompt: ${err.message}`);
      }
    });
  }

  const runForm = document.getElementById('run-task-form');
  if (runForm) {
    runForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(runForm);
      try {
        const res = await postJson('/api/run/start', {
          task_id: form.get('task_id'),
          runner: form.get('runner') || null,
          agent_role: form.get('agent_role') || null,
          dry_run: form.get('dry_run') === 'on',
        });
        const runId = res?.data?.run_id;
        if (runId) state.selectedRunId = runId;
        invalidateMission();
        await render();
      } catch (err) {
        alert(`Could not run task: ${err.message}`);
      }
    });
  }

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
