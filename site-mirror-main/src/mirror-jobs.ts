import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer";
import archiver from "archiver";
import { logger } from "./logger.js";

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
  timeoutMs: number;
  maxTotalBytes: number;
  maxAssetBytes: number;
  currentUrl: string | null;
  message: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: string | null;
  outputDir: string;
  cancelRequested: boolean;
  browser: Browser | null;
  downloadedAssets: Set<string>;
  savedPages: Set<string>;
  timedOut: boolean;
  sizeLimitReached: boolean;
};

const MIRROR_USER_AGENT = "SiteMirror/1.0 (authorized archive)";
const NAV_TIMEOUT_MS = 30_000;

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"]);

const jobs = new Map<string, MirrorJobRecord>();
const tempRoot = path.join(os.tmpdir(), "site-mirror-jobs");

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_CONCURRENT_JOBS = envNumber("MIRROR_MAX_CONCURRENT_JOBS", 3);
const ASSET_DOWNLOAD_CONCURRENCY = envNumber("MIRROR_ASSET_CONCURRENCY", 4);
const DEFAULT_JOB_TIMEOUT_MS = envNumber("MIRROR_DEFAULT_TIMEOUT_MS", 15 * 60 * 1000);
const MAX_JOB_TIMEOUT_MS = envNumber("MIRROR_MAX_TIMEOUT_MS", 60 * 60 * 1000);
const MIN_JOB_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOTAL_BYTES = envNumber("MIRROR_DEFAULT_MAX_TOTAL_BYTES", 500 * 1024 * 1024);
const HARD_MAX_TOTAL_BYTES = envNumber("MIRROR_HARD_MAX_TOTAL_BYTES", 2 * 1024 * 1024 * 1024);
const MIN_TOTAL_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = envNumber("MIRROR_MAX_ASSET_BYTES", 50 * 1024 * 1024);
const JOB_RETENTION_MS = envNumber("MIRROR_JOB_RETENTION_MS", 6 * 60 * 60 * 1000);
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;

// New safety caps
const MAX_PENDING_JOB_QUEUE_LENGTH = envNumber("MIRROR_MAX_PENDING_QUEUE_LENGTH", 1000);
const MAX_QUEUED_URLS_PER_JOB = envNumber("MIRROR_MAX_QUEUED_URLS_PER_JOB", 10000);
const MAX_INTERNAL_QUEUE_MULTIPLIER = envNumber("MIRROR_INTERNAL_QUEUE_MULTIPLIER", 2);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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

const dnsSafetyCache = new Map<string, { safe: boolean; expiresAt: number }>();

