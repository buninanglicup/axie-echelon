// This cache models the settled API response. The frontend may use queued or
// loading as transient states, but this backend returns ready, stale, or failed.
import { DEBUG_ON } from "../shared/env.js";
import { fetchBattleLogsForClientDeduped } from "./battleLogClient.js";
import { TEAM_CACHE_TTL_MS } from "./leaderboardConstants.js";

export const FAILED_ENRICHMENT_CACHE_TTL_MS = 30000;
export const enrichmentCache = new Map();
const inFlightEnrichments = new Map();

export async function getOrFetchPlayerEnrichment(userID, priority = "high") {
  const cached = enrichmentCache.get(userID);
  const ttl = cached?.status === "failed" ? FAILED_ENRICHMENT_CACHE_TTL_MS : TEAM_CACHE_TTL_MS;
  if (cached && Date.now() - cached.timestamp <= ttl) return cached.value;

  if (inFlightEnrichments.has(userID)) return inFlightEnrichments.get(userID);

  const request = (async () => {
    const team = await fetchBattleLogsForClientDeduped(userID, 20, priority);
    const refreshedAt = new Date().toISOString();
    let value;

    if (team) {
      value = { status: "ready", team, fetchedAt: refreshedAt };
    } else if (cached?.value?.team) {
      value = {
        status: "stale",
        team: cached.value.team,
        fetchedAt: cached.value.fetchedAt,
        error: "The latest team refresh was unavailable.",
        retryAt: refreshedAt
      };
    } else {
      value = { status: "failed", error: "No ranked team was found.", attempts: 1 };
    }

    enrichmentCache.set(userID, { status: value.status, value, timestamp: Date.now() });
    if (DEBUG_ON && value.status !== "ready") {
      console.warn(`[enrichmentCache] ${value.status} for ${userID}`);
    }
    return value;
  })();

  inFlightEnrichments.set(userID, request);
  try {
    return await request;
  } finally {
    inFlightEnrichments.delete(userID);
  }
}