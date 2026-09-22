import puppeteer from "puppeteer";

export async function launchBrowser(options = {}) {
  const defaultArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-features=Translate,BackForwardCache"
  ];

  const existingArgs = options.args ?? [];

  const args = [
    ...new Set([
      ...defaultArgs,
      ...existingArgs
    ])
  ];

  console.log("Launching Puppeteer...");
  console.log(`Chrome: ${puppeteer.executablePath()}`);

  return puppeteer.launch({
    ...options,
    args,
    headless: options.headless ?? true
  });
}

export default launchBrowser;
