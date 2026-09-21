import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import { createRequire } from "node:module";
import type { MirrorJobRecord, MirrorArchiveManifest } from "./mirror-types";

const require = createRequire(import.meta.url);
const unzipper = require("unzipper") as {
  Parse: (options?: { forceStream?: boolean }) => NodeJS.ReadWriteStream;
};

export async function writeArchiveReports(job: MirrorJobRecord): Promise<void> {
  const outcomes = [...job.outcomes.values()].sort((a, b) => a.url.localeCompare(b.url));
  const summary = {
    discovered: job.pagesFound,
    pagesSaved: job.pagesDownloaded,
    pagesSkipped: job.pagesSkipped,
    pagesFailed: job.pagesFailed,
    assetsSaved: job.assetsDownloaded,
    assetsSkipped: job.assetsSkipped,
    assetsFailed: job.assetsFailed,
    bytesDownloaded: job.bytesDownloaded,
    timedOut: job.timedOut,
    sizeLimitReached: job.sizeLimitReached,
  };
  const manifest: MirrorArchiveManifest = {
    schemaVersion: 1,
    jobId: job.id,
    sourceUrl: job.url,
    configuration: {
      maxPages: job.maxPages,
      maxDepth: job.maxDepth,
      includeAssets: job.includeAssets,
      pathPrefix: job.pathPrefix,
      excludePaths: job.excludePaths,
      respectRobotsTxt: job.respectRobotsTxt,
      requestDelayMs: job.requestDelayMs,
      timeoutMs: job.timeoutMs,
      maxTotalBytes: job.maxTotalBytes,
    },
    summary,
    redirects: Object.fromEntries(job.redirects),
    outcomes,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: job.status,
    summary,
    warnings: outcomes
      .filter((outcome) => outcome.status !== "saved")
      .map(({ url, kind, status, reason, httpStatus, finalUrl }) => ({
        url,
        kind,
        status,
        reason,
        httpStatus,
        finalUrl,
      })),
  };
  const readme = [
    "Site Mirror archive",
    "",
    `Source: ${job.url}`,
    `Status: ${job.status}`,
    "",
    "Open pages/ for saved HTML documents and assets/ for downloaded resources.",
    "manifest.json contains machine-readable URL and file metadata.",
    "report.json lists skipped and failed resources with reasons.",
    "Only archive sites you own or have explicit permission to copy.",
    "",
  ].join("\n");

  await Promise.all([
    fs.writeFile(path.join(job.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2)),
    fs.writeFile(path.join(job.outputDir, "report.json"), JSON.stringify(report, null, 2)),
    fs.writeFile(path.join(job.outputDir, "README.txt"), readme),
  ]);
}

export async function createArchiveFile(job: MirrorJobRecord, tempRoot: string): Promise<{ file: string; bytes: number }> {
  const file = path.join(tempRoot, `${job.id}.zip`);
  await fs.rm(file, { force: true }).catch(() => undefined);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(file);
    const archive = archiver("zip", { zlib: { level: 9 } });
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    output.once("close", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.once("error", fail);
    archive.once("error", fail);
    archive.pipe(output);
    archive.directory(job.outputDir, false);
    void archive.finalize().catch(fail);
  });

  const stats = await fs.stat(file);
  return { file, bytes: stats.size };
}

export function previewPathIsInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function safePreviewEntryPath(root: string, entryPath: string): string {
  const normalized = entryPath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("The mirror archive contains an invalid preview path.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("The mirror archive contains an unsafe preview path.");
  }
  const candidate = path.resolve(root, ...segments.filter(Boolean));
  if (!previewPathIsInsideRoot(root, candidate)) {
    throw new Error("The mirror archive contains an unsafe preview path.");
  }
  return candidate;
}

type PreviewZipEntry = NodeJS.ReadableStream & {
  path: string;
  type: string;
  autodrain: () => void;
};

export async function extractMirrorPreviewArchive(job: MirrorJobRecord, archiveSource: NodeJS.ReadableStream): Promise<string> {
  const root = path.resolve(job.outputDir);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });

  const parser = unzipper.Parse({ forceStream: true }) as NodeJS.ReadWriteStream & AsyncIterable<PreviewZipEntry>;
  archiveSource.pipe(parser);
  try {
    for await (const entry of parser) {
      const target = safePreviewEntryPath(root, entry.path);
      if (entry.type === "Directory" || entry.path.endsWith("/") || entry.path.endsWith("\\")) {
        entry.autodrain();
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      if (entry.type !== "File") {
        entry.autodrain();
        throw new Error("The mirror archive contains an unsupported preview entry.");
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await pipeline(entry, createWriteStream(target));
    }
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return root;
}
