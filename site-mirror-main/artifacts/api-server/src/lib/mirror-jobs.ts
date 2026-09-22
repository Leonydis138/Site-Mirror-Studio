import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import puppeteer, { type Browser } from "puppeteer";
import archiver from "archiver";

export type MirrorStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type MirrorJobRecord = {
  id: string;
  url: string;
  status: MirrorStatus;
  pagesFound: number;
  pagesDownloaded: number;
  assetsDownloaded: number;
  bytesDownloaded: number;
  maxPages: number;
  requestDelayMs: number;
  respectRobotsTxt: boolean;
  maxDepth: number;
  includeAssets: boolean;
  pathPrefix: string;
  excludePaths: string[];
  currentUrl: string | null;
  message: string | null;
  createdAt: Date;
  completedAt: string | null;
  outputDir: string;
  cancelRequested: boolean;
  browser: Browser | null;
  downloadedAssets: Set<string>;
};

const jobs = new Map<string, MirrorJobRecord>();
const tempRoot = path.join(os.tmpdir(), "site-mirror-jobs");

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return true;
}

async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid website URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    net.isIP(hostname) && isPrivateAddress(hostname)
  ) {
    throw new Error("Local and private network addresses are not supported.");
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("The website resolves to a local or private network address.");
  }

  parsed.hash = "";
  return parsed;
}

function publicJob(job: MirrorJobRecord) {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    pagesFound: job.pagesFound,
    pagesDownloaded: job.pagesDownloaded,
    assetsDownloaded: job.assetsDownloaded,
    bytesDownloaded: job.bytesDownloaded,
    maxPages: job.maxPages,
    requestDelayMs: job.requestDelayMs,
    respectRobotsTxt: job.respectRobotsTxt,
    maxDepth: job.maxDepth,
    includeAssets: job.includeAssets,
    pathPrefix: job.pathPrefix,
    excludePaths: job.excludePaths,
    currentUrl: job.currentUrl,
    message: job.message,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

function filePathForUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const cleanPath = decodeURIComponent(parsed.pathname).replace(/\\/g, "/");
  const safeSegments = cleanPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._~-]/g, "_"));
  const last = safeSegments.at(-1) ?? "";
  if (!path.extname(last)) safeSegments.push("index.html");
  if (safeSegments.length === 0) safeSegments.push("index.html");
  return path.join(parsed.hostname, ...safeSegments);
}

function sameOrigin(candidate: URL, origin: URL): boolean {
  return candidate.origin === origin.origin;
}

function normalizePathPrefix(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized === "/") return "/";
  return `/${normalized.replace(/^\/+|\/+$/g, "")}`;
}

function pathMatchesPrefix(candidatePath: string, prefix: string): boolean {
  return prefix === "/" || candidatePath === prefix || candidatePath.startsWith(`${prefix}/`);
}

function withinScope(candidate: URL, origin: URL, job: MirrorJobRecord): boolean {
  if (!sameOrigin(candidate, origin)) return false;
  if (!pathMatchesPrefix(candidate.pathname, job.pathPrefix)) return false;
  return !job.excludePaths.some((excluded) => pathMatchesPrefix(candidate.pathname, excluded));
}

function shouldSaveResource(url: URL): boolean {
  return ["http:", "https:"].includes(url.protocol);
}

async function loadRobots(origin: URL): Promise<Set<string>> {
  const disallowed = new Set<string>();
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) return disallowed;
    const body = await response.text();
    let applies = false;
    for (const rawLine of body.split(/\r?\n/)) {
      const [rawKey, ...rawValue] = rawLine.split("#")[0].split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rawValue.join(":").trim();
      if (key === "user-agent") applies = value === "*" || value === "";
      if (applies && key === "disallow" && value) disallowed.add(value);
    }
  } catch {
    // A missing or unavailable robots file does not block an authorized crawl.
  }
  return disallowed;
}

