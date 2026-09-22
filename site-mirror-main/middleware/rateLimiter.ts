import { Request, Response, NextFunction } from "express";

type RateLimitConfig = {
  windowMs: number;
  max: number;
};

type ClientRecord = {
  count: number;
  resetAt: number;
};

const clients = new Map<string, ClientRecord>();

export function rateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const record = clients.get(ip);

    if (!record || record.resetAt < now) {
      clients.set(ip, { count: 1, resetAt: now + config.windowMs });
      return next();
    }

    if (record.count >= config.max) {
      res.setHeader("Retry-After", Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({
        error: "Too many requests, please slow down.",
      });
    }

    record.count += 1;
    next();
  };
}

// Optional: clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of clients) {
    if (record.resetAt < now) clients.delete(ip);
  }
}, 60 * 1000);
