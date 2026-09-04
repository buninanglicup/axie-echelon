import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { runeRegistry } from "./runeCatalog.js";
import { scanLeaderboardForRune } from "./runeScanner.js";
import { resolveEraMilestone } from "../seasonRoutes.js";
import { CandidatePoolUnavailableError } from "./leaderboardCandidates.js";

const router = express.Router();

router.get("/api/leaderboard/rune/:runeId", async (request, response) => {
  try {
    const runeId = String(request.params.runeId || "").trim();
    if (!runeId) {
      return response.status(400).json({ error: "runeId is required.", code: "RUNE_ID_REQUIRED" });
    }
    const eraMilestone = resolveEraMilestone(request);
    const rankMin = Math.max(1, Number(request.query.rankMin) || 1);
    const requestedRankMax = Math.max(rankMin, Number(request.query.rankMax) || LEADERBOARD_MAX_RANK);
    const rankMax = Math.min(requestedRankMax, LEADERBOARD_MAX_RANK);
    const name = typeof request.query.name === "string" ? request.query.name.trim() : "";
    const queryRuneIds = Array.isArray(request.query.runeId)
      ? request.query.runeId
      : request.query.runeId
        ? [request.query.runeId]
        : [];
    const runeIds = [...new Set([runeId, ...queryRuneIds].map(String).map((value) => value.trim()).filter(Boolean))];

    if (DEBUG_ON) console.log(`[/api/leaderboard/rune] Scanning ranks ${rankMin}-${rankMax} for rune=${runeId} eraMilestone=${eraMilestone}`);

    const players = await scanLeaderboardForRune(runeIds, eraMilestone, { rankMin, rankMax, name });

    response.json({
      players,
      runeId,
      runeIds,
      milestone: eraMilestone,
      rankMin,
      rankMax,
      name,
      scannedRanks: LEADERBOARD_MAX_RANK
    });
  } catch (error) {
    console.error("[/api/leaderboard/rune] Error:", error.message);
    if (error instanceof CandidatePoolUnavailableError || error.code === "LEADERBOARD_UPSTREAM_UNAVAILABLE") {
      response.set("Retry-After", String(error.retryAfterSeconds ?? 5));
      response.status(503).json({
        error: "Leaderboard upstream is temporarily unavailable.",
        code: "LEADERBOARD_UPSTREAM_UNAVAILABLE"
      });
      return;
    }
    response.status(500).json({ error: "Failed to scan leaderboard for rune.", code: "RUNE_SCAN_FAILED" });
  }
});

router.get("/api/runes", (request, response) => {
  response.json({ runes: Object.values(runeRegistry) });
});

export default router;