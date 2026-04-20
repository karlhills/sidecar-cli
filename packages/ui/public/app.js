// ── Theme init ────────────────────────────────────────────────────────────────

(function initTheme() {
  const saved = localStorage.getItem('sidecar.theme');
  const theme = saved === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();

// ── Toast notification system ─────────────────────────────────────────────────

let toastRoot = null;

function ensureToastRoot() {
  if (toastRoot) return toastRoot;
  toastRoot = document.createElement('div');
  toastRoot.id = 'toast-root';
  toastRoot.className = 'toast-root';
  toastRoot.setAttribute('role', 'status');
  toastRoot.setAttribute('aria-live', 'polite');
  toastRoot.setAttribute('aria-atomic', 'false');
  document.body.appendChild(toastRoot);
  return toastRoot;
}

function showToast({ type = 'info', title, message = '' }) {
  const root = ensureToastRoot();
  const glyphs = { success: '✓', error: '✕', info: 'ℹ' };
  const glyph = glyphs[type] || glyphs.info;
  const autoDismissMs = type === 'error' ? 7000 : 4000;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${glyph}</span>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
    </div>
    <button class="toast-close" type="button" aria-label="Dismiss notification">×</button>
  `;

  root.appendChild(toast);

  function dismiss() {
    clearTimeout(timerId);
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    // Fallback removal in case animationend doesn't fire
    setTimeout(() => toast.remove(), 400);
  }

  const timerId = setTimeout(dismiss, autoDismissMs);
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  toast.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
}

// ─────────────────────────────────────────────────────────────────────────────

const state = {
  view: 'triage',
  missionStatus: 'all',
  selectedTaskId: null,
  selectedRunId: null,
  triageIndex: 0,
  triageRuns: [],
  cache: {},
  timelineEvents: [],
  timelineHasMore: false,
  timelineNextOffset: 0,
  timelineFilter: { types: new Set(), query: '' },
};

// ── Mission polling ──────────────────────────────────────────────────────────

let _pollTimer = null;
let _pollPaused = false;
const POLL_INTERVAL_MS = 15000;

function startMissionPolling() {
  stopMissionPolling();
  if (_pollPaused) return;
  _pollTimer = setInterval(async () => {
    if (state.view !== 'mission') { stopMissionPolling(); return; }
    if (document.visibilityState !== 'visible') return;
    if (_pollPaused) return;
    await _pollMissionRefresh();
  }, POLL_INTERVAL_MS);
}

function stopMissionPolling() {
  if (_pollTimer !== null) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function _pollMissionRefresh() {
  const btn = document.getElementById('mission-refresh-btn');
  const spinner = document.getElementById('mission-refresh-spinner');
  try {
    if (spinner) spinner.classList.add('spinning');
    if (btn) btn.disabled = true;
    invalidateMission();
    await renderMissionView(true);
  } catch (_) {
    // silent poll failure — don't toast on background refresh
  } finally {
    if (spinner) spinner.classList.remove('spinning');
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.view === 'mission') {
    startMissionPolling();
  }
});

// ── Timeline keyboard shortcut (/  → focus search) ───────────────────────────
window.addEventListener('keydown', (e) => {
  if (state.view !== 'timeline') return;
  if (e.key !== '/') return;
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  const searchEl = document.getElementById('timeline-search');
  if (searchEl) searchEl.focus();
});

const content = document.getElementById('content');
const navButtons = [...document.querySelectorAll('.nav-btn')];
const noteModalBtn = document.getElementById('open-note-modal');
const taskModalBtn = document.getElementById('open-task-modal');
const decisionModalBtn = document.getElementById('open-decision-modal');

let modalRoot = null;
let modalBody = null;
let modalOpener = null;
let _modalFocusTrapHandler = null;

for (const btn of navButtons) {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    if (!view) return;
    const leaving = state.view;
    state.view = view;
    navButtons.forEach((b) => b.classList.toggle('active', b === btn));
    if (leaving === 'mission') stopMissionPolling();
    render();
  });
}

const FOCUSABLE = 'input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ensureModal() {
  if (modalRoot) return;
  modalRoot = document.createElement('div');
  modalRoot.className = 'modal-root hidden';
  modalRoot.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
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
  // Remove focus trap
  if (_modalFocusTrapHandler) {
    document.removeEventListener('keydown', _modalFocusTrapHandler);
    _modalFocusTrapHandler = null;
  }
  modalRoot.classList.add('hidden');
  modalBody.innerHTML = '';
  // Restore focus to opener
  if (modalOpener && typeof modalOpener.focus === 'function') {
    modalOpener.focus();
    modalOpener = null;
  }
}

function openModal(title, bodyHtml) {
  // Store opener before ensureModal potentially steals focus
  modalOpener = document.activeElement;
  ensureModal();
  modalRoot.querySelector('#modal-title').textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalRoot.classList.remove('hidden');

  // Focus first focusable element (skip the Close button itself)
  const card = modalRoot.querySelector('.modal-card');
  const firstFocusable = card.querySelector(`input, textarea, select, button:not([aria-label="Close"])`);
  if (firstFocusable) firstFocusable.focus();

  // Remove any previous trap
  if (_modalFocusTrapHandler) {
    document.removeEventListener('keydown', _modalFocusTrapHandler);
  }

  _modalFocusTrapHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...card.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('.modal-root.hidden'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', _modalFocusTrapHandler);
}

// Matches CLI humanTime() in src/lib/format.ts: stable YYYY-MM-DD HH:mm in local time.
// Locale-independent so logs stay grep-friendly and consistent with terminal output.
function fmt(ts) {
  if (!ts) return 'n/a';
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return ts;
  }
}

// Compact duration render for a timeout limit: "45s", "2m", "1h30m".
function fmtTimeoutMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
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

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const s = new Date(startedAt).getTime();
  const e = new Date(completedAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const ms = e - s;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function renderMission(mission, taskDetail, runDetail, reviewSummary, runPrompt, runLog) {
  const tasks = mission?.tasks ?? [];
  const counts = mission?.counts ?? {};
  const totalCount = counts.total ?? 0;
  const selectedTask = taskDetail?.task ?? null;
  const latestRun = taskDetail?.latest_run ?? null;
  const selectedRun = runDetail ?? latestRun;
  // Look up the task title for the selected run (for header context)
  const runOwnerTask = selectedRun
    ? tasks.find((t) => t.task_id === selectedRun.task_id)
    : null;
  const runOwnerTitle = runOwnerTask?.title ?? null;
  const taskMismatch = selectedRun && state.selectedTaskId && selectedRun.task_id !== state.selectedTaskId;
  const duration = selectedRun ? formatDuration(selectedRun.started_at, selectedRun.completed_at) : null;

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
          <div class="board-controls">
            <div class="filter-row">${['all', 'ready', 'running', 'review', 'blocked', 'done'].map((s) => { const c = s === 'all' ? totalCount : (counts[s] ?? 0); const a = state.missionStatus === s; return `<button type="button" class="chip${a ? ' active' : ''}" data-status="${s}" aria-pressed="${a}">${escapeHtml(s)} <span class="chip-count${a ? '' : ' muted'}">${c}</span></button>`; }).join('')}</div>
            <div class="board-poll-controls">
              <button type="button" class="button secondary mini" id="mission-refresh-btn" aria-label="Refresh mission board"><span id="mission-refresh-spinner" class="poll-spinner" aria-hidden="true">&#8635;</span> Refresh</button>
              <button type="button" class="button secondary mini" id="mission-poll-toggle" aria-label="${_pollPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}">${_pollPaused ? '&#9654; Resume' : '&#10074;&#10074; Pause'}</button>
            </div>
          </div>
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
              ${(() => {
                if (tasks.length === 0) {
                  if (state.missionStatus === 'all') {
                    return `<tr><td colspan="7"><div class="mission-empty"><div class="mission-empty-title">No tasks yet</div><div class="mission-empty-sub">Start by creating your first task.</div><button type="button" class="button" id="mission-create-first-task">Create your first task</button></div></td></tr>`;
                  }
                  return `<tr><td colspan="7"><div class="mission-empty"><div class="mission-empty-title">No tasks match this filter</div>${totalCount > 0 ? '<button type="button" class="button secondary" id="mission-clear-filter">Clear filter</button>' : ''}</div></td></tr>`;
                }
                return tasks.map((task) => {
                  const isSR = !!(state.selectedRunId && state.selectedRunId === task.latest_run_id);
                  return `<tr class="clickable${state.selectedTaskId === task.task_id ? ' selected' : ''}" data-row-task-id="${escapeHtml(task.task_id)}">
                    <td><strong>${escapeHtml(task.task_id)}</strong><br /><span class="muted">${escapeHtml(task.title)}</span></td>
                    <td>${badge(task.status)}</td>
                    <td>${escapeHtml(task.assigned_agent_role || 'unassigned')}</td>
                    <td>${escapeHtml(task.assigned_runner || 'n/a')}</td>
                    <td>${task.latest_run_id ? `<button type="button" class="link-btn${isSR ? ' selected' : ''}" data-run-id="${escapeHtml(task.latest_run_id)}">${escapeHtml(task.latest_run_id)}</button>` : '<span class="muted">none</span>'}</td>
                    <td>${fmt(task.updated_at)}</td>
                    <td><div class="row">
                      <button class="button secondary mini icon-only" type="button" title="${task.is_packet ? 'Compile prompt' : 'Convert to task packet to compile'}" aria-label="Compile prompt" data-task-action="compile" data-action-task-id="${escapeHtml(task.task_id)}" ${task.is_packet ? '' : 'disabled'}>&#10695;</button>
                      <button class="button mini icon-only" type="button" title="${task.is_packet ? 'Run task' : 'Convert to task packet to run'}" aria-label="Run task" data-task-action="run" data-action-task-id="${escapeHtml(task.task_id)}" ${task.is_packet ? '' : 'disabled'}>&#9654;</button>
                      ${task.latest_run_id ? `<button class="button secondary mini icon-only" type="button" title="View latest run" aria-label="View latest run" data-task-action="view-run" data-run-id="${escapeHtml(task.latest_run_id)}">&#8599;</button>` : ''}
                    </div></td>
                  </tr>`;
                }).join('');
              })()}
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
                <strong>${escapeHtml(selectedRun.run_id)} — for ${escapeHtml(selectedRun.task_id)}${runOwnerTitle ? `: "${escapeHtml(runOwnerTitle)}"` : ''}</strong>
                ${badge(selectedRun.status)}
              </div>
              ${taskMismatch ? `<div class="run-task-mismatch">(viewing a run for a different task)</div>` : ''}
              <div class="kv"><strong>Runner:</strong> ${escapeHtml(selectedRun.runner_type || 'n/a')}${selectedRun.agent_role ? ` (${escapeHtml(selectedRun.agent_role)})` : ''}</div>
              <div class="kv"><strong>Lifecycle:</strong> started ${fmt(selectedRun.started_at)} · completed ${fmt(selectedRun.completed_at)}${duration ? ` · ${escapeHtml(duration)}` : ''}</div>
              ${
                selectedRun.parent_run_id
                  ? `<div class="kv lineage-row"><strong>Replay of:</strong> <a href="#" data-run-link="${escapeHtml(selectedRun.parent_run_id)}">${escapeHtml(selectedRun.parent_run_id)}</a>${
                      selectedRun.replay_reason ? ` — <span class="muted">${escapeHtml(selectedRun.replay_reason)}</span>` : ''
                    }</div>`
                  : ''
              }
              ${
                Array.isArray(selectedRun.children) && selectedRun.children.length
                  ? `<div class="kv lineage-row"><strong>Replays:</strong> ${selectedRun.children
                      .map(
                        (c) =>
                          `<a href="#" data-run-link="${escapeHtml(c.run_id)}" title="${escapeHtml(c.replay_reason || '')}">${escapeHtml(c.run_id)}</a> <span class="muted">[${escapeHtml(c.status || '')}]</span>`,
                      )
                      .join(' · ')}</div>`
                  : ''
              }
              <div class="kv"><strong>Review:</strong> ${escapeHtml(selectedRun.review_state || 'pending')}${
                selectedRun.reviewed_by
                  ? ` · by ${escapeHtml(selectedRun.reviewed_by)}${
                      selectedRun.reviewed_by === 'sidecar:auto'
                        ? ` <span class="auto-approve-badge" title="${escapeHtml(selectedRun.review_note || 'Auto-approved by validation')}">auto-approved</span>`
                        : ''
                    }`
                  : ''
              }</div>
              <div class="row">
                <button class="button" data-run-action="approve" data-run-id="${escapeHtml(selectedRun.run_id)}">Approve</button>
                <button class="button secondary" data-run-action="needs_changes" data-run-id="${escapeHtml(selectedRun.run_id)}">Needs changes</button>
                <button class="button secondary" data-run-action="block" data-run-id="${escapeHtml(selectedRun.run_id)}">Mark blocked</button>
                <button class="button secondary" data-run-action="merged" data-run-id="${escapeHtml(selectedRun.run_id)}">Mark merged</button>
                <button class="button secondary" data-run-action="followup" data-run-id="${escapeHtml(selectedRun.run_id)}">Create follow-up task</button>
              </div>
              <details class="run-prompt-details">
                <summary>Prompt preview</summary>
                ${(() => {
                  if (!runPrompt) return '<div class="muted">Prompt not loaded.</div>';
                  if (runPrompt.content == null) return '<div class="muted">Prompt not compiled yet.</div>';
                  let html = `<pre class="prompt-preview">${escapeHtml(runPrompt.content)}</pre>`;
                  if (runPrompt.truncated) html += `<div class="muted">… truncated (showing first 4000 chars)</div>`;
                  if (runPrompt.prompt_path) html += `<div class="muted">Path: ${escapeHtml(runPrompt.prompt_path)}</div>`;
                  return html;
                })()}
              </details>
              <h4>Log (tail)</h4>
              ${(() => {
                if (!runLog) return '<div class="muted">Log not loaded.</div>';
                if (!runLog.exists || runLog.content == null) {
                  return '<div class="muted">No log captured (dry-run or runner not executed).</div>';
                }
                let html = `<pre class="run-log">${escapeHtml(runLog.content)}</pre>`;
                if (runLog.truncated) html += `<div class="muted">… truncated (showing last 16000 chars)</div>`;
                if (runLog.log_path) html += `<div class="muted">Path: ${escapeHtml(runLog.log_path)}</div>`;
                return html;
              })()}
              <h4>Changed Files</h4>
              <ul>${(selectedRun.changed_files ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Commands Run</h4>
              <ul>${(selectedRun.commands_run ?? []).map((v) => `<li><code>${escapeHtml(v)}</code></li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Validation Results</h4>
              ${(() => {
                const typed = Array.isArray(selectedRun.validation) ? selectedRun.validation : [];
                if (typed.length) {
                  return `<ul class="validation-list">${typed
                    .map((v) => {
                      const kind = String(v.kind || 'custom').toLowerCase();
                      const kindClass = ['typecheck', 'lint', 'test', 'build', 'custom'].includes(kind) ? kind : 'custom';
                      const statusClass = v.timed_out
                        ? 'validation-status-timeout'
                        : v.ok
                          ? 'validation-status-ok'
                          : 'validation-status-fail';
                      const statusText = v.timed_out ? 'timed-out' : v.ok ? 'ok' : 'failed';
                      const dur = Number.isFinite(v.duration_ms) ? `${(v.duration_ms / 1000).toFixed(1)}s` : '';
                      const timeout = Number.isFinite(v.timeout_ms) && v.timeout_ms > 0
                        ? fmtTimeoutMs(v.timeout_ms)
                        : '';
                      const durCell = dur
                        ? `<span class="muted">${escapeHtml(dur)}${timeout ? ` / ${escapeHtml(timeout)}` : ''}</span>`
                        : '';
                      const name = v.name ? ` <span class="muted">${escapeHtml(v.name)}</span>` : '';
                      return `<li class="validation-row">
                        <span class="validation-kind validation-kind-${kindClass}">${escapeHtml(kind)}</span>${name}
                        <span class="${statusClass}">${statusText}</span>
                        ${durCell}
                        <code>${escapeHtml(v.command || '')}</code>
                      </li>`;
                    })
                    .join('')}</ul>`;
                }
                const legacy = selectedRun.validation_results ?? [];
                return `<ul>${legacy.map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>`;
              })()}
              <h4>Blockers</h4>
              <ul>${(selectedRun.blockers ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
              <h4>Follow-ups</h4>
              <ul>${(selectedRun.follow_ups ?? []).map((v) => `<li>${escapeHtml(v)}</li>`).join('') || '<li class="muted">none</li>'}</ul>
            `
          }
        </article>
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
  const counts = data.counts || null;
  // Use server-provided counts when available; fall back to .length for older servers
  const statOpenTasks = counts ? counts.openTasks : openTasks.length;
  const statOpenTasksHigh = counts ? counts.openTasksHigh : openTasks.filter((t) => String(t.priority || '').toLowerCase() === 'high').length;
  const statDecisions = counts ? counts.decisionsTotal : (data.recentDecisions || []).length;
  const statWorklogs = counts ? counts.worklogsTotal : (data.recentWorklogs || []).length;
  const statNotes = counts ? counts.notesTotal : (data.recentNotes || []).length;

  const activeSessionText = data.activeSession
    ? `${data.activeSession.actor_type}${data.activeSession.actor_name ? ` · ${data.activeSession.actor_name}` : ''}`
    : 'none';

  const compactList = (rows, emptyHtml, renderRow) =>
    rows?.length ? `<div class="overview-list">${rows.map(renderRow).join('')}</div>` : emptyHtml;

  const taskEmptyHtml = `
    <div class="empty small">No open tasks.
      <br/><button class="button" style="margin-top:8px" data-overview-cta="task">Create your first task</button>
    </div>`;
  const decisionEmptyHtml = `
    <div class="empty small">No decisions recorded yet.
      <br/><button class="button" style="margin-top:8px" data-overview-cta="decision">Record your first decision</button>
    </div>`;
  const noteEmptyHtml = `
    <div class="empty small">No notes recorded yet.
      <br/><button class="button" style="margin-top:8px" data-overview-cta="note">Capture your first note</button>
    </div>`;
  const worklogEmptyHtml = `<div class="empty small">Worklogs appear after your first recorded change. Try running a task.</div>`;

  return `
    <div class="overview-shell">
      <article class="card overview-hero">
        <div class="overview-hero-head">
          <div>
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
        <article class="card stat-card${statOpenTasksHigh > 0 ? ' stat-card-alert' : ''}">
          <div class="stat-label">Open Tasks</div>
          <div class="stat-value">${statOpenTasks}</div>
          <div class="stat-sub">${statOpenTasksHigh} high priority</div>
        </article>
        <article class="card stat-card">
          <div class="stat-label">Decisions</div>
          <div class="stat-value">${statDecisions}</div>
          <div class="stat-sub">in project history</div>
        </article>
        <article class="card stat-card">
          <div class="stat-label">Worklogs</div>
          <div class="stat-value">${statWorklogs}</div>
          <div class="stat-sub">progress updates</div>
        </article>
        <article class="card stat-card">
          <div class="stat-label">Notes</div>
          <div class="stat-value">${statNotes}</div>
          <div class="stat-sub">context captured</div>
        </article>
      </section>

      <section class="overview-main overview-main-top">
        <article class="card">
          <h3>Open Tasks</h3>
          ${compactList(
            openTasks,
            taskEmptyHtml,
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
            decisionEmptyHtml,
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
            worklogEmptyHtml,
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
            noteEmptyHtml,
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

function attachOverviewCTAs() {
  document.querySelectorAll('[data-overview-cta]').forEach((el) => {
    el.addEventListener('click', () => {
      const cta = el.getAttribute('data-overview-cta');
      if (cta === 'task') openTaskModal();
      else if (cta === 'decision') openDecisionModal();
      else if (cta === 'note') openNoteModal();
    });
  });
}

const TIMELINE_FILTER_TYPES = ['decision', 'worklog', 'note', 'task_created', 'task_completed', 'summary_generated'];

function applyTimelineFilter(events) {
  const { types, query } = state.timelineFilter;
  const q = query.trim().toLowerCase();
  return events.filter((e) => {
    if (types.size > 0 && !types.has(String(e.type || ''))) return false;
    if (q) {
      const titleLc = String(e.title || '').toLowerCase();
      const summaryLc = String(e.summary || '').toLowerCase();
      if (!titleLc.includes(q) && !summaryLc.includes(q)) return false;
    }
    return true;
  });
}

function buildTimelineDaySections(filtered) {
  const byDay = new Map();
  for (const item of filtered) {
    const dayKey = String(item.created_at || '').slice(0, 10) || 'unknown';
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(item);
  }
  return [...byDay.entries()]
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
}

function _buildTimelineChipsHtml() {
  const { types, query } = state.timelineFilter;
  const hasActiveFilter = types.size > 0 || query.trim() !== '';
  const typeCounts = {};
  for (const e of state.timelineEvents) {
    const t = String(e.type || '');
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const allCount = state.timelineEvents.length;
  const allChipActive = types.size === 0;
  const chips = [
    `<button class="chip ${allChipActive ? 'active' : ''}" data-tl-type-chip="__all__">all <span class="chip-count">${allCount}</span></button>`,
    ...TIMELINE_FILTER_TYPES.map((t) => {
      const active = types.has(t);
      const count = typeCounts[t] || 0;
      return `<button class="chip ${active ? 'active' : ''}" data-tl-type-chip="${escapeHtml(t)}">${escapeHtml(t.replaceAll('_', ' '))} <span class="chip-count">${count}</span></button>`;
    }),
  ].join('');
  const clearBtnHtml = hasActiveFilter ? `<button class="chip chip-clear" id="tl-clear-btn">Clear</button>` : '';
  return chips + clearBtnHtml;
}

function _buildTimelineEventsHtml() {
  if (state.timelineEvents.length === 0) return '<div class="empty">No events yet.</div>';
  const filtered = applyTimelineFilter(state.timelineEvents);
  if (filtered.length === 0) {
    return `<div class="empty">No events match your filters. <button class="link-btn" id="tl-empty-clear-btn">Clear filters</button></div>`;
  }
  return buildTimelineDaySections(filtered);
}

function renderTimeline() {
  const { query } = state.timelineFilter;
  const controlsBar = `
    <div class="timeline-controls">
      <div class="timeline-chips">${_buildTimelineChipsHtml()}</div>
      <input type="search" id="timeline-search" class="input timeline-search-input" placeholder="Search timeline\u2026" value="${escapeHtml(query)}" />
    </div>
  `;
  const loadMoreHtml = state.timelineHasMore
    ? `<div class="timeline-load-more"><button class="button secondary" id="tl-load-more-btn">Load more</button></div>`
    : '';
  return `
    <div class="timeline-shell">
      <section class="card">
        <h3>Timeline</h3>
        <div class="kv muted">Scroll through the full project history in recorded order.</div>
        ${controlsBar}
        <div class="timeline-scroll" id="timeline-scroll">${_buildTimelineEventsHtml()}${loadMoreHtml}</div>
      </section>
    </div>
  `;
}

function attachTimelineHandlers() {
  document.querySelectorAll('[data-tl-type-chip]').forEach((el) => {
    el.addEventListener('click', () => {
      const chip = el.getAttribute('data-tl-type-chip');
      if (chip === '__all__') {
        state.timelineFilter.types.clear();
      } else if (state.timelineFilter.types.has(chip)) {
        state.timelineFilter.types.delete(chip);
      } else {
        state.timelineFilter.types.add(chip);
      }
      _rerenderTimeline();
    });
  });

  const searchEl = document.getElementById('timeline-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.timelineFilter.query = searchEl.value;
      _rerenderTimeline();
    });
  }

  const clearBtn = document.getElementById('tl-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', _clearTimelineFilter);
  const emptyClearBtn = document.getElementById('tl-empty-clear-btn');
  if (emptyClearBtn) emptyClearBtn.addEventListener('click', _clearTimelineFilter);

  const loadMoreBtn = document.getElementById('tl-load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Loading\u2026';
      try {
        const resp = await fetch(`/api/timeline?offset=${state.timelineNextOffset}&limit=50`);
        if (!resp.ok) throw new Error('Failed to load more events');
        const data = await resp.json();
        // Backward-compat: server may return bare array or { events, hasMore, nextOffset }
        const newEvents = Array.isArray(data) ? data : (data.events || []);
        const hasMore = Array.isArray(data) ? false : Boolean(data.hasMore);
        const nextOffset = Array.isArray(data)
          ? state.timelineNextOffset + newEvents.length
          : (data.nextOffset || state.timelineNextOffset + newEvents.length);
        state.timelineEvents = state.timelineEvents.concat(newEvents);
        state.timelineHasMore = hasMore;
        state.timelineNextOffset = nextOffset;
        _rerenderTimeline();
      } catch (err) {
        showToast({ type: 'error', title: 'Could not load more events', message: err.message });
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load more';
      }
    });
  }
}

function _clearTimelineFilter() {
  state.timelineFilter.types.clear();
  state.timelineFilter.query = '';
  _rerenderTimeline();
}

function _rerenderTimeline() {
  const shell = document.querySelector('.timeline-shell .card');
  if (!shell) return;

  // Update chips area in-place
  const chipsEl = shell.querySelector('.timeline-chips');
  if (chipsEl) chipsEl.innerHTML = _buildTimelineChipsHtml();

  // Sync search value only when not focused, to avoid disrupting typing
  const searchEl = shell.querySelector('#timeline-search');
  if (searchEl && document.activeElement !== searchEl) searchEl.value = state.timelineFilter.query;

  // Update scroll area
  const scrollEl = document.getElementById('timeline-scroll');
  if (scrollEl) {
    const loadMoreHtml = state.timelineHasMore
      ? `<div class="timeline-load-more"><button class="button secondary" id="tl-load-more-btn">Load more</button></div>`
      : '';
    scrollEl.innerHTML = _buildTimelineEventsHtml() + loadMoreHtml;
  }

  attachTimelineHandlers();
}

// ── Minimal, safe markdown renderer ──────────────────────────────────────────
// Security: escapeHtml runs first, then markdown tokens are transformed on the
// already-escaped string, so no injected HTML can survive.
function renderMarkdown(md) {
  if (!md || !md.trim()) return '';

  // 1. Escape HTML entities first — critical XSS guard
  const s = escapeHtml(md);

  // 2. Process block-level elements line by line
  const lines = s.split('\n');
  const outputLines = [];
  let inList = false;

  function closeList() {
    if (inList) { outputLines.push('</ul>'); inList = false; }
  }

  function applyInline(text) {
    // **bold**
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // `inline code`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
  }

  for (const line of lines) {
    // Headers: # ## ###
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1].length; // 1→h3, 2→h4, 3→h5
      const tag = `h${level + 2}`;
      outputLines.push(`<${tag}>${applyInline(h[2])}</${tag}>`);
      continue;
    }

    // List item
    const li = line.match(/^-\s+(.*)/);
    if (li) {
      if (!inList) { outputLines.push('<ul>'); inList = true; }
      outputLines.push(`<li>${applyInline(li[1])}</li>`);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      closeList();
      outputLines.push(''); // paragraph separator
      continue;
    }

    // Regular line — will be grouped into <p>
    closeList();
    outputLines.push(applyInline(line));
  }
  closeList();

  // 3. Group non-blank, non-block lines into <p> with <br/> for line breaks
  const result = [];
  let para = [];

  function flushPara() {
    if (para.length) {
      result.push(`<p>${para.join('<br/>')}</p>`);
      para = [];
    }
  }

  for (const line of outputLines) {
    if (line.startsWith('<h') || line.startsWith('<ul') || line.startsWith('<li') || line.startsWith('</ul')) {
      flushPara();
      result.push(line);
    } else if (line === '') {
      flushPara();
    } else {
      para.push(line);
    }
  }
  flushPara();

  return result.join('\n');
}

// ── Preference helpers ────────────────────────────────────────────────────────
function getNestedPref(obj, dotKey) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = dotKey.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setNestedPref(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getOtherPrefs(obj) {
  // Return top-level keys not in the known schema (runner, ui)
  const knownTopLevel = new Set(['runner', 'ui']);
  const result = {};
  for (const key of Object.keys(obj ?? {})) {
    if (!knownTopLevel.has(key)) result[key] = obj[key];
  }
  return result;
}

function renderPreferencesFormTab(data) {
  const prefs = data ?? {};
  const defaultRunner = getNestedPref(prefs, 'runner.defaultRunner') ?? '';
  const agentRoleDefault = getNestedPref(prefs, 'runner.agentRoleDefault') ?? '';
  const uiPort = getNestedPref(prefs, 'ui.port') ?? '';
  const others = getOtherPrefs(prefs);
  const otherKeys = Object.keys(others);

  const otherSection = otherKeys.length > 0
    ? `<div class="prefs-other">
        <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:0.2px;margin-bottom:6px;">Other preferences (read-only)</div>
        ${otherKeys.map((k) => `<div class="prefs-other-row"><span class="prefs-other-key">${escapeHtml(k)}</span><pre class="prefs-other-val">${escapeHtml(JSON.stringify(others[k], null, 2))}</pre></div>`).join('')}
      </div>`
    : '';

  return `
    <div class="prefs-form" id="prefs-form">
      <div class="prefs-field">
        <label class="prefs-label" for="pref-default-runner">Default runner</label>
        <select id="pref-default-runner" class="select" name="runner.defaultRunner">
          <option value="" ${!defaultRunner ? 'selected' : ''}>— unset —</option>
          <option value="codex" ${defaultRunner === 'codex' ? 'selected' : ''}>codex</option>
          <option value="claude" ${defaultRunner === 'claude' ? 'selected' : ''}>claude</option>
        </select>
      </div>
      <div class="prefs-field">
        <label class="prefs-label" for="pref-agent-role">Default agent role</label>
        <input id="pref-agent-role" class="input" type="text" name="runner.agentRoleDefault" value="${escapeHtml(String(agentRoleDefault))}" placeholder="e.g. builder-app" />
      </div>
      <div class="prefs-field">
        <label class="prefs-label" for="pref-ui-port">UI port</label>
        <input id="pref-ui-port" class="input" type="number" name="ui.port" value="${escapeHtml(String(uiPort))}" placeholder="e.g. 4310" min="1024" max="65535" step="1" />
        <small class="prefs-hint">Valid range: 1024–65535 (ports below 1024 require root).</small>
      </div>
      ${otherSection}
    </div>
  `;
}

function renderPreferencesJsonTab(data) {
  const prefsText = JSON.stringify(data ?? {}, null, 2);
  return `<textarea id="preferences-editor" class="textarea" style="min-height:200px;">${escapeHtml(prefsText)}</textarea>`;
}

function renderPreferences(data, summary) {
  if (!state.preferencesTab) state.preferencesTab = 'form';
  const tab = state.preferencesTab;
  const mdHtml = (summary?.markdown || '').trim()
    ? renderMarkdown(summary.markdown)
    : '<span class="muted">No summary yet. Click <strong>Refresh summary</strong> to generate one.</span>';

  return `
    <div class="grid">
      <article class="card">
        <h3>Preferences</h3>
        <div class="tab-row">
          <button class="tab-btn ${tab === 'form' ? 'active' : ''}" data-prefs-tab="form" type="button">Form</button>
          <button class="tab-btn ${tab === 'json' ? 'active' : ''}" data-prefs-tab="json" type="button">JSON</button>
        </div>
        <div id="prefs-tab-body">
          ${tab === 'form' ? renderPreferencesFormTab(data) : renderPreferencesJsonTab(data)}
        </div>
        <div class="row">
          <button id="preferences-save" class="button" type="button">Save preferences</button>
          <button id="preferences-reload" class="button secondary" type="button">Reload</button>
        </div>
      </article>
      <article class="card">
        <div class="card-head-row">
          <h3 style="margin:0;">Summary.md</h3>
          <button id="summary-refresh-btn" class="button mini" type="button">Refresh summary</button>
        </div>
        <div class="summary-markdown">${mdHtml}</div>
      </article>
    </div>
  `;
}

function invalidateGlobalData() {
  state.cache.overview = null;
  state.cache.timeline = null;
  state.cache.tasks = null;
  state.timelineEvents = [];
  state.timelineHasMore = false;
  state.timelineNextOffset = 0;
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
      showToast({ type: 'error', title: 'Could not add note', message: err.message });
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
      showToast({ type: 'error', title: 'Could not add task', message: err.message });
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
      showToast({ type: 'error', title: 'Could not add decision', message: err.message });
    }
  });
}

