#!/bin/bash
set -e

echo "=== Installing dependencies ==="
pnpm install --frozen-lockfile

echo "=== Pushing database schema ==="
pnpm --filter @workspace/db run push || echo "WARNING: DB schema push failed, continuing..."

echo "=== Starting backend (port 8080) ==="
PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev &

echo "=== Starting frontend (port 3000) ==="
PORT=3000 pnpm --filter @workspace/site-mirror run dev
