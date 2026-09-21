import { promises as fs } from "node:fs";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CancelMirrorJobParams, CreateMirrorJobBody, DownloadMirrorJobParams, GetMirrorJobParams, ListMirrorJobsQueryParams,
} from "@workspace/api-zod";
import {
  cancelMirrorJob, createMirrorJob, findActiveMirrorJob, findRecentEquivalentMirrorJob, getMirrorArchiveFiles,
  getMirrorArchiveIntegrity, getMirrorArchiveManifest, getMirrorJob, getMirrorPreviewFile, getMirrorPreviewStartPath,
  getPublicMirrorJob, listMirrorJobs, retryMirrorJob, resumeMirrorJob, streamMirrorZip,
} from "../lib/mirror-jobs";
import { MIRROR_PREVIEW_CSP } from "../lib/mirror-preview-policy";
import { buildGameRuntimeScript, gameServicePayload, GAME_SERVICE_NAMES, injectGameRuntimeIntoHtml, normalizeGameServiceName } from "../lib/mirror-game-services";
import { createJobLimiter } from "../middlewares/rate-limit";

const router: IRouter = Router();

function jobFrom(req: Request) { return getMirrorJob(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id); }
function previewHeaders(res: Response) { res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Security-Policy", MIRROR_PREVIEW_CSP); res.setHeader("Cross-Origin-Resource-Policy", "same-origin"); res.setHeader("X-Content-Type-Options", "nosniff"); }

async function servePreview(req: Request, res: Response): Promise<void> {
  const job = jobFrom(req);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  if (!["completed", "completed_with_warnings"].includes(job.status)) return void res.status(409).json({ error: "The mirror is not complete yet." });
  if (!job.archiveKey) return void res.status(404).json({ error: "The mirror preview is no longer available." });
  const requested = Array.isArray(req.params.previewPath) ? req.params.previewPath.join("/") : req.params.previewPath;
  if (!requested) {
    const start = getMirrorPreviewStartPath(job);
    if (!start) return void res.status(404).json({ error: "The mirrored starting page is not available." });
    return void res.redirect(`/api/mirror-jobs/${job.id}/preview/${start.split("/").map(encodeURIComponent).join("/")}`);
  }
  try {
    const file = await getMirrorPreviewFile(job, requested);
    previewHeaders(res);
    if (/\.html?$/i.test(file)) return void res.send(injectGameRuntimeIntoHtml(await fs.readFile(file, "utf8"), job.id));
    res.sendFile(file);
  } catch (error) {
    req.log.error({ err: error, jobId: job.id, requested }, "Failed to serve mirror preview");
    res.status(404).json({ error: "The preview file is not available." });
  }
}

router.get("/mirror-jobs/:id/preview/services", (req, res) => {
  const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  res.json({ ok: true, services: GAME_SERVICE_NAMES });
});
router.get("/mirror-jobs/:id/preview/services/:service", (req, res) => {
  const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  const service = normalizeGameServiceName(req.params.service ?? "");
  if (!service) return void res.status(404).json({ error: "Unknown game service." });
  res.json(gameServicePayload(service, job.id));
});
router.get("/mirror-jobs/:id/preview/runtime.js", (req, res) => {
  const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  previewHeaders(res); res.type("application/javascript").send(buildGameRuntimeScript(job.id));
});

router.get("/mirror-jobs", (req, res) => { const parsed = ListMirrorJobsQueryParams.safeParse(req.query); res.json({ jobs: listMirrorJobs(parsed.success ? parsed.data.limit : undefined).map(getPublicMirrorJob) }); });
router.post("/mirror-jobs", createJobLimiter, async (req, res) => {
  const parsed = CreateMirrorJobBody.safeParse(req.body); if (!parsed.success) return void res.status(400).json({ error: "Check the URL and crawl settings." });
  try {
    const duplicate = findActiveMirrorJob(parsed.data.url) ?? findRecentEquivalentMirrorJob(parsed.data.url);
    if (duplicate) return void res.status(409).json({ error: "A mirror for this starting URL already exists.", existingJobId: duplicate.id });
    res.status(202).json(getPublicMirrorJob(await createMirrorJob(parsed.data)));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to start mirror." }); }
});
router.get("/mirror-jobs/:id", (req, res) => { const parsed = GetMirrorJobParams.safeParse(req.params); const job = parsed.success ? getMirrorJob(parsed.data.id) : undefined; if (!job) return void res.status(404).json({ error: "Mirror job not found." }); res.json(getPublicMirrorJob(job)); });
router.post("/mirror-jobs/:id/cancel", async (req, res) => { const parsed = CancelMirrorJobParams.safeParse(req.params); const job = parsed.success ? await cancelMirrorJob(parsed.data.id) : undefined; if (!job) return void res.status(404).json({ error: "Mirror job not found." }); res.json(getPublicMirrorJob(job)); });
router.post("/mirror-jobs/:id/retry", async (req, res) => { const parsed = GetMirrorJobParams.safeParse(req.params); if (!parsed.success) return void res.status(404).json({ error: "Mirror job not found." }); const job = await retryMirrorJob(parsed.data.id); if (!job) return void res.status(404).json({ error: "Mirror job not found." }); res.status(202).json(getPublicMirrorJob(job)); });
router.post("/mirror-jobs/:id/resume", async (req, res) => { const parsed = GetMirrorJobParams.safeParse(req.params); if (!parsed.success) return void res.status(404).json({ error: "Mirror job not found." }); const job = await resumeMirrorJob(parsed.data.id); if (!job) return void res.status(404).json({ error: "Mirror job not found." }); res.status(202).json(getPublicMirrorJob(job)); });
router.get("/mirror-jobs/:id/events", (req, res) => { const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." }); res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.flushHeaders?.(); const send = () => { if (!res.writableEnded) res.write(`event: snapshot\ndata: ${JSON.stringify(getPublicMirrorJob(job))}\n\n`); }; send(); const timer = setInterval(send, 2000); req.on("close", () => clearInterval(timer)); });

router.get("/mirror-jobs/:id/archive/manifest", async (req, res) => { const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." }); if (!job.archiveKey) return void res.status(409).json({ error: "The mirror archive is not ready." }); try { res.json(await getMirrorArchiveManifest(job)); } catch { res.status(500).json({ error: "The mirror manifest could not be read." }); } });
router.get("/mirror-jobs/:id/archive/files", async (req, res) => { const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." }); if (!job.archiveKey) return void res.status(409).json({ error: "The mirror archive is not ready." }); try { const manifest = await getMirrorArchiveManifest(job); const files = getMirrorArchiveFiles(manifest, { search: typeof req.query.search === "string" ? req.query.search : undefined, kind: typeof req.query.kind === "string" ? req.query.kind : undefined, status: typeof req.query.status === "string" ? req.query.status : undefined }); res.json({ files, total: files.length }); } catch { res.status(500).json({ error: "The mirror file list could not be read." }); } });
router.get("/mirror-jobs/:id/archive/integrity", async (req, res) => { const job = jobFrom(req); if (!job) return void res.status(404).json({ error: "Mirror job not found." }); if (!job.archiveKey) return void res.status(409).json({ error: "The mirror archive is not ready." }); try { res.json(await getMirrorArchiveIntegrity(job)); } catch { res.status(500).json({ error: "The mirror integrity report could not be read." }); } });
router.get("/mirror-jobs/:id/preview", servePreview);
router.get("/mirror-jobs/:id/preview/{*previewPath}", servePreview);
router.get("/mirror-jobs/:id/download", async (req, res) => { const parsed = DownloadMirrorJobParams.safeParse(req.params); const job = parsed.success ? getMirrorJob(parsed.data.id) : undefined; if (!job) return void res.status(404).json({ error: "Mirror job not found." }); if (!["completed", "completed_with_warnings"].includes(job.status)) return void res.status(409).json({ error: "The mirror is not complete yet." }); res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Disposition", `attachment; filename="site-mirror-${job.id.slice(0, 8)}.zip"`); try { await streamMirrorZip(job, res); } catch { if (!res.headersSent) res.status(500).json({ error: "Unable to create the archive." }); } });

export default router;
