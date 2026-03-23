# Project Summary

Generated: 2026-03-22T04:25:06.307Z

## Overview
- Project: sidecar-cli
- Path: /Volumes/AI/Projects/sidecar-cli
- Events in last 7 days: 72
- Open tasks: 2

## Active Session
- None

## Recent Decisions
- 2026-03-22T04:25:04.926Z | Use global topbar modals for quick capture actions: Top-level modal triggers let users add notes/tasks/decisions from any screen without scrolling to view-specific forms, improving consistency and speed in the UI workflow.
- 2026-03-22T04:18:46.980Z | Carry overview/timeline usability polish onto next branch: Preserve mission-control features while improving readability with denser overview information hierarchy and a timeline progression feed.
- 2026-03-22T03:58:52.435Z | Use dashboard information hierarchy for Sidecar overview: A compact stat+panel layout improves usability and scan speed over long text sections, especially for active projects with many records.
- 2026-03-22T03:55:53.429Z | Use card-based scroll timeline in Sidecar UI: A vertical grouped timeline is easier to scan for project progression than a dense table and better communicates sequence/history.
- 2026-03-19T20:59:52.958Z | Make Sidecar UI primary workflow for project operations: Expose domain/CLI operations through UI server endpoints and mission-control screens so users can create context, generate/assign/run/review tasks, and manage spec updates without relying on direct CLI commands for common flows.
- 2026-03-19T20:51:40.554Z | Support codex runner flags from preferences: Allow model/profile/sandbox/approval/extra args to be configured in preferences and injected into codex exec command construction for deterministic configurable runs.
- 2026-03-19T20:48:32.811Z | Execute Codex runs for sidecar run by default: Switch codex adapter from placeholder behavior to real codex exec execution with persisted stdout/stderr logs and run-level execution metadata so status reflects true outcomes.
- 2026-03-19T20:40:28.272Z | Introduce deterministic smart spec updater workflow: Use structured spec-update records plus rule-based routing and safe patch application so spec drift can be reviewed and applied without destructive rewrites.

## Recent Work
- 2026-03-22T04:25:01.746Z | Worklog entry: Added global top-nav Add Note/Add Task/Add Decision modals in Sidecar UI, removed inline overview quick-add forms, and wired POST /api/decisions endpoint so decisions can be created from anywhere.
- 2026-03-22T04:20:57.597Z | Worklog: ui json parse error fix: Fixed Sidecar UI server API routing so unknown /api paths return JSON errors (not index.html), added missing POST /api/tasks endpoint used by overview quick-add form, and made run-summary endpoint gracefully fallback to empty summary data when CLI summary command is unavailable.
- 2026-03-22T04:18:46.938Z | Worklog: apply stashed UI polish to next: Applied and resolved stashed UI changes onto next: upgraded timeline to a scrollable grouped event feed and redesigned overview into a denser dashboard with scannable cards and compact quick-add forms.
- 2026-03-22T04:14:18.736Z | Worklog: beta release: Cut beta release v0.1.3-beta.1 from next by bumping package version, validating release tag contract, creating git tag, and pushing branch+tag to trigger release workflow.
- 2026-03-22T04:11:13.364Z | Worklog: overview density improvement: Reworked overview to a denser 3-column desktop layout so open tasks/decisions/worklogs/notes and quick add forms are visible with less page scrolling; made list panels internally scrollable.
- 2026-03-22T03:58:52.417Z | Worklog: overview UX redesign: Redesigned overview into a dashboard layout with project hero, compact stats cards, scannable item panels for tasks/decisions/worklogs/notes, and clearer quick add actions to reduce dense text and improve readability.
- 2026-03-22T03:55:53.413Z | Worklog: timeline UX: Replaced timeline table with a scrollable progression feed grouped by day, with event cards that show type, time, title, summary, and metadata for easier history scanning.
- 2026-03-19T21:00:18.832Z | Worklog: ui run-ready action fix: Updated UI quick action Run Ready Tasks to call new /api/run/start-ready endpoint that invokes sidecar run start-ready (supports dry-run), instead of running only the selected task.

## Open Tasks
- #3 [low] UI route check
- #2 [medium] json contract check

## Recent Notes
- 2026-03-18T19:21:56.234Z | Note: api ingest test
- 2026-03-18T19:19:07.977Z | Note: api ingest test
- 2026-03-18T18:58:42.571Z | Code Documentation Requirements: Make sure to always document code you write with helpful comments. And keep things concise and avoid re-creating functions and features that should be in a library or helper.
- 2026-03-18T18:22:40.775Z | UI Note: created from ui api

## Artifacts
- 2026-03-22T04:25:01.748Z | file | packages/ui/public/index.html
- 2026-03-22T04:25:01.748Z | file | packages/ui/public/styles.css
- 2026-03-22T04:25:01.748Z | file | packages/ui/public/app.js
- 2026-03-22T04:25:01.748Z | file | packages/ui/server.js
- 2026-03-22T04:20:57.598Z | file | packages/ui/server.js
- 2026-03-22T04:18:46.938Z | file | packages/ui/public/app.js
- 2026-03-22T04:18:46.938Z | file | packages/ui/public/styles.css
- 2026-03-22T04:14:18.737Z | file | package.json
