const state = {
  view: 'overview',
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
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function load(key, endpoint) {
  if (state.cache[key]) return state.cache[key];
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Failed to load ${key}`);
  const data = await res.json();
  state.cache[key] = data;
  return data;
}

function renderOverview(data) {
  if (!data?.project) {
    return '<div class="empty">No project data found in this Sidecar database.</div>';
  }

  const list = (rows, renderRow) =>
    rows?.length ? `<ul class="list">${rows.map(renderRow).join('')}</ul>` : '<div class="empty">No items yet.</div>';

  return `
    <div class="grid">
      <article class="card">
        <h3>Project</h3>
        <div class="kv"><strong>${escapeHtml(data.project.name)}</strong></div>
        <div class="kv muted">${escapeHtml(data.project.root_path)}</div>
        <div class="kv">Active session: ${data.activeSession ? `#${data.activeSession.id} (${data.activeSession.actor_type}${data.activeSession.actor_name ? `: ${escapeHtml(data.activeSession.actor_name)}` : ''})` : 'none'}</div>
      </article>

      <article class="card">
        <h3>Recent Decisions</h3>
        ${list(data.recentDecisions, (r) => `<li><strong>${escapeHtml(r.title || 'Decision')}</strong><br><span class="muted">${escapeHtml(r.summary || '')}</span><br><span class="muted">${fmt(r.created_at)}</span></li>`)}
      </article>

      <article class="card">
        <h3>Recent Worklogs</h3>
        ${list(data.recentWorklogs, (r) => `<li><strong>${escapeHtml(r.title || 'Worklog')}</strong><br><span class="muted">${escapeHtml(r.summary || '')}</span><br><span class="muted">${fmt(r.created_at)}</span></li>`)}
      </article>

      <article class="card">
        <h3>Open Tasks</h3>
        ${list(data.openTasks, (t) => `<li>#${t.id} <strong>${escapeHtml(t.title)}</strong> <span class="muted">(${escapeHtml(t.priority || 'n/a')})</span></li>`)}
      </article>

      <article class="card">
        <h3>Recent Notes</h3>
        ${list(data.recentNotes, (n) => `<li><strong>${escapeHtml(n.title || 'Note')}</strong><br><span class="muted">${escapeHtml(n.summary || '')}</span><br><span class="muted">${fmt(n.created_at)}</span></li>`)}
      </article>
    </div>
  `;
}

function renderTimeline(items) {
  if (!items?.length) return '<div class="empty">No events yet.</div>';
  return `
    <table class="table">
      <thead><tr><th>Time</th><th>Type</th><th>Title</th><th>Summary</th></tr></thead>
      <tbody>
        ${items
          .map(
            (e) => `<tr><td>${fmt(e.created_at)}</td><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.title || '')}</td><td>${escapeHtml(e.summary || '')}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderTasks(items) {
  if (!items?.length) return '<div class="empty">No tasks yet.</div>';
  return `
    <table class="table">
      <thead><tr><th>ID</th><th>Status</th><th>Priority</th><th>Title</th><th>Updated</th></tr></thead>
      <tbody>
        ${items
          .map(
            (t) => `<tr><td>#${t.id}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.priority || 'n/a')}</td><td>${escapeHtml(t.title)}</td><td>${fmt(t.updated_at)}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderDecisions(items) {
  if (!items?.length) return '<div class="empty">No decisions recorded yet.</div>';
  return `
    <table class="table">
      <thead><tr><th>Time</th><th>Title</th><th>Summary</th></tr></thead>
      <tbody>
        ${items
          .map(
            (d) => `<tr><td>${fmt(d.created_at)}</td><td>${escapeHtml(d.title || '')}</td><td>${escapeHtml(d.summary || '')}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderPreferences(data, summary) {
  return `
    <div class="grid">
      <article class="card">
        <h3>Preferences</h3>
        <pre class="code">${escapeHtml(JSON.stringify(data ?? {}, null, 2))}</pre>
      </article>
      <article class="card">
        <h3>Summary.md</h3>
        <pre class="code">${escapeHtml(summary?.markdown || '')}</pre>
      </article>
    </div>
  `;
}

async function render() {
  content.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (state.view === 'overview') {
      content.innerHTML = renderOverview(await load('overview', '/api/overview'));
      return;
    }
    if (state.view === 'timeline') {
      content.innerHTML = renderTimeline(await load('timeline', '/api/timeline'));
      return;
    }
    if (state.view === 'tasks') {
      content.innerHTML = renderTasks(await load('tasks', '/api/tasks'));
      return;
    }
    if (state.view === 'decisions') {
      content.innerHTML = renderDecisions(await load('decisions', '/api/decisions'));
      return;
    }
    if (state.view === 'preferences') {
      const [preferences, summary] = await Promise.all([
        load('preferences', '/api/preferences'),
        load('summary', '/api/summary'),
      ]);
      content.innerHTML = renderPreferences(preferences, summary);
      return;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty">Failed to load view: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

render();
