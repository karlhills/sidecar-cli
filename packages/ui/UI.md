# Sidecar UI — Functional Reference

A local, single-project web UI for inspecting and acting on Sidecar state. It is a small Node HTTP server backed by the project's `.sidecar/sidecar.db` SQLite database plus the file-based task packets, runs, preferences, and summary. No build step, no framework — static HTML + vanilla JS modules.

## How it's served

- Entry: `packages/ui/server.js` (bin name `sidecar-ui-server`).
- Static assets in `packages/ui/public/`: `index.html`, `app.js`, `styles.css`.
- CLI invocation: `sidecar ui [--project <path>] [--port <n>]`. Default port `4310`, default project is `process.cwd()`.
- On startup it validates that `<project>/.sidecar/sidecar.db` exists; otherwise it refuses to start.
- Binds to `127.0.0.1` only.
- Server-side Sidecar actions shell out via `execFileSync('sidecar', …)` (or `node $SIDECAR_CLI_JS …` when set), with `SIDECAR_NO_BANNER=1` and `cwd` pinned to the project path. JSON-producing commands are called with `--json`.

## Information architecture

One page, one top bar, one left nav, one content region.

- **Topbar** (`index.html`): mark ("[■]─[▪] sidecar"), tagline, and action buttons:
  - Theme toggle (🌙 / ☀). Persists to `localStorage['sidecar.theme']`. A pre-paint IIFE in `app.js` sets `<html data-theme>` before first render to avoid FOUC. Styles gate on `[data-theme="light"]`.
  - Add Note, Add Task, Add Decision — each opens a modal (see "Modals").
- **Left nav** (`.nav-btn[data-view]`): four views — Mission Control (default), Overview, Timeline, Preferences.
- **Content region** (`#content`): the active view renders here. `render()` dispatches on `state.view`.
- **Skip link** (`.skip-link`) jumps to `#content` for keyboard users.

## State (client)

Held in a single `state` object in `app.js`:

- `view` — active view key.
- `missionStatus` — mission filter chip selection (`all`/`ready`/`running`/`review`/`blocked`/`done`).
- `selectedTaskId`, `selectedRunId` — currently selected task packet / run on Mission Control.
- `cache` — in-memory cache keyed by endpoint logical name (overview/timeline/tasks/mission/taskDetail/runDetail/reviewSummary/preferences/summary). `invalidateMission()` and `invalidateGlobalData()` selectively clear entries.
- `timelineEvents`, `timelineHasMore`, `timelineNextOffset` — accumulated timeline pages.
- `timelineFilter` — `{ types: Set<string>, query: string }` for timeline chips + search.
- `preferencesTab` — `'form'` or `'json'`.

Two helpers wrap fetch: `load(key, endpoint, force)` (GET with cache) and `postJson`/`putJson` (throw on non-2xx).

## Mission Control (`view = 'mission'`)

The primary operational board. Three stacked sections:

1. **Review Summary card** — four stats from `GET /api/run-summary`: Completed Runs, Blocked Runs, Suggested Follow-ups, Recently Merged (length of list). Endpoint falls back to zeroes if `sidecar run summary --json` isn't available.
2. **Mission Board card**
   - Header has a chip filter row — `all / ready / running / review / blocked / done` — each chip displays a count from `mission.counts` (or `counts.total` for "all"). Active chip has `.active` and `aria-pressed="true"`.
   - Poll controls: Refresh button (`#mission-refresh-btn`, with a spinning `⟲` glyph on refresh) and Pause/Resume toggle (`#mission-poll-toggle`). Auto-refresh polls `GET /api/mission` every 15s, scoped to this view, paused when the tab is hidden (`document.visibilityState`) or when manually paused. Polling failures are silent (no toast).
   - Table columns: Task (id + title), Status (badge), Role (assigned agent role), Runner (`codex`/`claude`/`n/a`), Run (clickable `link-btn` with run id, `.selected` when active), Updated (local `YYYY-MM-DD HH:mm`), Actions.
   - Actions per row: **⟫ Compile prompt** (`POST /api/prompt/compile`), **▶ Run task** (`POST /api/run/start`), **↗ View latest run** (selects the run without changing the task). Action buttons are disabled for legacy DB tasks (`is_packet=false`) with a tooltip explaining the task must be converted to a packet.
   - Row selection uses `data-row-task-id`; action buttons use `data-action-task-id` — a deliberate split so row clicks don't fire action handlers. Button clicks call `event.stopPropagation()` and row handlers skip clicks originating inside a `<button>`.
   - Empty states: when the board has no tasks, an inline CTA "Create your first task" opens the task modal. When a filter yields zero rows but total > 0, a "Clear filter" button resets `missionStatus` to `all`.