async function renderMissionView(isPolling = false) {
  const mission = await load('mission', `/api/mission?status=${encodeURIComponent(state.missionStatus)}`, true);
  const taskIds = new Set((mission.tasks ?? []).map((t) => t.task_id));

  // Goal 7: auto-select first task only on initial load, not polling
  if (!state.selectedTaskId && mission.tasks?.length) {
    state.selectedTaskId = mission.tasks[0].task_id;
  } else if (state.selectedTaskId && !taskIds.has(state.selectedTaskId)) {
    // Selection no longer visible in filtered list — clear it
    state.selectedTaskId = null;
    state.selectedRunId = null;
    state.cache.taskDetail = null;
    state.cache.runDetail = null;
  }

  const taskDetail = state.selectedTaskId
    ? await load('taskDetail', `/api/task-packets/${encodeURIComponent(state.selectedTaskId)}`, true)
    : null;
  if (!state.selectedRunId && taskDetail?.latest_run?.run_id) state.selectedRunId = taskDetail.latest_run.run_id;
  let runDetail = null;
  let runPrompt = null;
  let runLog = null;
  if (state.selectedRunId) {
    const rid = encodeURIComponent(state.selectedRunId);
    const [rd, rp, rl] = await Promise.all([
      fetch(`/api/runs/${rid}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/runs/${rid}/prompt`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/runs/${rid}/log`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    runDetail = rd;
    runPrompt = rp;
    runLog = rl;
    state.cache.runDetail = rd;
  }

  const reviewSummary = await load('reviewSummary', '/api/run-summary', true);
  content.innerHTML = renderMission(mission, taskDetail, runDetail, reviewSummary, runPrompt, runLog);
  attachMissionHandlers();
  // Start polling after initial render (not during polling ticks)
  if (!isPolling) startMissionPolling();
}

// ── Triage view ──────────────────────────────────────────────────────────────
// Queue-of-runs-in-review stream. Default view. Keyboard: j/k navigate,
// a approve, b block, r replay, d defer (skip to next), ? cheatsheet.

async function loadTriageRuns() {
  const res = await fetch('/api/runs');
  if (!res.ok) throw new Error('Failed to load runs');
  const all = await res.json();
  // Triage unit = runs that need a human decision: completed-but-unreviewed, or blocked.
  const runs = (Array.isArray(all) ? all : []).filter((r) => {
    if (r.status === 'blocked') return true;
    if (r.status === 'completed' && (r.review_state ?? 'pending') === 'pending') return true;
    return false;
  });
  runs.sort((a, b) => String(b.completed_at || b.started_at || '').localeCompare(String(a.completed_at || a.started_at || '')));
  state.triageRuns = runs;
  // If a run id was deep-linked via URL, find its position in the filtered list
  // so triageIndex + selected row line up with the hash.
  if (state.selectedRunId) {
    const pinned = runs.findIndex((r) => r.run_id === state.selectedRunId);
    if (pinned >= 0) state.triageIndex = pinned;
  }
  if (state.triageIndex >= runs.length) state.triageIndex = Math.max(0, runs.length - 1);
  if (runs.length > 0) state.selectedRunId = runs[state.triageIndex].run_id;
  else state.selectedRunId = null;
  return runs;
}

function renderTriageEmpty() {
  return `
    <section class="mission-section">
      <h2>Triage</h2>
      <div class="empty">
        <p>No runs awaiting review.</p>
        <p class="muted">Runs appear here when a runner finishes and needs approve / block / replay / defer.</p>
      </div>
    </section>
  `;
}

function renderTriageRunRow(run, index) {
  const active = index === state.triageIndex;
  const when = run.completed_at || run.started_at || '';
  const validation = Array.isArray(run.validation) ? run.validation : [];
  const failures = validation.filter((v) => !v.ok && !v.timed_out).length;
  const timeouts = validation.filter((v) => v.timed_out).length;
  const okCount = validation.filter((v) => v.ok).length;
  const pill =
    failures > 0
      ? `<span class="validation-status-fail">${failures} failed</span>`
      : timeouts > 0
        ? `<span class="validation-status-timeout">${timeouts} timed-out</span>`
        : validation.length > 0
          ? `<span class="validation-status-ok">${okCount} ok</span>`
          : '<span class="muted">no validation</span>';
  return `
    <li class="triage-row${active ? ' active' : ''}" data-triage-index="${index}" data-run-id="${escapeHtml(run.run_id)}">
      <div class="triage-row-head">
        <strong>${escapeHtml(run.run_id)}</strong>
        <span class="muted">${escapeHtml(run.task_id || '')}</span>
        <span class="muted">${escapeHtml(run.runner || '')}</span>
        <span class="muted">${escapeHtml(run.agent_role || '')}</span>
      </div>
      <div class="triage-row-meta">
        ${pill}
        <span class="muted">${escapeHtml(when ? fmt(when) : '')}</span>
      </div>
    </li>
  `;
}

function renderTriageDetail(run) {
  if (!run) return '<div class="muted">Select a run to view details.</div>';
  const validation = Array.isArray(run.validation) ? run.validation : [];
  const validationHtml = validation.length
    ? `<ul class="validation-list">${validation
        .map((v) => {
          const kind = String(v.kind || 'custom').toLowerCase();
          const kindClass = ['typecheck', 'lint', 'test', 'build', 'custom'].includes(kind) ? kind : 'custom';
          const statusClass = v.timed_out
            ? 'validation-status-timeout'
            : v.ok
              ? 'validation-status-ok'
              : 'validation-status-fail';
          const statusText = v.timed_out ? 'timed-out' : v.ok ? 'ok' : 'failed';
          const dur = Number.isFinite(v.duration_ms) ? `${(v.duration_ms / 1000).toFixed(1)}s` : '';
          const name = v.name ? ` <span class="muted">${escapeHtml(v.name)}</span>` : '';
          return `<li class="validation-row">
            <span class="validation-kind validation-kind-${kindClass}">${escapeHtml(kind)}</span>${name}
            <span class="${statusClass}">${statusText}</span>
            ${dur ? `<span class="muted">${escapeHtml(dur)}</span>` : ''}
            <code>${escapeHtml(v.command || '')}</code>
          </li>`;
        })
        .join('')}</ul>`
    : '<div class="muted">No validation results captured.</div>';
  const changed = (run.changed_files || []).map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('');
  const blockers = (run.blockers || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  return `
    <div class="triage-detail">
      <div class="triage-action-bar">
        <button class="button" data-triage-action="approve" data-run-id="${escapeHtml(run.run_id)}" title="Approve (a)"><kbd>a</kbd> Approve</button>
        <button class="button secondary" data-triage-action="block" data-run-id="${escapeHtml(run.run_id)}" title="Block (b)"><kbd>b</kbd> Block</button>
        <button class="button secondary" data-triage-action="replay" data-run-id="${escapeHtml(run.run_id)}" title="Replay (r)"><kbd>r</kbd> Replay</button>
        <button class="button secondary" data-triage-action="defer" data-run-id="${escapeHtml(run.run_id)}" title="Defer — skip to next (d)"><kbd>d</kbd> Defer</button>
      </div>
      <div class="kv"><strong>Task:</strong> ${escapeHtml(run.task_id || '')}</div>
      <div class="kv"><strong>Runner:</strong> ${escapeHtml(run.runner || '')} · <strong>Role:</strong> ${escapeHtml(run.agent_role || '')}</div>
      <div class="kv"><strong>Started:</strong> ${escapeHtml(fmt(run.started_at || ''))} · <strong>Completed:</strong> ${escapeHtml(fmt(run.completed_at || ''))}</div>
      <h4>Validation</h4>
      ${validationHtml}
      ${blockers ? `<h4>Blockers</h4><ul>${blockers}</ul>` : ''}
      <h4>Changed files (${(run.changed_files || []).length})</h4>
      <ul class="triage-files">${changed || '<li class="muted">none</li>'}</ul>
    </div>
  `;
}

async function renderTriageView() {
  writeLocationHash();
  try {
    const runs = await loadTriageRuns();
    if (runs.length === 0) {
      content.innerHTML = renderTriageEmpty();
      return;
    }
    const selected = runs[state.triageIndex] ?? runs[0];
    content.innerHTML = `
      <div class="triage-layout">
        <section class="triage-list-pane">
          <div class="triage-header">
            <h2>Triage <span class="muted">(${runs.length} awaiting review)</span></h2>
            <div class="muted small"><kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>a</kbd> approve · <kbd>b</kbd> block · <kbd>r</kbd> replay · <kbd>d</kbd> defer</div>
          </div>
          <ul class="triage-list">
            ${runs.map((run, i) => renderTriageRunRow(run, i)).join('')}
          </ul>
        </section>
        <section class="triage-detail-pane">
          ${renderTriageDetail(selected)}
        </section>
      </div>
    `;
    attachTriageHandlers();
  } catch (err) {
    content.innerHTML = `<div class="empty">Failed to load triage: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

function attachTriageHandlers() {
  document.querySelectorAll('[data-triage-index]').forEach((el) => {
    el.addEventListener('click', async () => {
      const idx = Number.parseInt(el.getAttribute('data-triage-index') || '0', 10);
      state.triageIndex = idx;
      state.selectedRunId = state.triageRuns[idx]?.run_id ?? null;
      await renderTriageView();
    });
  });
  document.querySelectorAll('[data-triage-action]').forEach((el) => {
    el.addEventListener('click', async () => {
      const action = el.getAttribute('data-triage-action');
      const runId = el.getAttribute('data-run-id');
      if (!runId || !action) return;
      await performTriageAction(action, runId);
    });
  });
}

async function performTriageAction(action, runId) {
  try {
    if (action === 'approve') {
      await postJson('/api/run/approve', { run_id: runId, state: 'approved' });
      showToast({ type: 'success', title: 'Approved', message: runId });
    } else if (action === 'block') {
      await postJson('/api/run/block', { run_id: runId });
      showToast({ type: 'success', title: 'Blocked', message: runId });
    } else if (action === 'replay') {
      const res = await postJson('/api/run/replay', { run_id: runId });
      const newId = res?.data?.run_id;
      showToast({ type: 'success', title: 'Replay queued', message: newId ? `${runId} → ${newId}` : runId });
    } else if (action === 'defer') {
      // Skip to next without mutating run state.
      if (state.triageIndex < state.triageRuns.length - 1) state.triageIndex += 1;
      await renderTriageView();
      return;
    } else {
      return;
    }
    // After approve/block/replay the run leaves `review`. Reload and stay at same index (next run slides up).
    await renderTriageView();
  } catch (err) {
    showToast({ type: 'error', title: 'Action failed', message: err?.message || String(err) });
  }
}

// Triage keyboard shortcuts (outside of text inputs).
window.addEventListener('keydown', (e) => {
  if (state.view !== 'triage') return;
  const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const runs = state.triageRuns;
  const current = runs[state.triageIndex];
  if (e.key === 'j' || e.key === 'ArrowDown') {
    if (runs.length === 0) return;
    e.preventDefault();
    state.triageIndex = Math.min(runs.length - 1, state.triageIndex + 1);
    state.selectedRunId = runs[state.triageIndex]?.run_id ?? null;
    renderTriageView();
    return;
  }
  if (e.key === 'k' || e.key === 'ArrowUp') {
    if (runs.length === 0) return;
    e.preventDefault();
    state.triageIndex = Math.max(0, state.triageIndex - 1);
    state.selectedRunId = runs[state.triageIndex]?.run_id ?? null;
    renderTriageView();
    return;
  }
  if (!current) return;
  if (e.key === 'a') { e.preventDefault(); performTriageAction('approve', current.run_id); return; }
  if (e.key === 'b') { e.preventDefault(); performTriageAction('block', current.run_id); return; }
  if (e.key === 'r') { e.preventDefault(); performTriageAction('replay', current.run_id); return; }
  if (e.key === 'd') { e.preventDefault(); performTriageAction('defer', current.run_id); return; }
});

// ── URL-backed selection (hash routing) ───────────────────────────────────────
// Hash shapes:
//   #/triage                  or  #/triage/R-022
//   #/mission                 or  #/mission/T-004         or  #/mission/T-004/R-018
//   #/mission?status=review   (mission status filter piggybacks on mission view)
//   #/overview  #/timeline  #/preferences
//
// render() writes the hash after every state mutation; hashchange events
// reapply hash → state (so back/forward and pasted links work).

let _ignoreHashChange = false;

function parseLocationHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').trim();
  if (!raw) return { view: 'triage' };
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const view = segments[0];
  const query = new URLSearchParams(queryPart || '');
  if (view === 'mission') {
    const taskId = segments[1] && /^T-\d+$/i.test(segments[1]) ? segments[1].toUpperCase() : null;
    const runId = segments[2] && /^R-\d+$/i.test(segments[2]) ? segments[2].toUpperCase() : null;
    return { view, taskId, runId, missionStatus: query.get('status') || null };
  }
  if (view === 'triage') {
    const runId = segments[1] && /^R-\d+$/i.test(segments[1]) ? segments[1].toUpperCase() : null;
    return { view, runId };
  }
  if (view === 'overview' || view === 'timeline' || view === 'preferences') return { view };
  return { view: 'triage' };
}

function buildLocationHash() {
  if (state.view === 'triage') {
    return state.selectedRunId ? `#/triage/${state.selectedRunId}` : '#/triage';
  }
  if (state.view === 'mission') {
    const parts = ['mission'];
    if (state.selectedTaskId) parts.push(state.selectedTaskId);
    if (state.selectedTaskId && state.selectedRunId) parts.push(state.selectedRunId);
    const query = state.missionStatus && state.missionStatus !== 'all'
      ? `?status=${encodeURIComponent(state.missionStatus)}`
      : '';
    return `#/${parts.join('/')}${query}`;
  }
  return `#/${state.view}`;
}

function writeLocationHash() {
  const next = buildLocationHash();
  if (location.hash === next) return;
  _ignoreHashChange = true;
  history.replaceState(null, '', next);
  setTimeout(() => { _ignoreHashChange = false; }, 0);
}

function applyLocationHash() {
  const parsed = parseLocationHash();
  const previousView = state.view;
  state.view = parsed.view;
  if (parsed.view === 'triage') {
    // null means "no deep-link" — keep whatever run is currently selected.
    if (parsed.runId) state.selectedRunId = parsed.runId;
  } else if (parsed.view === 'mission') {
    if (parsed.taskId) state.selectedTaskId = parsed.taskId;
    if (parsed.runId) state.selectedRunId = parsed.runId;
    state.missionStatus = parsed.missionStatus || 'all';
  }
  if (previousView !== state.view) {
    if (previousView === 'mission') stopMissionPolling();
    navButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-view') === state.view));
  }
}

window.addEventListener('hashchange', async () => {
  if (_ignoreHashChange) return;
  applyLocationHash();
  await render();
});

async function render() {
  writeLocationHash();
  content.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (state.view === 'triage') {
      await renderTriageView();
      return;
    }
    if (state.view === 'mission') {
      await renderMissionView();
      return;
    }
    if (state.view === 'overview') {
      content.innerHTML = renderOverview(await load('overview', '/api/overview'));
      attachOverviewCTAs();
      return;
    }
    if (state.view === 'timeline') {
      // Only fetch initial page if we don't have data yet
      if (state.timelineEvents.length === 0) {
        const raw = await fetch('/api/timeline?offset=0&limit=50');
        if (!raw.ok) throw new Error('Failed to load timeline');
        const data = await raw.json();
        // Backward-compat: handle both bare array and { events, hasMore, nextOffset }
        state.timelineEvents = Array.isArray(data) ? data : (data.events || []);
        state.timelineHasMore = Array.isArray(data) ? false : Boolean(data.hasMore);
        state.timelineNextOffset = Array.isArray(data)
          ? state.timelineEvents.length
          : (data.nextOffset || state.timelineEvents.length);
      }
      content.innerHTML = renderTimeline();
      attachTimelineHandlers();
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

// ── Theme toggle ──────────────────────────────────────────────────────────────
const themeToggleBtn = document.getElementById('theme-toggle');
if (themeToggleBtn) {
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sidecar.theme', theme);
    themeToggleBtn.textContent = theme === 'light' ? '☀' : '🌙';
    themeToggleBtn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }
  // Sync button label to current theme
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(currentTheme);

  themeToggleBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
}

function attachMissionHandlers() {
  // Filter chip clicks
  document.querySelectorAll('[data-status]').forEach((el) => {
    el.addEventListener('click', async () => {
      state.missionStatus = el.getAttribute('data-status') || 'all';
      invalidateMission();
      await render();
    });
  });

  // Goal 4: row selection uses data-row-task-id (not data-task-id) to avoid collision with action buttons
  document.querySelectorAll('tbody tr[data-row-task-id]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      // Ignore clicks that originated from buttons inside the row
      if (event.target.closest('button')) return;
      const taskId = el.getAttribute('data-row-task-id');
      state.selectedTaskId = taskId;
      // Auto-pair: select this task's latest run (if any) alongside the task
      const missionTasks = state.cache.mission?.tasks ?? [];
      const taskRow = missionTasks.find((t) => t.task_id === taskId);
      state.selectedRunId = taskRow?.latest_run_id ?? null;
      state.cache.taskDetail = null;
      state.cache.runDetail = null;
      await render();
    });
  });

  // Lineage links in run detail (parent/children) — select that run
  document.querySelectorAll('[data-run-link]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const runId = el.getAttribute('data-run-link');
      if (!runId) return;
      state.selectedRunId = runId;
      state.cache.runDetail = null;
      await render();
    });
  });

  // Run id link buttons (in Run column only — NOT action buttons) — select run, keep task selected
  document.querySelectorAll('tbody .link-btn[data-run-id]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.stopPropagation();
      const runId = el.getAttribute('data-run-id');
      state.selectedRunId = runId;
      // Auto-pair: if we can find a task that owns this run, select it too.
      const missionTasks = state.cache.mission?.tasks ?? [];
      const owningTask = missionTasks.find((t) => t.latest_run_id === runId);
      if (owningTask) {
        if (state.selectedTaskId !== owningTask.task_id) {
          state.selectedTaskId = owningTask.task_id;
          state.cache.taskDetail = null;
        }
      }
      state.cache.runDetail = null;
      await render();
    });
  });

  // Action buttons (compile / run / view-run) — use data-action-task-id
  document.querySelectorAll('[data-task-action]').forEach((el) => {
    el.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = el.getAttribute('data-task-action');
      const taskId = el.getAttribute('data-action-task-id');
      const runId = el.getAttribute('data-run-id');
      try {
        if (action === 'view-run' && runId) {
          // Select run and auto-pair to its owning task if found
          state.selectedRunId = runId;
          const missionTasks = state.cache.mission?.tasks ?? [];
          const owningTask = missionTasks.find((t) => t.latest_run_id === runId);
          if (owningTask && state.selectedTaskId !== owningTask.task_id) {
            state.selectedTaskId = owningTask.task_id;
            state.cache.taskDetail = null;
          }
        } else if (action === 'compile' && taskId) {
          const detail = await load('taskDetail', `/api/task-packets/${encodeURIComponent(taskId)}`, true);
          const task = detail?.task || {};
          const res = await postJson('/api/prompt/compile', {
            task_id: taskId,
            runner: task?.tracking?.assigned_runner || 'codex',
            agent_role: task?.tracking?.assigned_agent_role || 'builder-app',
          });
          showToast({ type: 'success', title: 'Prompt compiled', message: res?.data?.prompt_path || '' });
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
        showToast({ type: 'error', title: 'Task action failed', message: err.message });
      }
    });
  });

  // Run review action buttons
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
          showToast({ type: 'success', title: 'Follow-up task created', message: res?.data?.task_id ? '#' + res.data.task_id : '' });
        }
        invalidateMission();
        state.cache.reviewSummary = null;
        await render();
      } catch (err) {
        showToast({ type: 'error', title: 'Run action failed', message: err.message });
      }
    });
  });

  // Goal 2: Refresh button
  const refreshBtn = document.getElementById('mission-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => _pollMissionRefresh());
  }

  // Goal 2: Pause/Resume toggle
  const pollToggle = document.getElementById('mission-poll-toggle');
  if (pollToggle) {
    pollToggle.addEventListener('click', async () => {
      _pollPaused = !_pollPaused;
      if (_pollPaused) {
        stopMissionPolling();
      } else {
        startMissionPolling();
      }
      // Re-render to update button label
      invalidateMission();
      await render();
    });
  }

  // Goal 6: "Create your first task" CTA in empty state
  const createFirstTask = document.getElementById('mission-create-first-task');
  if (createFirstTask) createFirstTask.addEventListener('click', openTaskModal);

  // Goal 6: "Clear filter" CTA
  const clearFilter = document.getElementById('mission-clear-filter');
  if (clearFilter) {
    clearFilter.addEventListener('click', async () => {
      state.missionStatus = 'all';
      invalidateMission();
      await render();
    });
  }
}

