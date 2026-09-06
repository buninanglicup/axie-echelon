import express from "express";
import { getOrFetchPlayerEnrichment } from "./enrichmentCache.js";
import { resolveLeaderboardScope } from "../seasonRoutes.js";
import { getHistoricalSnapshotEnrichment } from "../snapshots/snapshotReader.js";

export function createLeaderboardEnrichmentRouter({
  getLiveEnrichment = getOrFetchPlayerEnrichment,
  getSnapshotEnrichment = getHistoricalSnapshotEnrichment
} = {}) {
  const router = express.Router();

  router.get("/api/leaderboard/team/:userID", async (request, response) => {
    try {
      const userID = String(request.params.userID || "").trim();
      if (!userID) {
        return response.status(400).json({ error: "userID is required." });
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
