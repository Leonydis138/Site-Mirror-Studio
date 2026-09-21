import { Router, type IRouter, type Request, type Response } from "express";
import {
  CancelMirrorJobParams,
  CreateMirrorJobBody,
  DownloadMirrorJobParams,
  GetMirrorJobParams,
  ListMirrorJobsQueryParams,
} from "@workspace/api-zod";
import {
  cancelMirrorJob,
  createMirrorJob,
  findActiveMirrorJob,
  findRecentEquivalentMirrorJob,
  getMirrorArchiveFiles,
  getMirrorArchiveIntegrity,
  getMirrorArchiveManifest,
  getMirrorJob,
  getMirrorPreviewFile,
  getMirrorPreviewStartPath,
  getPublicMirrorJob,
  listMirrorJobs,
  retryMirrorJob,
  resumeMirrorJob,
  streamMirrorZip,
} from "../lib/mirror-jobs";
import { MIRROR_PREVIEW_CSP } from "../lib/mirror-preview-policy";
import { createJobLimiter } from "../middlewares/rate-limit";

const router: IRouter = Router();

async function serveMirrorPreview(req: Request, res: Response): Promise<void> {
  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getMirrorJob(jobId);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (job.status !== "completed" && job.status !== "completed_with_warnings") {
    return void res.status(409).json({ error: "The mirror is not complete yet." });
  }
  if (!job.archiveKey) return void res.status(404).json({ error: "The mirror preview is no longer available." });

  const requestedPath = Array.isArray(req.params.previewPath)
    ? req.params.previewPath.join("/")
    : req.params.previewPath;
  if (!requestedPath) {
    const startPath = getMirrorPreviewStartPath(job);
    if (!startPath) return void res.status(404).json({ error: "The mirrored starting page is not available." });
    const encodedPath = startPath.split("/").map(encodeURIComponent).join("/");
    return void res.redirect(`/api/mirror-jobs/${job.id}/preview/${encodedPath}`);
  }

  try {
    const file = await getMirrorPreviewFile(job, requestedPath);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", MIRROR_PREVIEW_CSP);
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(file);
  } catch (error) {
    req.log.error({ err: error, jobId: job.id, requestedPath }, "Failed to serve mirror preview");
    res.status(404).json({ error: "The preview file is not available." });
  }
}

router.get("/mirror-jobs", (req, res) => {
  const parsed = ListMirrorJobsQueryParams.safeParse(req.query);
  res.json({ jobs: listMirrorJobs(parsed.success ? parsed.data.limit : undefined).map(getPublicMirrorJob) });
});

router.post("/mirror-jobs", createJobLimiter, async (req, res) => {
  const parsed = CreateMirrorJobBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Check the URL and crawl settings." });
  try {
    const duplicate = findActiveMirrorJob(parsed.data.url) ?? findRecentEquivalentMirrorJob(parsed.data.url);
    if (duplicate) {
      return void res.status(409).json({
        error: duplicate.status === "queued" || duplicate.status === "running"
          ? "A mirror for this starting URL is already running."
          : "A recent mirror for this starting URL already exists. Open it or start another run explicitly.",
        existingJobId: duplicate.id,
      });
    }
    res.status(202).json(getPublicMirrorJob(await createMirrorJob(parsed.data)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to start mirror." });
  }
});

router.get("/mirror-jobs/:id", (req, res) => {
  const parsed = GetMirrorJobParams.safeParse(req.params);
  const job = parsed.success ? getMirrorJob(parsed.data.id) : undefined;
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  res.json(getPublicMirrorJob(job));
});

router.post("/mirror-jobs/:id/cancel", async (req, res) => {
  const parsed = CancelMirrorJobParams.safeParse(req.params);
  const job = parsed.success ? await cancelMirrorJob(parsed.data.id) : undefined;
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  res.json(getPublicMirrorJob(job));
});

router.post("/mirror-jobs/:id/retry", async (req, res) => {
  const parsed = GetMirrorJobParams.safeParse(req.params);
  if (!parsed.success) return void res.status(404).json({ error: "Mirror job not found." });
  const job = await retryMirrorJob(parsed.data.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (job.id === parsed.data.id && (job.status === "queued" || job.status === "running")) {
    return void res.status(409).json({ error: "This mirror is already running.", existingJobId: job.id });
  }
  res.status(202).json(getPublicMirrorJob(job));
});

router.post("/mirror-jobs/:id/resume", async (req, res) => {
  const parsed = GetMirrorJobParams.safeParse(req.params);
  if (!parsed.success) return void res.status(404).json({ error: "Mirror job not found." });
  const job = await resumeMirrorJob(parsed.data.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (job.status === "completed" || job.status === "completed_with_warnings") {
    return void res.status(409).json({ error: "This mirror is already complete." });
  }
  res.status(202).json(getPublicMirrorJob(job));
});

router.get("/mirror-jobs/:id/events", (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = () => { if (!res.writableEnded) res.write(`event: snapshot\ndata: ${JSON.stringify(getPublicMirrorJob(job))}\n\n`); };
  send();
  const timer = setInterval(send, 2000);
  req.on("close", () => clearInterval(timer));
});

router.get("/mirror-jobs/:id/archive/manifest", async (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (!job.archiveKey) return void res.status(409).json({ error: "The mirror archive is not ready." });
  try { res.json(await getMirrorArchiveManifest(job)); }
  catch (error) { req.log.error({ err: error, jobId: job.id }, "Failed to read mirror manifest"); res.status(500).json({ error: "The mirror manifest could not be read." }); }
});

router.get("/mirror-jobs/:id/archive/files", async (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (!job.archiveKey) return void res.status(409).json({ error: "The mirror archive is not ready." });
  try {
    const manifest = await getMirrorArchiveManifest(job);
    const files = getMirrorArchiveFiles(manifest, {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    });
    res.json({ files, total: files.length });
  } catch (error) { req.log.error({ err: error, jobId: job.id }, "Failed to list mirror files"); res.status(500).json({ error: "The mirror file list could not be read." }); }
});

router.get("/mirror-jobs/:id/archive/integrity", async (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (!job.archiveKey) return void res.status(409).json({ error: "The mirror archive is not ready." });
  try { res.json(await getMirrorArchiveIntegrity(job)); }
  catch (error) { req.log.error({ err: error, jobId: job.id }, "Failed to inspect mirror integrity"); res.status(500).json({ error: "The mirror integrity report could not be read." }); }
});

router.get("/mirror-jobs/:id/preview", serveMirrorPreview);
router.get("/mirror-jobs/:id/preview/{*previewPath}", serveMirrorPreview);

router.get("/mirror-jobs/:id/download", async (req, res) => {
  const parsed = DownloadMirrorJobParams.safeParse(req.params);
  const job = parsed.success ? getMirrorJob(parsed.data.id) : undefined;
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (job.status !== "completed" && job.status !== "completed_with_warnings") return void res.status(409).json({ error: "The mirror is not complete yet." });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="site-mirror-${job.id.slice(0, 8)}.zip"`);
  try { await streamMirrorZip(job, res); }
  catch (error) { req.log.error({ err: error, jobId: job.id }, "Failed to stream mirror archive"); if (!res.headersSent) res.status(500).json({ error: "Unable to create the archive." }); }
});

export default router;
