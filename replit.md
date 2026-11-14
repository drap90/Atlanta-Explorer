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
- Owner notifications use fixed **80% and 100%** thresholds, once each per UTC day. The owner requested **email setup for later**: email delivery is disabled by default; no external email service is connected yet. The public guide stays anonymous.
- Usage reservations atomically enqueue aggregate alert snapshots. A background worker checks every 30 seconds when enabled; it never refunds attempts or changes the cap. Apply the database schema before starting the updated server (`pnpm --filter @workspace/db run push` in development; also included in post-merge setup).
- To enable later, connect Resend and configure its server-only `RESEND_API_KEY` through Secrets, `ASK_LOCAL_ALERT_EMAIL_FROM` (a verified sender mailbox), and `ASK_LOCAL_ALERT_EMAIL_TO` (one owner mailbox). Then set `ASK_LOCAL_ALERT_EMAIL_ENABLED=true` and restart the API server. Do not expose these settings in client code or commit real addresses/credentials. Set the flag to `false` to pause delivery.
- Pending alerts store only day, percentage, aggregate counts, and delivery state. Old never-attempted alerts expire after their UTC day. Failed sends retry every five minutes with the same Resend idempotency key and frozen counts. Cross-instance leases last one minute; crashes are recovered after lease expiry. Retries stop 23 hours after the first attempt, before Resend's 24-hour deduplication window ends, prioritizing no duplicates over late delivery. Do not change sender/recipient settings while alerts are pending; restart all instances with consistent configuration.
- Alert logs contain only generic status or aggregate day/threshold/counts; never log raw database/HTTP errors, provider responses, questions, answers, visitor identifiers, owner addresses, or credentials. A `sent` state means the email provider accepted the message, not that inbox delivery was confirmed.
- `pnpm --filter @workspace/api-server run test:quota` verifies quota enforcement, threshold crossings, concurrent delivery claims, restart recovery, disabled setup, and failed deliveries using isolated temporary database schemas and fake email delivery; it never sends a real email or consumes Gemini allowance.

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
