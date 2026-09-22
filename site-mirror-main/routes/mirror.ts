import { Router } from "express";
import {
  createMirrorJob,
  getMirrorJob,
  listMirrorJobs,
  cancelMirrorJob,
  streamMirrorZip,
  getPublicMirrorJob,
} from "../server/mirror-jobs";
import { rateLimiter } from "../middleware/rateLimiter";
import { logger } from "../server/logger";

const router = Router();

// Apply a per-IP rate limit to all mirror endpoints (20 requests per minute)
router.use(rateLimiter({ windowMs: 60 * 1000, max: 20 }));

// POST /mirror/jobs – start a new mirror
router.post("/jobs", async (req, res) => {
  try {
    const job = await createMirrorJob(req.body);
    res.status(201).json(getPublicMirrorJob(job));
  } catch (error) {
    logger.error({ err: error, body: req.body }, "Failed to create mirror job");
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
  }
});

// GET /mirror/jobs – list recent jobs
router.get("/jobs", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const jobs = listMirrorJobs(limit);
    res.json({ jobs: jobs.map(getPublicMirrorJob) });
  } catch (error) {
    logger.error({ err: error, query: req.query }, "Failed to list mirror jobs");
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

// GET /mirror/jobs/:id – get a single job
router.get("/jobs/:id", async (req, res) => {
  try {
    const job = getMirrorJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(getPublicMirrorJob(job));
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "Failed to get mirror job");
    res.status(500).json({ error: "Failed to get job" });
  }
});

// DELETE /mirror/jobs/:id – cancel a job
router.delete("/jobs/:id", async (req, res) => {
  try {
    const job = await cancelMirrorJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(getPublicMirrorJob(job));
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "Failed to cancel mirror job");
    res.status(500).json({ error: "Failed to cancel job" });
  }
});

// GET /mirror/jobs/:id/zip – download the mirror archive
router.get("/jobs/:id/zip", async (req, res) => {
  try {
    const job = getMirrorJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "completed") {
      return res.status(409).json({ error: "Mirror not yet completed" });
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="mirror-${job.id}.zip"`);
    await streamMirrorZip(job, res);
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "Failed to stream mirror zip");
    res.status(500).json({ error: "Failed to generate zip" });
  }
});

export default router;
