import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Most routes are cache-served reads, so this stays generous -- it's a
// backstop against pathological/scripted traffic, not normal usage.
export const baselineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
});

// Stricter budget for the two routes that trigger real upstream cost per
// request: on-demand team enrichment (leaderboardEnrichmentRoutes.js) and
// a cache-miss address lookup (axieRoutes.js, post-Task-B cache).
export const expensiveRouteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests to this endpoint. Please slow down." }
});

// liveMode=true (leaderboardLegacyRoutes.js) turns a single request into a
// recurring client-side poll. A per-request limiter alone can't catch that
// -- a legit poller looks identical to many individually-innocuous
// requests. This gives liveMode traffic its own hourly budget, sized just
// above one normal polling session (~120-140 calls/hr at the recommended
// 20-30s interval, per docs/planning/cache-and-polling-strategy.md), so it
// catches runaway polling / multiple tabs without punishing normal use.
export const liveModeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => `${ipKeyGenerator(request.ip)}:liveMode`,
  skip: (request) => String(request.query.liveMode ?? "").toLowerCase() !== "true",
  message: { error: "Live mode polling limit reached for this hour. Try a longer polling interval." }
});