3. **Mission Detail** — two cards side by side:
   - **Task Detail** for `selectedTaskId`: id/title/status badge, Summary, Objective, two-column "Scope / Out of Scope", "Constraints / Linked Decisions & Notes", Tracking grid (agent, runner, branch, worktree), and Latest Run Result (run id, status badge, completed/started time, summary line).
   - **Run Detail** for `selectedRunId` (falls back to task's `latest_run`): id, task id, status, prompt path (as `<code>`), lifecycle timestamps, review state, action row — **Approve**, **Needs changes**, **Mark blocked**, **Mark merged**, **Create follow-up task** — then lists of Changed Files, Commands Run, Validation Results, Blockers, Follow-ups.

   **Typed validation rendering.** When a run record includes a `validation[]` array of typed entries (`{ kind, command, name?, exit_code, ok, timed_out, duration_ms, output_snippet }`), the Validation Results section renders each entry as a row with a color-coded kind badge (`typecheck` blue, `lint` yellow, `test` green, `build` purple, `custom` gray), a status pill (`ok`/`failed`/`timed-out`), duration (e.g. `1.2s`), and the command in monospace. If `validation[]` is absent or empty but legacy `validation_results: string[]` is present, the older string-list rendering path is used as a fallback — older run records continue to display without change.
 
   **Auto-approve marker.** When a run was auto-approved by the orchestrator (triggered by `preferences.review.autoApproveOnAllGreen` combined with all typed validation steps passing), the record carries `review_state: "approved"`, `reviewed_by: "sidecar:auto"`, and a `review_note` such as `Auto-approved: N validation step(s) passed`. The Review row displays `approved · by sidecar:auto` followed by a small `auto-approved` chip (using the accent color) with the note on hover. Human reviewers render the same `by <name>` suffix without the chip.

   **Run lineage.** Run records may carry `parent_run_id` and `replay_reason` (set by `sidecar run replay <id>`). `GET /api/runs/:id` also returns a derived `children[]` array (each child `{run_id, status, runner_type, agent_role, started_at, completed_at, replay_reason}`) so the client doesn't need to fetch the full run list. The Run Detail panel renders two optional rows beneath Lifecycle: **Replay of:** with the parent run id (and reason in muted text) when `parent_run_id` is set, and **Replays:** with every child run id followed by a status tag when `children[]` is non-empty. Both parent and child ids are anchors with `data-run-link`; clicking swaps `state.selectedRunId` to the linked run and rerenders — the same pattern used for table row clicks, so a multi-level replay chain is navigable one hop at a time.

Run actions map to `POST /api/run/approve` (states `approved`/`needs_changes`/`merged`), `POST /api/run/block`, `POST /api/task/create-followup` — the last shows a success toast with the new task id.

## Overview (`view = 'overview'`)

Pulled from `GET /api/overview`. Pure read-only dashboard.

- **Hero card** — project name, absolute path, active-session indicator (a dot + "Active session: <actor_type> · <actor_name>" or "none"). Green dot when a session is open.
- **Stat cards** — Open Tasks (with high-priority sub-count; the card turns alert-styled when > 0 high priority), Decisions (total), Worklogs (total), Notes (total). Totals come from server-side counts; older servers fall back to `.length` of returned lists.
- **Recent lists** — top row: Open Tasks (with priority pill), Recent Decisions, Recent Worklogs. Bottom row: Recent Notes.
- **Empty-state CTAs** — each empty list includes a "Create your first <thing>" button that opens the corresponding modal.

## Timeline (`view = 'timeline'`)

Paginated project event log. First load fetches `/api/timeline?offset=0&limit=50`; subsequent pages via "Load more" append to `state.timelineEvents`.

- **Chips** — `all` plus one per event type (`decision`, `worklog`, `note`, `task_created`, `task_completed`, `summary_generated`). Multi-select (clicking a type chip toggles it in `timelineFilter.types`). Each chip shows a count computed from the loaded events.
- **Search** — text box filters title and summary (case-insensitive substring). Press `/` anywhere outside an input to focus it. Value is preserved during re-renders (not overwritten while focused).
- **Clear** — "Clear" chip appears when any filter is active; the empty-state also offers an inline clear button.
- **Event cards** grouped into day sections (sorted descending by date). Each card shows time, type pill, title, summary, and a meta line ("by <creator> • source <source> • #<id>").
- **Load more** button appears while the server reports `hasMore`. Disabled + "Loading…" state during fetch. Error surfaces as a toast.
- Backward-compatible with a server that returns a bare array instead of `{ events, hasMore, nextOffset }`.

## Preferences (`view = 'preferences'`)

Two cards side-by-side.

### Preferences editor (`.sidecar/preferences.json`)

Two tabs, selected via `data-prefs-tab`:

- **Form** — opinionated surface for the known schema:
  - `runner.defaultRunner` — select with `codex` / `claude` / — unset —.
  - `runner.agentRoleDefault` — free-text input (e.g. `builder-app`).
  - `ui.port` — number input with `min=1024 max=65535 step=1`; client-side validation rejects out-of-range with a toast before saving.
  - Any other top-level keys render below as read-only JSON blocks.
- **JSON** — raw `<textarea>` with the whole JSON document. Parsed client-side before save — invalid JSON surfaces a toast and the request is not sent.

Save merges Form values into the cached preferences object so unknown keys are preserved. Unset Form values delete the corresponding key. Reload discards local edits and re-fetches. All writes go through `PUT /api/preferences`.

### Summary pane (`.sidecar/summary.md`)

- Renders `summary.md` via a minimal markdown renderer (`renderMarkdown`) that supports `#`/`##`/`###` headings, `-` bullet lists, `**bold**`, and `` `inline code` ``. The renderer escapes HTML first, then applies token transforms on the already-escaped string — no injected HTML can survive.
- "Refresh summary" button posts to `POST /api/summary/refresh`, which shells to `sidecar summary refresh` and returns the new markdown. Success and failure both surface as toasts; only the markdown pane re-renders.

## Modals

A single reused modal root (`#modal-root` with a `.modal-card` dialog) is created lazily. `openModal(title, bodyHtml)` sets the title and body, stores `document.activeElement` as `modalOpener` so focus can be restored on close, focuses the first focusable non-close element, and installs a keydown trap:

- **Escape** closes.
- **Tab / Shift+Tab** wraps focus inside the dialog (excludes elements under `.modal-root.hidden`).

Three modals are wired:

- **Add Note** — title (optional) + text → `POST /api/notes`. Server writes directly to SQLite as an event of type `note`.
- **Add Task** — title + description + priority. The client posts to `POST /api/task-packets` with `status: 'ready'`, building `summary`/`goal` from the description or title. Server shells to `sidecar task create`.
- **Add Decision** — title + summary + optional details → `POST /api/decisions`, which shells to `sidecar decision record --by human`.

On success the modal closes, `invalidateGlobalData()` clears caches, and the current view re-renders.

## Toasts

`showToast({ type, title, message })` where `type` ∈ `success` / `error` / `info`. Glyphs: ✓ / ✕ / ℹ. Auto-dismiss after 4s (7s for errors). Container is `role="status"` / `aria-live="polite"` (each toast is also `role="alert"`). Close button, Escape, and animation-end all clean up; a 400ms safety timeout also removes the node in case `animationend` doesn't fire.

## Formatting helpers

- `fmt(ts)` — stable `YYYY-MM-DD HH:mm` in local time, matching the CLI's `humanTime`. Returns raw string for invalid dates and `"n/a"` for null.
- `escapeHtml()` — `&<>"'` replacements. Used throughout; all HTML is string-interpolated templates, so escaping is non-optional.
- `badge(status)` — `<span class="status status-<value>">`.

## HTTP API (summary)

Read endpoints (JSON):

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/overview` | project, activeSession, recentDecisions, recentWorklogs, openTasks, recentNotes, counts |
| GET | `/api/timeline?offset&limit` | `{ events, hasMore, nextOffset }` (limit capped at 200) |
| GET | `/api/tasks` | legacy DB tasks |
| GET | `/api/decisions` | last 100 decision events |
| GET | `/api/mission?status=` | `{ statuses, tasks, counts }`, merging task packets + legacy DB tasks |
| GET | `/api/task-packets` / `/api/task-packets/:id` | all packets / detail with runs |
| GET | `/api/runs` / `/api/runs/:id` | run list / detail |
| GET | `/api/run-summary` | envelope-unwrapped `sidecar run summary --json`; falls back to zeroes on error |
| GET | `/api/preferences` | parsed `preferences.json` or `null` |
| GET | `/api/summary` | `{ markdown }` from `summary.md` |

Write endpoints:

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/notes` | Direct SQLite insert (event type `note`) |
| POST | `/api/tasks` | Direct SQLite insert of legacy `tasks` row + origin event |
| POST | `/api/decisions` | `sidecar decision record --by human` |
| POST | `/api/task-packets` | `sidecar task create` |
| POST | `/api/prompt/compile` | `sidecar prompt compile <id> --runner --agent-role` |
| POST | `/api/run/start` | `sidecar run <id> [--runner] [--agent-role] [--dry-run]` |
| POST | `/api/run/approve` | `sidecar run approve <run> --state <approved\|needs_changes\|merged> [--note]` |
| POST | `/api/run/block` | `sidecar run block <run> [--note]` |
| POST | `/api/task/create-followup` | `sidecar task create-followup <run>` |
| PUT | `/api/preferences` | Overwrite `preferences.json` (must be a JSON object) |
| POST | `/api/summary/refresh` | `sidecar summary refresh`, returns fresh markdown |

Validation: request body is capped at 1 MiB; unknown priorities/runners/statuses fall back to safe defaults; required fields return `400` with `{ error }`.

Static routing: anything under `/api/` returns `404` JSON for unknown routes. Other paths are served from `public/` with a `publicDir` prefix check (403 on traversal); unmatched paths fall back to `index.html` for SPA-style routing.

## Theming

Dark by default. Light mode toggles `html[data-theme="light"]`, which re-maps the CSS custom properties in `styles.css`. Theme persists in `localStorage` and is applied before first paint.

## Accessibility notes

- Dialogs: `role="dialog" aria-modal="true"`, labeled by `#modal-title`, focus trap + restoration.
- Live region: toast root is `aria-live="polite"`, each toast is `role="alert"`.
- Buttons: filter chips use `aria-pressed`; theme toggle updates `aria-label`; icon-only buttons include `aria-label` and `title`.
- Skip link jumps to `#content` (tabbable, `tabindex="-1"`).
- Timeline search: `/` shortcut is suppressed when focus is in an input/textarea/select.

## File map

- `packages/ui/server.js` — HTTP server, SQLite reads, file reads, CLI shell-outs.
- `packages/ui/public/index.html` — shell, topbar, nav, content mount.
- `packages/ui/public/app.js` — all client logic: state, fetch, renderers, handlers, modals, toasts.
- `packages/ui/public/styles.css` — theme tokens, layout, components.
