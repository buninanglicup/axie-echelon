// These maps are intentionally shared across leaderboard features so profile,
// team, page, enrichment, and candidate work can reuse the same in-memory data.
import { fetchBattleLogsForClientDeduped } from "./battleLogClient.js";
import { DEBUG_ON } from "../shared/env.js";
import { profileCache, PROFILE_CACHE_TTL_MS } from "../shared/profileCache.js";
import { enrichmentCache, FAILED_ENRICHMENT_CACHE_TTL_MS } from "./enrichmentCache.js";
import { rankCandidateCache } from "./leaderboardCandidates.js";
import {
  TEAM_CACHE_TTL_MS,
  TEAM_COMPOSITION_CACHE_TTL_MS,
  TEAM_CACHE_REFRESH_THRESHOLD,
  LEADERBOARD_PAGE_CACHE_TTL_MS,
  CACHE_SWEEP_INTERVAL_MS,
  RANK_CANDIDATE_CACHE_TTL_MS,
  AVG_MATCH_DURATION_CACHE_TTL_MS
} from "./leaderboardConstants.js";
import { getLeaderboardScopedUserKey } from "../../leaderboard/leaderboardScope.js";

export const teamCache = new Map();
export const teamCompositionCache = new Map();
export const pageCache = new Map();
export const inFlightPageRefreshes = new Set();
const inFlightRefreshes = new Set();

export function teamCacheKey(clientId, leaderboardScope) {
  return getLeaderboardScopedUserKey(leaderboardScope, clientId);
}

export function getCachedTeam(clientId, leaderboardScope) {
  const key = teamCacheKey(clientId, leaderboardScope);
  const entry = teamCache.get(key);
  if (!entry || Date.now() - entry.timestamp > TEAM_CACHE_TTL_MS) { teamCache.delete(key); return null; }
  return entry.team;
}
export function setCachedTeam(clientId, team, leaderboardScope) { teamCache.set(teamCacheKey(clientId, leaderboardScope), { team, timestamp: Date.now() }); }
export function isTeamCacheStale(clientId, leaderboardScope) {
  const entry = teamCache.get(teamCacheKey(clientId, leaderboardScope));
  return !entry || Date.now() - entry.timestamp > TEAM_CACHE_TTL_MS * TEAM_CACHE_REFRESH_THRESHOLD;
}
export function scheduleTeamRefresh(clientId, leaderboardScope) {
  const key = teamCacheKey(clientId, leaderboardScope);
  if (inFlightRefreshes.has(key)) return;
  inFlightRefreshes.add(key);
  fetchBattleLogsForClientDeduped(clientId, 20, "low")
    .then((team) => { if (team) setCachedTeam(clientId, team, leaderboardScope); })
    .catch((error) => {
      if (DEBUG_ON) console.warn(`[scheduleTeamRefresh] Failed for ${clientId}: ${error.message}`);
    })
    .finally(() => inFlightRefreshes.delete(key));
}
export function getCachedTeamComposition(clientId, leaderboardScope) {
  const key = teamCacheKey(clientId, leaderboardScope);
  const entry = teamCompositionCache.get(key);
  if (!entry || Date.now() - entry.timestamp > TEAM_COMPOSITION_CACHE_TTL_MS) { teamCompositionCache.delete(key); return null; }
  return entry.fighters;
}
export function setCachedTeamComposition(clientId, fighters, leaderboardScope) {
  if (Array.isArray(fighters) && fighters.length) teamCompositionCache.set(teamCacheKey(clientId, leaderboardScope), { fighters, timestamp: Date.now() });
}
export function getCachedPage(key) {
  const entry = pageCache.get(key);
  if (!entry || Date.now() - entry.timestamp > LEADERBOARD_PAGE_CACHE_TTL_MS) { pageCache.delete(key); return null; }
  return entry.payload;
}
export function setCachedPage(key, payload) { pageCache.set(key, { payload, timestamp: Date.now() }); }

// Scoped cache entries for the average ranked-match duration across
// currently-tracked players (see computeGlobalAvgMatchDurationMs() in
// leaderboardEnrichment.js). A Final-era result must not affect an
// offseason estimate, even when the player sets overlap.
const globalAvgMatchDurationCache = new Map(); // scopeKey -> { value: number|null, timestamp }

export function getCachedGlobalAvgMatchDuration(scopeKey) {
  const entry = globalAvgMatchDurationCache.get(scopeKey);
  if (!entry) return undefined; // no entry yet
  if (Date.now() - entry.timestamp > AVG_MATCH_DURATION_CACHE_TTL_MS) {
    globalAvgMatchDurationCache.delete(scopeKey);
    return undefined;
  }
  return entry.value; // may be null itself if last computation found no valid data
}

export function setCachedGlobalAvgMatchDuration(scopeKey, value) {
  globalAvgMatchDurationCache.set(scopeKey, { value, timestamp: Date.now() });
}

function sweepExpiredCacheEntries() {
  const now = Date.now();
  for (const [key, entry] of teamCache) {
    if (now - entry.timestamp > TEAM_CACHE_TTL_MS) teamCache.delete(key);
  }
  for (const [key, entry] of teamCompositionCache) {
    if (now - entry.timestamp > TEAM_COMPOSITION_CACHE_TTL_MS) teamCompositionCache.delete(key);
  }
  for (const [key, entry] of pageCache) {
    if (now - entry.timestamp > LEADERBOARD_PAGE_CACHE_TTL_MS) pageCache.delete(key);
  }
  for (const [key, entry] of rankCandidateCache) {
    if (now - entry.timestamp > RANK_CANDIDATE_CACHE_TTL_MS) rankCandidateCache.delete(key);
  }
  for (const [key, entry] of profileCache) {
    if (now - entry.timestamp > PROFILE_CACHE_TTL_MS) profileCache.delete(key);
  }
  for (const [key, entry] of enrichmentCache) {
    const ttl = entry.status === "failed" ? FAILED_ENRICHMENT_CACHE_TTL_MS : TEAM_CACHE_TTL_MS;
    if (now - entry.timestamp > ttl) enrichmentCache.delete(key);
  }
  for (const [key, entry] of globalAvgMatchDurationCache) {
    if (now - entry.timestamp > AVG_MATCH_DURATION_CACHE_TTL_MS) globalAvgMatchDurationCache.delete(key);
  }
}

const cacheSweepTimer = setInterval(sweepExpiredCacheEntries, CACHE_SWEEP_INTERVAL_MS);
cacheSweepTimer.unref?.();
