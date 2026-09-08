import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { getPlayerBattleLogPage } from "./profileBattleLogs.js";
const PROFILE_BATTLE_LOG_LIMIT = 20;

const router = express.Router();

// GET /api/profile/:identifier/battle-logs?limit=20&milestone=&seasonId=&offSeasonMode=
// The identifier is a user ID for now; Ronin-address resolution will use the
// same profile resource once that lookup path is added.
async function handleProfileBattleLogs(request, response) {
  const userID = request.params.identifier || request.params.userID;
  if (!userID) return response.status(400).json({ error: "userID is required." });

  let leaderboardScope = null;
  if (request.query.milestone !== undefined || request.query.seasonId !== undefined || request.query.offSeasonMode !== undefined) {
    leaderboardScope = {
      milestone: request.query.milestone,
      seasonId: request.query.seasonId,
      offSeasonMode: request.query.offSeasonMode === "true"
    };
  }

  try {
    const result = await getPlayerBattleLogPage({
      userID,
      leaderboardScope,
      requestedFetchLimit: PROFILE_BATTLE_LOG_LIMIT
    });
    if (result.status === "unavailable") return response.status(404).json(result);
    if (result.status === "error") return response.status(502).json(result);
    return response.json(result);
  } catch (error) {
    if (DEBUG_ON) console.error(`[profileRoutes] Error for userID=${userID}:`, error);
    return response.status(500).json({ error: "Failed to load battle logs." });
  }
}

router.get("/api/profile/:identifier", handleProfileBattleLogs);
router.get("/api/profile/:userID/battle-logs", handleProfileBattleLogs);

export default router;
