import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import mirrorRoutes from "./routes/mirror.js";
import { logger } from "./logger.js";

const app = express();

app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/mirror", mirrorRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
