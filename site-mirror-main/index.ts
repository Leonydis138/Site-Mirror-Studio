import app from "./app";
import { logger } from "./server/logger";
import { shutdownMirrorJobs } from "./server/mirror-jobs";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Site Mirror server listening on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    logger.info("HTTP server closed.");
    await shutdownMirrorJobs();
    logger.info("All mirror jobs cleaned up.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
