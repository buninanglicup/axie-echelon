import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { getCachedPage, setCachedPage } from "./leaderboardCaches.js";
import { fetchAndEnrichLeaderboard, schedulePageRefresh } from "./leaderboardEnrichment.js";
import { resolveLeaderboardScope } from "../seasonRoutes.js";
import { MAX_LEADERBOARD_REQUEST_SIZE } from "./leaderboardConstants.js";
import { getLeaderboardScopeKey } from "../../leaderboard/leaderboardScope.js";

const router = express.Router();

// Legacy eager enrichment route retained until the frontend migration to the
// pool/team endpoints is complete.
router.get("/api/leaderboard", async (request, response) => {
  try {
    const limit = Math.min(MAX_LEADERBOARD_REQUEST_SIZE, Math.max(1, Number(request.query.limit) || 20));
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const leaderboardScope = resolveLeaderboardScope(request);
    const liveMode = (request.query.liveMode || "false").toLowerCase() === "true";
    const cacheKey = `leaderboard_${getLeaderboardScopeKey(leaderboardScope)}_${limit}_${offset}`;

    if (liveMode) {
      if (DEBUG_ON) console.log(`[/api/leaderboard] LIVE MODE: bypassing page cache for ${cacheKey}`);
      const payload = await fetchAndEnrichLeaderboard(limit, offset, leaderboardScope, true);
      setCachedPage(cacheKey, payload);
      return response.json(payload);
    }

    const cached = getCachedPage(cacheKey);
    if (cached) {
      schedulePageRefresh(cacheKey, limit, offset, leaderboardScope);
      return response.json(cached);
    }

    const payload = await fetchAndEnrichLeaderboard(limit, offset, leaderboardScope);
    setCachedPage(cacheKey, payload);
    return response.json(payload);
  } catch (error) {
    console.error("[/api/leaderboard] Error:", error.message);
    response.status(500).json({ error: "Failed to fetch enriched leaderboard" });
  }
});

export default router;
