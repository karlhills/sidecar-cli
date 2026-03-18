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

async function postJson(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Request failed');
  }
  return data;
}

async function putJson(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Request failed');
  }
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

      <article class="card">
        <h3>Add Note</h3>
        <form id="note-form">
          <input class="input" name="title" placeholder="Title (optional)" />
          <textarea class="textarea" name="text" placeholder="What should future you know?" required></textarea>
          <div class="row">
            <button class="button" type="submit">Add note</button>
          </div>
        </form>
      </article>

      <article class="card">
        <h3>Add Task</h3>
        <form id="task-form">
          <input class="input" name="title" placeholder="Task title" required />
          <textarea class="textarea" name="description" placeholder="Description (optional)"></textarea>
          <div class="row">
          <select class="select" name="priority">
            <option value="low">low</option>
            <option value="medium" selected>medium</option>
            <option value="high">high</option>
          </select>
          <button class="button" type="submit">Add task</button>
          </div>
        </form>
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
        <div class="help">
          Supported keys (examples):<br />
          <code>summary.format</code>: <code>"markdown" | "text" | "json"</code><br />
          <code>summary.recentLimit</code>: number of recent items for summaries<br />
          <code>output.humanTime</code>: <code>true | false</code> (friendly local timestamps in human CLI output vs raw ISO-style timestamps)
        </div>
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
      attachMutations();
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
      attachPreferencesMutations();
      return;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty">Failed to load view: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

function attachMutations() {
  const noteForm = document.getElementById('note-form');
  if (noteForm) {
    noteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(noteForm);
      try {
        await postJson('/api/notes', {
          title: form.get('title'),
          text: form.get('text'),
        });
        state.cache.overview = null;
        state.cache.timeline = null;
        await render();
      } catch (err) {
        alert(`Could not add note: ${err.message}`);
      }
    });
  }

  const taskForm = document.getElementById('task-form');
  if (taskForm) {
    taskForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(taskForm);
      try {
        await postJson('/api/tasks', {
          title: form.get('title'),
          description: form.get('description'),
          priority: form.get('priority'),
        });
        state.cache.overview = null;
        state.cache.tasks = null;
        state.cache.timeline = null;
        await render();
      } catch (err) {
        alert(`Could not add task: ${err.message}`);
      }
    });
  }
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
      const prefs = await load('preferences', '/api/preferences');
      editor.value = JSON.stringify(prefs ?? {}, null, 2);
    } catch (err) {
      alert(`Could not reload preferences: ${err.message}`);
    }
  });
}

render();
