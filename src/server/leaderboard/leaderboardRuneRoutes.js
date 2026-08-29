import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { runeRegistry } from "./runeCatalog.js";
import { scanLeaderboardForRune } from "./runeScanner.js";
import { resolveEraMilestone } from "../seasonRoutes.js";

const router = express.Router();

router.get("/api/leaderboard/rune/:runeId", async (request, response) => {
  try {
    const runeId = String(request.params.runeId || "").trim();
    if (!runeId) {
      return response.status(400).json({ error: "runeId is required." });
    }
    const eraMilestone = resolveEraMilestone(request);

    if (DEBUG_ON) console.log(`[/api/leaderboard/rune] Scanning ranks 1-${LEADERBOARD_MAX_RANK} for rune=${runeId} eraMilestone=${eraMilestone}`);

    const players = await scanLeaderboardForRune(runeId, eraMilestone);

    response.json({
      players,
      runeId,
      milestone: eraMilestone,
      scannedRanks: LEADERBOARD_MAX_RANK
    });
  } catch (error) {
    console.error("[/api/leaderboard/rune] Error:", error.message);
    response.status(500).json({ error: "Failed to scan leaderboard for rune." });
  }
});

router.get("/api/runes", (request, response) => {
  response.json({ runes: Object.values(runeRegistry) });
});

export default router;