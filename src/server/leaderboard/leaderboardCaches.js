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

export const teamCache = new Map();
export const teamCompositionCache = new Map();
export const pageCache = new Map();
export const inFlightPageRefreshes = new Set();
const inFlightRefreshes = new Set();

export function getCachedTeam(clientId) {
  const entry = teamCache.get(clientId);
  if (!entry || Date.now() - entry.timestamp > TEAM_CACHE_TTL_MS) { teamCache.delete(clientId); return null; }
  return entry.team;
}
export function setCachedTeam(clientId, team) { teamCache.set(clientId, { team, timestamp: Date.now() }); }
export function isTeamCacheStale(clientId) {
  const entry = teamCache.get(clientId);
  return !entry || Date.now() - entry.timestamp > TEAM_CACHE_TTL_MS * TEAM_CACHE_REFRESH_THRESHOLD;
}
export function scheduleTeamRefresh(clientId) {
  if (inFlightRefreshes.has(clientId)) return;
  inFlightRefreshes.add(clientId);
  fetchBattleLogsForClientDeduped(clientId, 20, "low")
    .then((team) => { if (team) setCachedTeam(clientId, team); })
    .catch((error) => {
      if (DEBUG_ON) console.warn(`[scheduleTeamRefresh] Failed for ${clientId}: ${error.message}`);
    })
    .finally(() => inFlightRefreshes.delete(clientId));
}
export function getCachedTeamComposition(clientId) {
  const entry = teamCompositionCache.get(clientId);
  if (!entry || Date.now() - entry.timestamp > TEAM_COMPOSITION_CACHE_TTL_MS) { teamCompositionCache.delete(clientId); return null; }
  return entry.fighters;
}
export function setCachedTeamComposition(clientId, fighters) {
  if (Array.isArray(fighters) && fighters.length) teamCompositionCache.set(clientId, { fighters, timestamp: Date.now() });
}
export function getCachedPage(key) {
  const entry = pageCache.get(key);
  if (!entry || Date.now() - entry.timestamp > LEADERBOARD_PAGE_CACHE_TTL_MS) { pageCache.delete(key); return null; }
  return entry.payload;
}
export function setCachedPage(key, payload) { pageCache.set(key, { payload, timestamp: Date.now() }); }

// Single global cache entry for the average ranked-match duration across
// all currently-tracked players (see computeGlobalAvgMatchDurationMs() in
// leaderboardEnrichment.js). NOT a Map -- this is intentionally one value,
// not keyed per player.
//
// NOT multi-leaderboard-pool-safe: if this app ever tracks multiple
// leaderboard pools/windows simultaneously, this single key would let one
// pool's match pacing bleed into another's estimate. Re-key per pool if
// that's ever added.
let globalAvgMatchDurationCache = null; // { value: number|null, timestamp } | null

export function getCachedGlobalAvgMatchDuration() {
  if (!globalAvgMatchDurationCache) return undefined; // no entry yet
  if (Date.now() - globalAvgMatchDurationCache.timestamp > AVG_MATCH_DURATION_CACHE_TTL_MS) {
    globalAvgMatchDurationCache = null;
    return undefined;
  }
  return globalAvgMatchDurationCache.value; // may be null itself if last computation found no valid data
}

export function setCachedGlobalAvgMatchDuration(value) {
  globalAvgMatchDurationCache = { value, timestamp: Date.now() };
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
}

const cacheSweepTimer = setInterval(sweepExpiredCacheEntries, CACHE_SWEEP_INTERVAL_MS);
cacheSweepTimer.unref?.();