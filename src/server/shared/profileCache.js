// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js
// (added there on 2026-08-19, same day as this split -- see the "2026-08-19
// cache split" work). No logic changes in this move.
//
// This cache was introduced specifically to stop the leaderboard from
// re-resolving a player's Ronin address/profile URL on every single
// enrichment pass (live mode or not) -- a player's address essentially never
// changes within a session, so this is intentionally long-lived and,
// importantly, NEVER bypassed by live mode (live mode's freshness
// requirement is about lastRankedBattleTime, not identity data).
import { DEBUG_ON, PROFILE_BASE } from "./env.js";
import { cleanRoninAddress } from "./validators.js";
import { getProfileByAccountId } from "./profileClient.js";

export const PROFILE_CACHE_TTL_MS = Number(process.env.PROFILE_CACHE_TTL_MS || 21600000); // 6 hours default

// userID -> { name, roninAddress, profileUrl, timestamp }
// Exported (not just the get/set functions) so sweepExpiredCacheEntries in
// leaderboard/leaderboardCaches.js can periodically evict expired entries --
// see the "BUG THIS WOULD HAVE INTRODUCED IF MISSED" note there.
export const profileCache = new Map();

export function getCachedProfile(userID) {
  const cached = profileCache.get(userID);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > PROFILE_CACHE_TTL_MS) {
    profileCache.delete(userID);
    return null;
  }

  return {
    name: cached.name || null,
    nameResolved: cached.nameResolved === true,
    roninAddress: cached.roninAddress,
    profileUrl: cached.profileUrl
  };
}

export function setCachedProfile(userID, roninAddress, profileUrl, name = null) {
  profileCache.set(userID, { name, nameResolved: true, roninAddress, profileUrl, timestamp: Date.now() });
  if (DEBUG_ON) console.log(`[setCachedProfile] SET: cached profile for ${userID}`);
}

export async function resolvePlayerProfile(userID) {
  const cached = getCachedProfile(userID);
  // The battle-log UI needs both a display name and a Ronin address. Do not
  // treat a partial identity as final: a transient GraphQL response may have
  // supplied the name without the address, and otherwise the missing address
  // would stay hidden for the cache TTL.
  if (cached?.nameResolved && cached.name && cached.roninAddress) {
    if (DEBUG_ON) console.log(`[resolvePlayerProfile] HIT: cached profile for ${userID}`);
    return cached;
  }

  let name = null;
  let roninAddress = null;
  let profileUrl = null;

  try {
    const profile = await getProfileByAccountId(userID);
    name = typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : null;
    const profileRonin = profile?.addresses?.ronin;
    if (profileRonin) {
      roninAddress = cleanRoninAddress(profileRonin);
      profileUrl = `${PROFILE_BASE}/${roninAddress}/axies/`;
    }
  } catch (error) {
    if (DEBUG_ON) {
      console.warn(`[resolvePlayerProfile] Failed to resolve profile URL for userID=${userID}:`, error.message);
    }
    // NOTE: intentionally NOT caching a failure here (unlike the
    // team-composition cache, which is fine to leave empty on failure since
    // callers already null-check it). A failed profile lookup is cheap
    // enough, and rare enough, that retrying next poll is preferable to
    // adding another TTL/negative-cache dimension to reason about.
    return { name: null, roninAddress: null, profileUrl: null };
  }

  // Cache successful responses, but incomplete cache entries are retried on
  // the next lookup so a temporarily omitted Ronin address can be recovered.
  setCachedProfile(userID, roninAddress, profileUrl, name);
  return { name, roninAddress, profileUrl };
}
