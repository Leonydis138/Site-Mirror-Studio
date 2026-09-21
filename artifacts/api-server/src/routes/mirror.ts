import { promises as fs } from "node:fs";
import { Router, type IRouter, type Request, type Response } from "express";
import { getMirrorJob } from "../lib/mirror-jobs";
import { MIRROR_PREVIEW_CSP } from "../lib/mirror-preview-policy";
import { gameServicePayload, injectGameRuntimeIntoHtml, normalizeGameServiceName } from "../lib/mirror-game-services";

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
    if (file.toLowerCase().endsWith(".html") || file.toLowerCase().endsWith(".htm")) {
      const html = await fs.readFile(file, "utf8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", MIRROR_PREVIEW_CSP);
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return void res.send(injectGameRuntimeIntoHtml(html, job.id));
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", MIRROR_PREVIEW_CSP);
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return void res.sendFile(file);
  } catch (error) {
    req.log.error({ err: error, jobId: job.id, requestedPath }, "Failed to serve mirror preview");
    res.status(404).json({ error: "The preview file is not available." });
  }
}

router.get("/mirror-jobs/:id/preview/services", (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  res.json({ services: ["auth", "session", "leaderboard", "save", "config", "status", "matchmaking", "chat", "store"] });
});

router.get("/mirror-jobs/:id/preview/services/:service", (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  const service = normalizeGameServiceName(req.params.service ?? "");
  if (!service) return void res.status(404).json({ error: "Unknown game service." });
  res.json(gameServicePayload(service, job.id));
});

router.get("/mirror-jobs/:id/preview/runtime.js", (req, res) => {
  const job = getMirrorJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Mirror job not found." });
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(`window.__SITE_MIRROR_RUNTIME__ = ${JSON.stringify({ jobId: job.id, apiBase: `/api/mirror-jobs/${job.id}/preview/services` })};\n` + (() => { const { buildGameRuntimeScript } = require('../lib/mirror-game-services'); return buildGameRuntimeScript(job.id); })());
});

export default router;
