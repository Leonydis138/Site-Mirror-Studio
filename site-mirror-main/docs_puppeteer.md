Puppeteer developer notes (local / CI / production)

Overview
- Puppeteer requires a Chromium/Chrome binary and a few OS-level dependencies when running on Linux containers or CI runners.
- In development you can use the default bundled Chromium. In production you may prefer puppeteer-core + system Chrome.

Common runtime flags (recommended)
- Use these flags when launching Puppeteer to improve stability in CI:
  --no-sandbox
  --disable-setuid-sandbox
  --disable-dev-shm-usage
  --disable-gpu
  --single-process

Environment variables
- PUPPETEER_PRODUCT: 'chrome' (if you need Chrome)
- PUPPETEER_EXECUTABLE_PATH: path to a system-installed chrome/chromium (when using puppeteer-core)
- CHROME_BIN: (some tools expect this)

System packages (Ubuntu / Debian)
Install the following for Chromium to run reliably:
- apt-get install -y \
  gconf-service libasound2 libatk1.0-0 libcups2 libdbus-1-3 \
  libgconf-2-4 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxrandr2 \
  libgbm1 libpangocairo-1.0-0 libatspi2.0-0 libxss1

If using a minimal container (Docker) add:
- --shm-size=1gb to docker run (or use --disable-dev-shm-usage)

CI tips
- GitHub Actions (ubuntu-latest) usually has Chromium or Chrome available; if not, allow Puppeteer to download it during pnpm install (ensure network access).
- If you prefer to avoid the download, install system Chrome and set PUPPETEER_EXECUTABLE_PATH to the installed binary.

Troubleshooting
- "exited with signal 6" or crash: try --disable-dev-shm-usage.
- "No usable sandbox" errors: use --no-sandbox --disable-setuid-sandbox.