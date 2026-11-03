import type { RequestHandler } from "express";
// Lightweight per-process protection for local MVP. Not a distributed rate limiter.
// Production multi-instance deployments MUST use gateway/WAF or shared Redis limits.
const attempts = new Map<string, { count: number; resetAt: number }>();
export const authRateLimit: RequestHandler = (req, res, next) => {
  const key = String(req.ip ?? req.socket.remoteAddress ?? "unknown");
  const now = Date.now();
  let item = attempts.get(key);
  if (!item || item.resetAt < now) item = { count: 0, resetAt: now + 15 * 60_000 };
  item.count += 1;
  attempts.set(key, item);
  if (item.count > 20) return res.status(429).json({ code: "RATE_LIMIT", message: "Too many authentication attempts" });
  next();
};
