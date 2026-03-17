# Contributing

## Development principles

- Keep Sidecar deterministic and local-first.
- Prefer explicit, predictable command behavior over cleverness.
- Keep JSON output schema stable.
- Consolidate shared behavior in helpers/services instead of duplicating logic in command actions.

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

Use `npm run install:hooks -- --force` only if you intentionally want to replace an existing `pre-commit` hook.
