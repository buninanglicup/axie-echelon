// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes.
import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { RANK_CANDIDATE_CACHE_TTL_MS, SEASON_LEADERBOARD_API_MAX_LIMIT } from "./leaderboardConstants.js";

export const rankCandidateCache = new Map(); // key: `${eraMilestone}_${maxRank}` -> { players, timestamp }

// Fetch the raw (unenriched) rank/name/mmr list for ranks 1..maxRank, merging
// as many upstream season-leaderboards calls as needed given the confirmed
// 100-per-request cap. This is intentionally separate from
// fetchAndEnrichLeaderboard() (leaderboardEnrichment.js), which fetches+enriches
// one fixed page for the normal leaderboard view -- this fetches a much
// larger raw slice with no enrichment, since enrichment only happens for
// whichever candidates the rune scan (or, later, another filter) actually
// needs to inspect.
export async function fetchRankCandidates(eraMilestone, maxRank) {
  const cacheKey = `${eraMilestone}_${maxRank}`;
  const cached = rankCandidateCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < RANK_CANDIDATE_CACHE_TTL_MS) {
    if (DEBUG_ON) console.log(`[fetchRankCandidates] cache HIT for ${cacheKey}`);
    return cached.players;
  }

  const merged = [];
  for (let offset = 0; offset < maxRank; offset += SEASON_LEADERBOARD_API_MAX_LIMIT) {
    const pageLimit = Math.min(SEASON_LEADERBOARD_API_MAX_LIMIT, maxRank - offset);
    const url = `${MAVIS_API_URL}/origins/v2/season-leaderboards?limit=${pageLimit}&offset=${offset}&milestone=${eraMilestone}`;
    const res = await fetch(url, { headers: { "x-api-key": AXIE_ECHELON_API_KEY } });
    if (!res.ok) {
      throw new Error(`Rank candidate fetch failed at offset ${offset}: ${res.status}`);
    }
    const data = await res.json();
    const items = Array.isArray(data._items) ? data._items : [];
    merged.push(...items);
    // Upstream ran out of players before reaching maxRank -- stop early
    // rather than requesting pages that can only come back empty.
    if (items.length < pageLimit) break;
  }

  rankCandidateCache.set(cacheKey, { players: merged, timestamp: Date.now() });
  if (DEBUG_ON) console.log(`[fetchRankCandidates] fetched ${merged.length} candidates for ${cacheKey}`);
  return merged;
}
