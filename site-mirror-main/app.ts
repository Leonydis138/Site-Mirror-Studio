import express from "express";
import helmet from "helmet";
import cors from "cors";
import mirrorRoutes from "./routes/mirror";
import { logger } from "./server/logger";

const app = express();

// Security headers
app.use(helmet());

// CORS (adjust as needed)
app.use(cors());

// JSON & URL‑encoded body parsers with size limits
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Mirror API routes
app.use("/mirror", mirrorRoutes);

// Health check / root
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
