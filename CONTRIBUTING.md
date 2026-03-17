# Contributing

## Development principles

- Keep Sidecar deterministic and local-first.
- Prefer explicit, predictable command behavior over cleverness.
- Keep JSON output schema stable.
- Consolidate shared behavior in helpers/services instead of duplicating logic in command actions.
- Use Sidecar to document repository changes before finalizing work.

## Required Sidecar logging for repo changes

For any code change in this repo, run:

1. `sidecar context --format markdown`
2. `sidecar worklog record --done "<what changed>" --files <paths> --by human|agent`
3. `sidecar decision record ...` when behavior/design changes
4. `sidecar task add ...` when follow-up work exists
5. `sidecar summary refresh`

## Code structure

- CLI entrypoint: `src/cli.ts`
- Database init/access: `src/db/`
- Domain services: `src/services/`
- Shared helpers: `src/lib/`
- Generated markdown templates: `src/templates/`
- Shared types: `src/types/models.ts`

Important: `src/cli.ts` is the only supported command entrypoint for v1.

## Adding or changing commands

1. Define clear command name/description/options.
2. Validate inputs (`zod` where appropriate).
3. Use shared output envelope helpers from `src/lib/output.ts`.
4. Keep human-readable output concise and consistent.
5. Keep command actions thin; put business logic in services.

## Local checks

```bash
npm install
npm run build
npm run sidecar:reminder
```

Optional local reminder hook:

```bash
npm run install:hooks
```

This is optional and per-repository clone. Running `sidecar init` does not install hooks.

The installed pre-commit hook enforces Sidecar logging for staged non-doc code changes.
It blocks commit when a new `worklog` and `summary refresh` have not been recorded since the last commit.

Use `npm run install:hooks -- --force` only if you intentionally want to replace an existing `pre-commit` hook.
