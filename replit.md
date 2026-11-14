# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Ask a Local defaults to **100 Gemini attempts per UTC day**, shared across instances in PostgreSQL. Set server-only `ASK_LOCAL_DAILY_LIMIT` to a positive integer to change it. This is a request cap, not a dollar budget; provider pricing may change.
- Each initial Gemini call and transient retry reserves a slot before contacting the provider. Failed/aborted calls still count, conservatively. Missing/invalid quota configuration or an unavailable usage store stops AI requests rather than bypassing protection.
- Daily counts survive restarts and are not reset by changing the allowance. No questions, answers, or visitor identifiers are stored. Keep all instances connected to the same database and configured with the same allowance. Limits apply only to this endpoint, not other uses of the Gemini key.

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
