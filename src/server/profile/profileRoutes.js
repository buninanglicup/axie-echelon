import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { getPlayerBattleLogPage } from "./profileBattleLogs.js";
import { cleanRoninAddress } from "../shared/validators.js";
import { getProfileByRoninAddress } from "../shared/profileClient.js";
import { resolvePlayerProfile } from "../shared/profileCache.js";
export const PROFILE_BATTLE_LOG_LIMIT = 20;
const PROFILE_MAX_OFFSET = 10000;

export function parseProfileOffset(value) {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(String(value))) {
    const error = new Error("Offset must be a non-negative whole number.");
    error.status = 400;
    throw error;
  }
  return Math.min(PROFILE_MAX_OFFSET, Number(value));
}

export function isRoninIdentifier(identifier) {
  return /^(?:ronin:|0x)/i.test(String(identifier || "").trim());
}

export function isAccountIdentifier(identifier) {
  // Axie account IDs are UUID-shaped, but live IDs include versions beyond
  // the RFC v1-v5 range (for example, `...-6cfc-...`). Validate the stable
  // 8-4-4-4-12 hexadecimal shape rather than imposing RFC UUID version bits.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(identifier || "").trim());
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
  lookupProfileByRoninAddress = getProfileByRoninAddress,
  lookupProfileByAccountId = resolvePlayerProfile
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
      // A direct client-ID URL does not contain the owner's Ronin address.
      // Resolve it separately so the profile header can consistently show the
      // human-usable, copyable wallet address for either input form.
      const accountProfile = resolvedProfile.roninAddress ? null : await lookupProfileByAccountId(resolvedProfile.accountId);
      const canonicalRoninAddress = resolvedProfile.roninAddress || accountProfile?.roninAddress || null;
      const canonicalName = resolvedProfile.name || accountProfile?.name || null;
      const offset = parseProfileOffset(request.query.offset);
      const result = await getBattleLogPage({
        userID: resolvedProfile.accountId,
        leaderboardScope,
        requestedFetchLimit: PROFILE_BATTLE_LOG_LIMIT,
        offset
      });
      if (result.status === "unavailable") return response.status(404).json(result);
      if (result.status === "error") return response.status(502).json(result);
      return response.json({
        ...result,
        resolvedUserID: resolvedProfile.accountId,
        resolvedRoninAddress: canonicalRoninAddress,
        resolvedPlayerName: canonicalName
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
