Contributing checklist

Before you start
- Read the project README and the Development prerequisites.
- Ensure you use Node 22 and pnpm >= 9.

Local setup
- Install Node 22 (use .nvmrc/.node-version).
- Enable corepack and prepare pnpm:
  - corepack enable
  - corepack prepare pnpm@latest --activate
- Install dependencies:
  - pnpm install --frozen-lockfile

Development workflow
- Create a branch named: feat/short-description or fix/short-description
- Run linting and tests locally:
  - pnpm lint
  - pnpm test
- Format with Prettier where appropriate.

Commit & PR
- Keep commits focused and small.
- Use conventional commit messages (prefixes like feat:, fix:, chore:, docs:).
- Open a PR with a clear description and any manual test steps. Include screenshots where useful.

CI / Tests
- CI runs on Node 22 across macOS/Linux/Windows. If your change requires additional OS-specific dependencies, document them in your PR.

Puppeteer / headless tests
- See docs/puppeteer.md for how to configure Puppeteer locally and in CI, including system packages and recommended flags.

Thank you for contributing!