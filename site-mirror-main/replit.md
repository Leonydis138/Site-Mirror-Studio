# Site Mirror

Site Mirror creates downloadable, same-origin website archives for sites the user owns or has explicit permission to copy.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the canonical OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `PORT` — server port (defaults to 3000)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/site-mirror/` — React interface for creating and monitoring mirror jobs
- `artifacts/api-server/src/lib/mirror-jobs.ts` — crawl, progress, cancellation, and ZIP archive service
- `artifacts/api-server/src/routes/mirror.ts` — mirror job API routes
- `lib/api-spec/openapi.yaml` — canonical source-of-truth for the mirror API contract (use this for codegen)
- `lib/api-client-react/` and `lib/api-zod/` — generated client hooks and validation schemas

## Architecture decisions

- Crawls are same-origin only and deliberately do not attempt login, anti-bot, or protected-content bypasses.
- Jobs are kept in memory and written to a temporary directory for the current server process; ZIPs are generated on demand.
- Robots-aware crawling and a configurable request delay are enabled by default.
- Public URL validation rejects localhost, private IPs, and embedded URL credentials to reduce SSRF risk.

## Product

Users can configure a permitted archive, set a page ceiling and delay, watch live crawl progress, stop a running job, and download a completed ZIP mirror.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.
- Mirror jobs are process-local and temporary; a restart clears active jobs and archives.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
