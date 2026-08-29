import express from "express";
import { getOrFetchPlayerEnrichment } from "./enrichmentCache.js";

const router = express.Router();

router.get("/api/leaderboard/team/:userID", async (request, response) => {
  try {
    const userID = String(request.params.userID || "").trim();
    if (!userID) {
      return response.status(400).json({ error: "userID is required." });
    }
    const priority = request.query.priority === "low" ? "low" : "high";
    const enrichment = await getOrFetchPlayerEnrichment(userID, priority);
    response.json(enrichment);
  } catch (error) {
    console.error("[/api/leaderboard/team] Error:", error.message);
    response.status(500).json({ error: "Failed to fetch player team." });
  }
});

export default router;