function attachPreferencesMutations() {
  const save = document.getElementById('preferences-save');
  const reload = document.getElementById('preferences-reload');
  const summaryRefreshBtn = document.getElementById('summary-refresh-btn');

  // ── Tab switching ────────────────────────────────────────────────────────
  document.querySelectorAll('[data-prefs-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-prefs-tab');
      if (!tab || tab === state.preferencesTab) return;
      state.preferencesTab = tab;
      const body = document.getElementById('prefs-tab-body');
      if (body) body.innerHTML = tab === 'form'
        ? renderPreferencesFormTab(state.cache.preferences)
        : renderPreferencesJsonTab(state.cache.preferences);
      document.querySelectorAll('[data-prefs-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // ── Save ─────────────────────────────────────────────────────────────────
  if (save) {
    save.addEventListener('click', async () => {
      try {
        let payload;
        if (state.preferencesTab === 'json') {
          const editor = document.getElementById('preferences-editor');
          if (!editor) return;
          try {
            payload = JSON.parse(editor.value || '{}');
          } catch (parseErr) {
            showToast({ type: 'error', title: 'Invalid JSON', message: parseErr.message });
            return;
          }
        } else {
          // Form tab: merge form values into current cached prefs (preserves unknown keys)
          payload = JSON.parse(JSON.stringify(state.cache.preferences ?? {}));
          const runner = document.getElementById('pref-default-runner')?.value ?? '';
          const agentRole = document.getElementById('pref-agent-role')?.value ?? '';
          const uiPort = document.getElementById('pref-ui-port')?.value ?? '';

          if (runner) setNestedPref(payload, 'runner.defaultRunner', runner);
          else {
            // Remove key if unset
            if (payload.runner) delete payload.runner.defaultRunner;
          }
          if (agentRole) setNestedPref(payload, 'runner.agentRoleDefault', agentRole);
          else if (payload.runner) delete payload.runner.agentRoleDefault;

          if (uiPort !== '') {
            const portNum = Number(uiPort);
            if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
              showToast({
                type: 'error',
                title: 'Invalid UI port',
                message: 'Port must be an integer between 1024 and 65535.',
              });
              return;
            }
            setNestedPref(payload, 'ui.port', portNum);
          } else if (payload.ui) {
            delete payload.ui.port;
          }
        }
        await putJson('/api/preferences', payload);
        state.cache.preferences = payload;
        showToast({ type: 'success', title: 'Preferences saved' });
      } catch (err) {
        showToast({ type: 'error', title: 'Could not save preferences', message: err.message });
      }
    });
  }

  // ── Reload ───────────────────────────────────────────────────────────────
  if (reload) {
    reload.addEventListener('click', async () => {
      try {
        state.cache.preferences = null;
        const prefs = await load('preferences', '/api/preferences', true);
        const body = document.getElementById('prefs-tab-body');
        if (body) body.innerHTML = state.preferencesTab === 'form'
          ? renderPreferencesFormTab(prefs)
          : renderPreferencesJsonTab(prefs);
      } catch (err) {
        showToast({ type: 'error', title: 'Could not reload preferences', message: err.message });
      }
    });
  }

  // ── Summary refresh ──────────────────────────────────────────────────────
  if (summaryRefreshBtn) {
    summaryRefreshBtn.addEventListener('click', async () => {
      summaryRefreshBtn.disabled = true;
      summaryRefreshBtn.textContent = 'Refreshing…';
      try {
        const res = await fetch('/api/summary/refresh', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Refresh failed');
        state.cache.summary = { markdown: data.markdown };
        showToast({ type: 'success', title: 'Summary refreshed' });
        // Re-render just the summary pane
        const mdDiv = document.querySelector('.summary-markdown');
        if (mdDiv) {
          mdDiv.innerHTML = (data.markdown || '').trim()
            ? renderMarkdown(data.markdown)
            : '<span class="muted">No summary yet. Click <strong>Refresh summary</strong> to generate one.</span>';
        }
      } catch (err) {
        showToast({ type: 'error', title: 'Could not refresh summary', message: err.message });
      } finally {
        summaryRefreshBtn.disabled = false;
        summaryRefreshBtn.textContent = 'Refresh summary';
      }
    });
  }
}

applyLocationHash();
render();