function blockedByRobots(url: URL, origin: URL, disallowed: Set<string>): boolean {
  if (disallowed.size === 0) return false;
  const relativePath = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
  return [...disallowed].some((rule) => relativePath.startsWith(rule));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFileForUrl(
  outputDir: string,
  rawUrl: string,
  body: Uint8Array,
): Promise<void> {
  const target = path.join(outputDir, filePathForUrl(rawUrl));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

function rewriteHtml(
  html: string,
  pageUrl: string,
  outputDir: string,
  resourceUrls: string[],
): string {
  const pageFile = path.join(outputDir, filePathForUrl(pageUrl));
  return resourceUrls.reduce((result, resourceUrl) => {
    const original = new URL(resourceUrl);
    const target = path.join(outputDir, filePathForUrl(resourceUrl));
    const relative = path.relative(path.dirname(pageFile), target).replace(/\\/g, "/");
    return result.split(resourceUrl).join(relative || "./index.html");
  }, html);
}

async function downloadAsset(
  job: MirrorJobRecord,
  assetUrl: string,
): Promise<void> {
  if (job.downloadedAssets.has(assetUrl)) return;
  const response = await fetch(assetUrl, {
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
    headers: { "User-Agent": "SiteMirror/1.0 (authorized archive)" },
  });
  if (!response.ok) return;
  const body = new Uint8Array(await response.arrayBuffer());
  await writeFileForUrl(job.outputDir, assetUrl, body);
  job.downloadedAssets.add(assetUrl);
  job.assetsDownloaded += 1;
  job.bytesDownloaded += body.byteLength;
}

async function runJob(job: MirrorJobRecord): Promise<void> {
  const origin = await assertSafePublicUrl(job.url);
  const robots = job.respectRobotsTxt ? await loadRobots(origin) : new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: origin.href, depth: 0 }];
  const queuedUrls = new Set([origin.href]);
  const seen = new Set<string>();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  job.browser = browser;
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(30_000);

  try {
    while (queue.length > 0 && seen.size < job.maxPages) {
      if (job.cancelRequested) {
        job.status = "cancelled";
        job.message = "Mirror cancelled.";
        return;
      }

      const queueEntry = queue.shift()!;
      const current = queueEntry.url;
      if (seen.has(current)) continue;
      const currentUrl = new URL(current);
      if (!withinScope(currentUrl, origin, job) || blockedByRobots(currentUrl, origin, robots)) {
        continue;
      }
      seen.add(current);
      job.pagesFound = Math.max(job.pagesFound, seen.size + queue.length);
      job.currentUrl = current;

      try {
        const response = await page.goto(current, { waitUntil: "domcontentloaded" });
        if (!response || !response.ok()) continue;
        if (job.requestDelayMs > 0) await sleep(job.requestDelayMs);

        const resources = await page.evaluate(() => {
          const links = new Set<string>();
          const assets = new Set<string>();
          const pageDocument = (
            globalThis as unknown as {
              document: {
                querySelectorAll: (
                  selector: string,
                ) => {
                  forEach: (
                    callback: (element: {
                      getAttribute: (name: string) => string | null;
                    }) => void,
                  ) => void;
                };
              };
            }
          ).document;
          const linkElements = pageDocument.querySelectorAll("a[href]");
          linkElements.forEach((element) => {
            const value = element.getAttribute("href");
            if (value) links.add(value);
          });
          const assetElements = pageDocument.querySelectorAll(
            "link[href], img[src], script[src], source[src], video[src], audio[src], iframe[src]",
          );
          assetElements.forEach((element) => {
            const value =
              element.getAttribute("href") ??
              element.getAttribute("src") ??
              element.getAttribute("data-src");
            if (value) assets.add(value);
          });
          return { links: [...links], assets: [...assets] };
        });
        const normalizeResources = (values: string[]) => values
          .map((value) => {
            try {
              const parsed = new URL(value, current);
              parsed.hash = "";
              return parsed.href;
            } catch {
              return null;
            }
          })
          .filter((value): value is string => Boolean(value));

        const normalizedLinks = normalizeResources(resources.links);
        const normalizedAssets = normalizeResources(resources.assets);
        const internalPages = normalizedLinks.filter((value) => {
          try {
            const parsed = new URL(value);
            return withinScope(parsed, origin, job);
          } catch {
            return false;
          }
        });
        for (const pageUrl of internalPages) {
          if (
            queueEntry.depth < job.maxDepth &&
            !seen.has(pageUrl) &&
            !queuedUrls.has(pageUrl) &&
            queue.length < job.maxPages * 2
          ) {
            queue.push({ url: pageUrl, depth: queueEntry.depth + 1 });
            queuedUrls.add(pageUrl);
          }
        }
        job.pagesFound = Math.max(job.pagesFound, seen.size + queue.length);

        const assetUrls = job.includeAssets ? normalizedAssets.filter((value) => {
          try {
            const parsed = new URL(value);
            return withinScope(parsed, origin, job) && shouldSaveResource(parsed);
          } catch {
            return false;
          }
        }) : [];
        for (const assetUrl of assetUrls) {
          if (job.cancelRequested) break;
          try {
            await downloadAsset(job, assetUrl);
          } catch {
            // Individual assets are best-effort; the page remains useful.
          }
        }

        const html = await page.content();
        const rewritten = rewriteHtml(html, current, job.outputDir, assetUrls);
        await writeFileForUrl(job.outputDir, current, Buffer.from(rewritten));
        job.pagesDownloaded += 1;
      } catch {
        // A single unavailable page should not fail the rest of the crawl.
      }
    }
    if (job.status !== "cancelled") {
      job.status = "completed";
      job.message = `Saved ${job.pagesDownloaded} page${job.pagesDownloaded === 1 ? "" : "s"} and ${job.assetsDownloaded} asset${job.assetsDownloaded === 1 ? "" : "s"}.`;
    }
  } finally {
    job.currentUrl = null;
    job.completedAt = new Date().toISOString();
    job.browser = null;
    await browser.close();
  }
}

