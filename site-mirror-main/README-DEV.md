Development prerequisites / Supported environments

Minimum supported developer environment
- Node.js: 22.x (recommended). Use the project .nvmrc / .node-version to pin your runtime.
- pnpm: >= 9 (pnpm lockfile v9 is used by this repo). Use Corepack or install pnpm globally.
- TypeScript: as specified in devDependencies.
- Optional but recommended:
  - Corepack enabled (corepack helps ensure pnpm version consistency)
  - Docker for running any environment-specific services

Quick start (local)
1. Ensure Node 22 is active:
   - nvm use or asdf or your system Node manager.
2. Ensure Corepack/pnpm is available:
   - corepack enable
   - corepack prepare pnpm@latest --activate
3. Install dependencies:
   - pnpm install --frozen-lockfile
4. Build and run:
   - pnpm build
   - pnpm dev (or see individual package scripts)

Notes
- Lockfile: This repo uses pnpm lockfileVersion 9. Please do not regenerate the lockfile with an older pnpm version.
- If you need to change the Node version, update both .nvmrc and .node-version files and include a short rationale in your PR.