async function isHostnameSafe(hostname: string): Promise<boolean> {
  const key = hostname.toLowerCase();
  const cached = dnsSafetyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.safe;

  let safe: boolean;
  if (net.isIP(key)) {
    safe = !isPrivateAddress(key);
  } else if (key === "localhost" || key.endsWith(".localhost") || key.endsWith(".local")) {
    safe = false;
  } else {
    try {
      const addresses = await lookup(key, { all: true });
      safe = addresses.length > 0 && !addresses.some(({ address }) => isPrivateAddress(address));
    } catch {
      safe = false;
    }
  }
  dnsSafetyCache.set(key, { safe, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
  return safe;
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
  const safe = await isHostnameSafe(parsed.hostname);
  if (!safe) {
    throw new Error("The website resolves to a local or private network address, or could not be resolved.");
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
    timeoutMs: job.timeoutMs,
    maxTotalBytes: job.maxTotalBytes,
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
  const querySuffix = parsed.search
    ? `~${createHash("sha1").update(parsed.search).digest("hex").slice(0, 8)}`
    : "";
  const last = safeSegments.at(-1) ?? "";
  if (!path.extname(last)) {
    safeSegments.push(`index${querySuffix}.html`);
  } else if (querySuffix) {
    const ext = path.extname(last);
    const base = last.slice(0, -ext.length);
    safeSegments[safeSegments.length - 1] = `${base}${querySuffix}${ext}`;
  }
  if (safeSegments.length === 0) safeSegments.push(`index${querySuffix}.html`);
  return path.join(parsed.hostname, ...safeSegments);
}

function sameOrigin(candidate: URL, origin: URL): boolean {
  return candidate.origin === origin.origin;
}

function normalizePathPrefix(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized === "/") return "/";
  return `/${normalized.replace(/^\/+/g, "").replace(/\/+$/g, "")}`;
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

type RobotsRules = {
  rules: Array<{ path: string; allow: boolean }>;
  crawlDelayMs: number | null;
};

async function loadRobots(origin: URL): Promise<RobotsRules> {
  const rules: Array<{ path: string; allow: boolean }> = [];
  let crawlDelayMs: number | null = null;
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!response.ok) return { rules, crawlDelayMs };
    const body = await response.text();
    let applies = false;
    for (const rawLine of body.split(/\r?\n/)) {
      const [rawKey, ...rawValue] = rawLine.split("#")[0].split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rawValue.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*" || value === "";
        continue;
      }
      if (!applies) continue;
      if (key === "disallow" && value) rules.push({ path: value, allow: false });
      if (key === "allow" && value) rules.push({ path: value, allow: true });
      if (key === "crawl-delay" && value) {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) crawlDelayMs = Math.round(seconds * 1000);
      }
    }
  } catch {
    // ignore
  }
  return { rules, crawlDelayMs };
}

