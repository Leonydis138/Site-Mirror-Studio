# Base44 Dev Environment

## Architecture

pnpm monorepo with two app processes running in a single container:

- **Frontend** (`artifacts/site-mirror`): Vite + React, port 3000. Proxies `/api` to `http://127.0.0.1:8080` (hardcoded in `vite.config.ts`). Has `allowedHosts: true` and `host: 0.0.0.0` already configured.
- **Backend** (`artifacts/api-server`): Express 5, port 8080. Dev command builds with esbuild then runs `node ./dist/index.mjs` (no watch mode — restart the container after backend edits).
- **Database** (`lib/db`): PostgreSQL 16 + Drizzle ORM. Schema pushed at startup via `drizzle-kit push`. `DATABASE_URL` is required — the `@workspace/db` module throws at import time without it.

## Startup

`docker compose -f docker-compose.base44.yml up -d --build`

The `scripts/base44-dev.sh` start script:
1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @workspace/db run push` (creates/migrates DB schema)
3. Starts backend on port 8080 (background)
4. Starts frontend on port 3000 (foreground)

## Key setup notes

- **pnpm-workspace.yaml `allowBuilds`**: Must have boolean values (`true`/`false`), not strings. esbuild and puppeteer both need `true` — esbuild for its native binary, puppeteer for Chrome download.
- **Puppeteer/Chrome**: `ensure-browser.mjs` runs during backend build (`predev`/`prebuild`). The Dockerfile installs Chromium system deps; puppeteer downloads Chrome to `/root/.cache/puppeteer/` during install. Chrome is only used when a mirror job runs, not at startup.
- **`@replit/object-storage`**: Only used when `NODE_ENV=production`. In development, archives are stored locally.
- **No external secrets needed**: All infrastructure (DB, Chrome) runs locally in compose.

## Verification

- Frontend: `curl -sf http://localhost:3000/` returns HTML
- API health: `curl -sf http://localhost:3000/api/healthz` returns `{"status":"ok"}`
- Preview: root renders with title "New mirror · Site Mirror"

## Backend edits

The backend has no watch mode (esbuild bundles once, then `node` runs). After editing backend code, restart: `docker compose -f docker-compose.base44.yml restart app`. Frontend changes hot-reload via Vite HMR.
