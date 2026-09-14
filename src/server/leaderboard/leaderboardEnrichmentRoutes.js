import express from "express";
import { getOrFetchPlayerEnrichment } from "./enrichmentCache.js";
import { resolveLeaderboardScope } from "../seasonRoutes.js";
import { getHistoricalSnapshotEnrichment } from "../snapshots/snapshotReader.js";
import { cleanUserId } from "../shared/validators.js";
import { createExpensiveRouteLimiter } from "../shared/rateLimiters.js";

const expensiveRouteLimiter = createExpensiveRouteLimiter();

export function createLeaderboardEnrichmentRouter({
  getLiveEnrichment = getOrFetchPlayerEnrichment,
  getSnapshotEnrichment = getHistoricalSnapshotEnrichment
} = {}) {
  const router = express.Router();

  router.get("/api/leaderboard/team/:userID", expensiveRouteLimiter, async (request, response) => {
    try {
      let userID;
      try {
        userID = cleanUserId(request.params.userID);
      } catch (validationError) {
        return response.status(400).json({ error: validationError.message });
      }
      const leaderboardScope = resolveLeaderboardScope(request);
      if (request.query.historical === "1") {
        return response.json(await getSnapshotEnrichment({ userID, leaderboardScope }));
      }
      const priority = request.query.priority === "low" ? "low" : "high";
      const enrichment = await getLiveEnrichment(userID, priority, leaderboardScope);
      response.json(enrichment);
    } catch (error) {
      console.error("[/api/leaderboard/team] Error:", error.message);
      response.status(500).json({ error: "Failed to fetch player team." });
    }
  });

  return router;
}

export default createLeaderboardEnrichmentRouter();