function ruleToRegex(rulePath: string): RegExp {
  const hasEndAnchor = rulePath.endsWith("$");
  const body = hasEndAnchor ? rulePath.slice(0, -1) : rulePath;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${hasEndAnchor ? "$" : ""}`);
}

function blockedByRobots(url: URL, robots: RobotsRules): boolean {
  if (robots.rules.length === 0) return false;
  const relativePath = url.pathname + url.search;
  let best: { allow: boolean; specificity: number } | null = null;
  for (const rule of robots.rules) {
    if (!rule.path) continue;
    const regex = ruleToRegex(rule.path);
    if (!regex.test(relativePath) && !regex.test(url.pathname)) continue;
    const specificity = rule.path.length;
    if (!best || specificity > best.specificity) best = { allow: rule.allow, specificity };
  }
  return best ? !best.allow : false;
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

const REWRITABLE_ATTR = /\b(href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

async function rewriteSavedPageFile(
  job: MirrorJobRecord,
  pageUrl: string,
  knownUrls: Set<string>,
): Promise<void> {
  const pageFile = path.join(job.outputDir, filePathForUrl(pageUrl));
  let html: string;
  try {
    html = await fs.readFile(pageFile, "utf8");
  } catch {
    return;
  }
  const rewritten = html.replace(REWRITABLE_ATTR, (match, attr: string, dq?: string, sq?: string) => {
    const rawValue = dq ?? sq;
    if (!rawValue || /^\s*(#|mailto:|tel:|javascript:|data:)/i.test(rawValue)) return match;
    let target: URL;
    try {
      target = new URL(rawValue, pageUrl);
    } catch {
      return match;
    }
    target.hash = "";
    if (!knownUrls.has(target.href)) return match;
    const targetFile = path.join(job.outputDir, filePathForUrl(target.href));
    const relative =
      path.relative(path.dirname(pageFile), targetFile).replace(/\\/g, "/") || path.basename(targetFile);
    const quote = dq !== undefined ? '"' : "'";
    return `${attr}=${quote}${relative}${quote}`;
  });
  if (rewritten !== html) {
    await fs.writeFile(pageFile, rewritten);
  }
}

async function downloadAsset(job: MirrorJobRecord, assetUrl: string): Promise<void> {
  if (job.downloadedAssets.has(assetUrl)) return;
  if (job.bytesDownloaded >= job.maxTotalBytes) return;
  const target = new URL(assetUrl);
  if (!(await isHostnameSafe(target.hostname))) return;
  const response = await fetch(assetUrl, {
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
    headers: { "User-Agent": MIRROR_USER_AGENT },
  });
  if (!response.ok) return;
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > job.maxAssetBytes) {
    logger.debug({ assetUrl, declaredLength, jobId: job.id }, "Skipped asset: exceeds per-asset size limit");
    return;
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > job.maxAssetBytes) return;
  if (job.bytesDownloaded + body.byteLength > job.maxTotalBytes) {
    job.sizeLimitReached = true;
    return;
  }
  await writeFileForUrl(job.outputDir, assetUrl, body);
  job.downloadedAssets.add(assetUrl);
  job.assetsDownloaded += 1;
  job.bytesDownloaded += body.byteLength;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: runnerCount }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    }),
  );
}

async function configureRequestInterception(page: Page, job: MirrorJobRecord): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    void (async () => {
      try {
        if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
          await req.abort("blockedbyclient");
          return;
        }
        let target: URL;
        try {
          target = new URL(req.url());
        } catch {
          await req.abort("blockedbyclient");
          return;
        }
        if (["data:", "blob:", "about:"].includes(target.protocol)) {
          await req.continue();
          return;
        }
        if (!["http:", "https:"].includes(target.protocol)) {
          await req.abort("blockedbyclient");
          return;
        }
        if (!(await isHostnameSafe(target.hostname))) {
          logger.warn({ url: target.href, jobId: job.id }, "Blocked request to a local or private address");
          await req.abort("blockedbyclient");
          return;
        }
        await req.continue();
      } catch {
        await req.abort("blockedbyclient").catch(() => undefined);
      }
    })();
  });
}

async function runJob(job: MirrorJobRecord): Promise<void> {
  const origin = await assertSafePublicUrl(job.url);
  const robots = job.respectRobotsTxt ? await loadRobots(origin) : { rules: [], crawlDelayMs: null };
  const effectiveDelayMs = Math.min(Math.max(job.requestDelayMs, robots.crawlDelayMs ?? 0), 30_000);

  const queue: Array<{ url: string; depth: number }> = [{ url: origin.href, depth: 0 }];
  const queuedUrls = new Set([origin.href]);
  const seen = new Set<string>();

  // ---- Find Chromium on Replit ----
  let chromiumPath: string | undefined;

  try {
    // Try `which chromium` first
    const { stdout } = await promisify(exec)("which chromium 2>/dev/null || which chromium-browser 2>/dev/null || true");
    const pathOut = stdout.trim();
    if (pathOut) {
      chromiumPath = pathOut;
      logger.info({ chromiumPath }, "Found Chromium via which command");
    }
  } catch (error) {
    logger.debug({ error }, "which chromium failed");
  }

  // If not found, try common locations
  if (!chromiumPath) {
    const commonPaths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/nix/store/*/bin/chromium'];
    for (const p of commonPaths) {
      try {
        // Use `find` to resolve wildcard paths
        if (p.includes('*')) {
          const { stdout } = await promisify(exec)(`find ${p.replace(/\*.*$/, '')} -name chromium -type f 2>/dev/null | head -1`);
          const found = stdout.trim();
          if (found) {
            chromiumPath = found;
            break;
          }
        } else {
          await fs.access(p);
          chromiumPath = p;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (chromiumPath) {
    logger.info({ chromiumPath }, "Using Chromium for Puppeteer");
  } else {
    logger.warn("Could not locate Chromium; Puppeteer will attempt to use its bundled version");
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromiumPath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });

  job.browser = browser;
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  await configureRequestInterception(page, job);

  try {
    while (queue.length > 0 && seen.size < job.maxPages) {
      if (job.cancelRequested) {
        job.status = "cancelled";
        job.message = "Mirror cancelled.";
        logger.info({ jobId: job.id }, "Job cancelled by request");
        return;
      }
      if (job.startedAt && Date.now() - job.startedAt.getTime() > job.timeoutMs) {
        job.timedOut = true;
        logger.info({ jobId: job.id }, "Job timed out");
        break;
      }
      if (job.bytesDownloaded >= job.maxTotalBytes) {
        job.sizeLimitReached = true;
        logger.info({ jobId: job.id }, "Job size limit reached");
        break;
      }

      const queueEntry = queue.shift()!;
      const current = queueEntry.url;
      if (seen.has(current)) continue;
      const currentUrl = new URL(current);
      if (!withinScope(currentUrl, origin, job) || blockedByRobots(currentUrl, robots)) {
        continue;
      }
      seen.add(current);
      job.pagesFound = Math.max(job.pagesFound, seen.size + queue.length);
      job.currentUrl = current;

      try {
        const response = await page.goto(current, { waitUntil: "domcontentloaded" });
        if (!response || !response.ok()) continue;
        const finalUrl = new URL(response.url());
        if (!sameOrigin(finalUrl, origin)) {
          logger.debug({ from: current, to: finalUrl.href, jobId: job.id }, "Skipped page: redirected off-origin");
          continue;
        }
        if (effectiveDelayMs > 0) await sleep(effectiveDelayMs);

        const resources = await page.evaluate(() => {
          const links = new Set<string>();
          const assets = new Set<string>();
          const doc = document;
          const linkElements = doc.querySelectorAll("a[href]");
          linkElements.forEach((el) => {
            const value = el.getAttribute("href");
            if (value) links.add(value);
          });
          const assetElements = doc.querySelectorAll(
            "link[href], img[src], script[src], source[src], video[src], audio[src], iframe[src]",
          );
          assetElements.forEach((el) => {
            const value = el.getAttribute("href") ?? el.getAttribute("src") ?? el.getAttribute("data-src");
            if (value) assets.add(value);
          });
          const srcsetElements = doc.querySelectorAll("img[srcset], source[srcset]");
          srcsetElements.forEach((el) => {
            const value = el.getAttribute("srcset");
            if (!value) return;
            for (const candidate of value.split(",")) {
              const url = candidate.trim().split(/\s+/)[0];
              if (url) assets.add(url);
            }
          });
          return { links: [...links], assets: [...assets] };
        });

        const normalizeResources = (values: string[]) =>
          values
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
            return withinScope(new URL(value), origin, job);
          } catch {
            return false;
          }
        });
        for (const pageUrl of internalPages) {
          if (
            queueEntry.depth < job.maxDepth &&
            !seen.has(pageUrl) &&
            !queuedUrls.has(pageUrl) &&
            queue.length < job.maxPages * MAX_INTERNAL_QUEUE_MULTIPLIER &&
            queuedUrls.size < MAX_QUEUED_URLS_PER_JOB
          ) {
            queue.push({ url: pageUrl, depth: queueEntry.depth + 1 });
            queuedUrls.add(pageUrl);
          } else if (queuedUrls.size >= MAX_QUEUED_URLS_PER_JOB) {
            job.message = `Queue cap (${MAX_QUEUED_URLS_PER_JOB}) reached; not queuing further URLs.`;
            logger.warn({ jobId: job.id }, "Per-job queue cap reached; stopping URL discovery");
          }
        }
        job.pagesFound = Math.max(job.pagesFound, seen.size + queue.length);

        const assetUrls = job.includeAssets
          ? normalizedAssets.filter((value) => {
              try {
                const parsed = new URL(value);
                return withinScope(parsed, origin, job) && shouldSaveResource(parsed);
              } catch {
                return false;
              }
            })
          : [];
        await runWithConcurrency(assetUrls, ASSET_DOWNLOAD_CONCURRENCY, async (assetUrl) => {
          if (job.cancelRequested || job.bytesDownloaded >= job.maxTotalBytes) return;
          try {
            await downloadAsset(job, assetUrl);
          } catch (error) {
            logger.debug({ err: error, assetUrl, jobId: job.id }, "Asset download failed; continuing");
          }
        });

        const html = await page.content();
        await writeFileForUrl(job.outputDir, current, Buffer.from(html));
        job.savedPages.add(current);
        job.pagesDownloaded += 1;
      } catch (error) {
        logger.debug({ err: error, url: current, jobId: job.id }, "Failed to crawl page; continuing");
      }
    }

    if (job.status !== "cancelled") {
      const knownUrls = new Set<string>([...job.savedPages, ...job.downloadedAssets]);
      for (const pageUrl of job.savedPages) {
        if (job.cancelRequested) break;
        await rewriteSavedPageFile(job, pageUrl, knownUrls).catch((error) => {
          logger.debug({ err: error, pageUrl, jobId: job.id }, "Failed to rewrite links for a saved page");
        });
      }
      job.status = "completed";
      const reasons: string[] = [];
      if (job.timedOut) reasons.push("time limit reached");
      if (job.sizeLimitReached) reasons.push("size limit reached");
      const suffix = reasons.length ? ` (stopped early: ${reasons.join(", ")})` : "";
      job.message = `Saved ${job.pagesDownloaded} page${job.pagesDownloaded === 1 ? "" : "s"} and ${job.assetsDownloaded} asset${job.assetsDownloaded === 1 ? "" : "s"}.${suffix}`;
      logger.info({ jobId: job.id, pages: job.pagesDownloaded, assets: job.assetsDownloaded }, "Job completed");
    }
  } finally {
    job.currentUrl = null;
    job.completedAt = new Date().toISOString();
    job.browser = null;
    await browser.close().catch(() => undefined);
    // run a cleanup sweep immediately to enforce retention
    void sweepFinishedJobs().catch(() => undefined);
  }
}

let activeJobCount = 0;
const pendingJobIds: string[] = [];

function maybeStartNext(): void {
  while (activeJobCount < MAX_CONCURRENT_JOBS && pendingJobIds.length > 0) {
    const nextId = pendingJobIds.shift()!;
    const job = jobs.get(nextId);
    if (!job || job.cancelRequested) continue;
    activeJobCount += 1;
    void runJobLifecycle(job).finally(() => {
      activeJobCount -= 1;
      maybeStartNext();
    });
  }
}

async function runJobLifecycle(job: MirrorJobRecord): Promise<void> {
  if (job.cancelRequested) {
    job.status = "cancelled";
    job.message = "Cancelled before it started.";
    job.completedAt = new Date().toISOString();
    logger.info({ jobId: job.id }, "Job cancelled before start");
    return;
  }
  job.status = "running";
  job.startedAt = new Date();
  job.message = "Crawling same-origin pages and assets.";
  logger.info({ jobId: job.id, url: job.url }, "Job started");
  try {
    await runJob(job);
  } catch (error) {
    job.status = job.cancelRequested ? "cancelled" : "failed";
    job.message = error instanceof Error ? error.message : "Mirror failed.";
    job.completedAt = new Date().toISOString();
    logger.warn({ err: error, jobId: job.id }, "Mirror job failed");
    if (job.browser) {
      await job.browser.close().catch(() => undefined);
      job.browser = null;
    }
  }
}

function scheduleJob(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (pendingJobIds.length >= MAX_PENDING_JOB_QUEUE_LENGTH) {
    job.status = "failed";
    job.message = "Server overloaded: too many pending jobs.";
    job.completedAt = new Date().toISOString();
    logger.warn({ jobId: job.id }, "Rejected new job: pending queue full");
    return;
  }
  pendingJobIds.push(id);
  maybeStartNext();
}

let cleanupTimer: NodeJS.Timeout | null = null;

async function sweepFinishedJobs(): Promise<void> {
  const now = Date.now();
  const resolvedRoot = path.resolve(tempRoot) + path.sep;
  for (const [id, job] of jobs) {
    const isFinished = job.status === "completed" || job.status === "failed" || job.status === "cancelled";
    if (!isFinished || !job.completedAt) continue;
    if (now - new Date(job.completedAt).getTime() < JOB_RETENTION_MS) continue;
    try {
      const resolved = path.resolve(job.outputDir) + path.sep;
      if (!resolved.startsWith(resolvedRoot)) {
        logger.warn({ jobId: id, outputDir: job.outputDir }, "Refusing to remove outputDir outside tempRoot");
        jobs.delete(id);
        continue;
      }
      await fs.rm(job.outputDir, { recursive: true, force: true }).catch(() => undefined);
      jobs.delete(id);
      logger.info({ jobId: id }, "Removed finished job and cleaned outputDir");
    } catch (err) {
      logger.debug({ err, jobId: id }, "Failed to sweep finished job");
    }
  }
}

function scheduleCleanupSweep(): void {
  if (cleanupTimer) return;
  const CLEANUP_INTERVAL_MS = Math.max(5 * 60 * 1000, Math.min(JOB_RETENTION_MS, 30 * 60 * 1000));
  cleanupTimer = setInterval(() => {
    void sweepFinishedJobs();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

scheduleCleanupSweep();

// Ensure tempRoot exists and perform an initial sweep on startup
void (async () => {
  try {
    await fs.mkdir(tempRoot, { recursive: true });
    logger.info({ tempRoot }, "Temporary job directory ready");
  } catch (err) {
    logger.error({ err, tempRoot }, "Unable to create temp root for mirror jobs");
  }
  // perform an initial sweep to tidy up old job outputs left over from previous runs
  try {
    await sweepFinishedJobs();
  } catch (err) {
    logger.debug({ err }, "Initial sweepFinishedJobs failed");
  }
})();

export async function createMirrorJob(input: {
  url: string;
  maxPages?: number;
  requestDelayMs?: number;
  respectRobotsTxt?: boolean;
  maxDepth?: number;
  includeAssets?: boolean;
  pathPrefix?: string;
  excludePaths?: string[];
  timeoutMs?: number;
  maxTotalBytes?: number;
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
    timeoutMs: clamp(input.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS, MIN_JOB_TIMEOUT_MS, MAX_JOB_TIMEOUT_MS),
    maxTotalBytes: clamp(input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, MIN_TOTAL_BYTES, HARD_MAX_TOTAL_BYTES),
    maxAssetBytes: MAX_ASSET_BYTES,
    currentUrl: null,
    message: "Waiting to start.",
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    outputDir,
    cancelRequested: false,
    browser: null,
    downloadedAssets: new Set<string>(),
    savedPages: new Set<string>(),
    timedOut: false,
    sizeLimitReached: false,
  };
  jobs.set(id, job);
  logger.info({ jobId: id, url: job.url }, "Created mirror job");
  scheduleJob(id);
  return job;
}

export function getMirrorJob(id: string): MirrorJobRecord | undefined {
  return jobs.get(id);
}

export function listMirrorJobs(limit = 20): MirrorJobRecord[] {
  const capped = clamp(Math.trunc(limit), 1, 100);
  return [...jobs.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, capped);
}

export async function cancelMirrorJob(id: string): Promise<MirrorJobRecord | undefined> {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.status === "queued" || job.status === "running") {
    job.cancelRequested = true;
    job.message = "Cancellation requested.";
    const pendingIndex = pendingJobIds.indexOf(id);
    if (pendingIndex !== -1) {
      pendingJobIds.splice(pendingIndex, 1);
      job.status = "cancelled";
      job.message = "Cancelled before it started.";
      job.completedAt = new Date().toISOString();
    }
    await job.browser?.close().catch(() => undefined);
    logger.info({ jobId: id }, "Cancel requested for job");
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

export async function shutdownMirrorJobs(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  // stop accepting new pending jobs
  pendingJobIds.length = 0;
  // close browsers
  await Promise.all([...jobs.values()].map((job) => job.browser?.close().catch(() => undefined)));
  // optionally remove very old outputs (best-effort)
  try {
    await sweepFinishedJobs();
  } catch {
    // ignore
  }
}
