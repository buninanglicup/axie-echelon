import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { getPlayerBattleLogPage } from "./profileBattleLogs.js";
import { cleanRoninAddress } from "../shared/validators.js";
import { getProfileByRoninAddress } from "../shared/profileClient.js";
export const PROFILE_BATTLE_LOG_LIMIT = 20;

export function isRoninIdentifier(identifier) {
  return /^(?:ronin:|0x)/i.test(String(identifier || "").trim());
}

export function isAccountIdentifier(identifier) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(identifier || "").trim());
}

export async function resolveProfileIdentifier(identifier, { lookupProfileByRoninAddress = getProfileByRoninAddress } = {}) {
  const value = String(identifier || "").trim();
  if (!value) {
    const error = new Error("A player account ID or Ronin address is required.");
    error.status = 400;
    throw error;
  }
  if (!isRoninIdentifier(value)) {
    if (!isAccountIdentifier(value)) {
      const error = new Error("Enter a valid player account ID or Ronin address.");
      error.status = 400;
      throw error;
    }
    return { accountId: value, roninAddress: null };
  }

  let roninAddress;
  try {
    roninAddress = cleanRoninAddress(value);
  } catch (error) {
    error.status = 400;
    throw error;
  }
  try {
    const profile = await lookupProfileByRoninAddress(roninAddress);
    return { accountId: profile.accountId, roninAddress, name: profile.name || null };
  } catch (error) {
    if (error.message === "No Axie profile was found for this Ronin address.") error.status = 404;
    throw error;
  }
}

export function createProfileRouter({
  getBattleLogPage = getPlayerBattleLogPage,
  lookupProfileByRoninAddress = getProfileByRoninAddress
} = {}) {
  const router = express.Router();

  // GET /api/profile/:identifier/battle-logs?limit=20&milestone=&seasonId=&offSeasonMode=
  async function handleProfileBattleLogs(request, response) {
    const identifier = request.params.identifier || request.params.userID;

    let leaderboardScope = null;
    if (request.query.milestone !== undefined || request.query.seasonId !== undefined || request.query.offSeasonMode !== undefined) {
      leaderboardScope = {
        milestone: request.query.milestone,
        seasonId: request.query.seasonId,
        offSeasonMode: request.query.offSeasonMode === "true"
      };
    }

    try {
      const resolvedProfile = await resolveProfileIdentifier(identifier, { lookupProfileByRoninAddress });
      const result = await getBattleLogPage({
        userID: resolvedProfile.accountId,
        leaderboardScope,
        requestedFetchLimit: PROFILE_BATTLE_LOG_LIMIT
      });
      if (result.status === "unavailable") return response.status(404).json(result);
      if (result.status === "error") return response.status(502).json(result);
      return response.json({
        ...result,
        resolvedUserID: resolvedProfile.accountId,
        resolvedRoninAddress: resolvedProfile.roninAddress,
        resolvedPlayerName: resolvedProfile.name
      });
    } catch (error) {
      if (DEBUG_ON) console.error(`[profileRoutes] Error for identifier=${identifier}:`, error);
      return response.status(error.status || 502).json({ error: error.message || "Failed to resolve player profile." });
    }
  }

  router.get("/api/profile/:identifier", handleProfileBattleLogs);
  router.get("/api/profile/:userID/battle-logs", handleProfileBattleLogs);
  return router;
}

export default createProfileRouter();