export async function createMirrorJob(input: {
  url: string;
  maxPages?: number;
  requestDelayMs?: number;
  respectRobotsTxt?: boolean;
  maxDepth?: number;
  includeAssets?: boolean;
  pathPrefix?: string;
  excludePaths?: string[];
}): Promise<MirrorJobRecord> {
  const safeUrl = await assertSafePublicUrl(input.url);
  const id = randomUUID();
  const outputDir = path.join(tempRoot, id);
  await fs.mkdir(outputDir, { recursive: true });
  const job: MirrorJobRecord = {
    id,
    url: safeUrl.href,
    status: "queued",
    pagesFound: 0,
    pagesDownloaded: 0,
    assetsDownloaded: 0,
    bytesDownloaded: 0,
    maxPages: input.maxPages ?? 100,
    requestDelayMs: input.requestDelayMs ?? 250,
    respectRobotsTxt: input.respectRobotsTxt ?? true,
    maxDepth: input.maxDepth ?? 3,
    includeAssets: input.includeAssets ?? true,
    pathPrefix: normalizePathPrefix(input.pathPrefix ?? "/"),
    excludePaths: (input.excludePaths ?? []).map(normalizePathPrefix),
    currentUrl: null,
    message: "Waiting to start.",
    createdAt: new Date(),
    completedAt: null,
    outputDir,
    cancelRequested: false,
    browser: null,
    downloadedAssets: new Set<string>(),
  };
  jobs.set(id, job);
  void (async () => {
    job.status = "running";
    job.message = "Crawling same-origin pages and assets.";
    try {
      await runJob(job);
    } catch (error) {
      job.status = job.cancelRequested ? "cancelled" : "failed";
      job.message = error instanceof Error ? error.message : "Mirror failed.";
      job.completedAt = new Date().toISOString();
      if (job.browser) {
        await job.browser.close().catch(() => undefined);
        job.browser = null;
      }
    }
  })();
  return job;
}

export function getMirrorJob(id: string): MirrorJobRecord | undefined {
  return jobs.get(id);
}

export async function cancelMirrorJob(id: string): Promise<MirrorJobRecord | undefined> {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.status === "queued" || job.status === "running") {
    job.cancelRequested = true;
    job.message = "Cancellation requested.";
    await job.browser?.close().catch(() => undefined);
  }
  return job;
}

export function getPublicMirrorJob(job: MirrorJobRecord) {
  return publicJob(job);
}

export async function streamMirrorZip(job: MirrorJobRecord, response: NodeJS.WritableStream) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error: Error) => {
    throw error;
  });
  archive.pipe(response);
  archive.directory(job.outputDir, false);
  await archive.finalize();
}