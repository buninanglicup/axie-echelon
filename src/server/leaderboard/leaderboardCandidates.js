// PHASE 1 FILE SPLIT (2026-08-19) -- moved from the old server.js.
import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { fetchWithRetry } from "../shared/httpRetry.js";
import { RANK_CANDIDATE_CACHE_TTL_MS, SEASON_LEADERBOARD_API_MAX_LIMIT } from "./leaderboardConstants.js";

export const rankCandidateCache = new Map();
const inFlightChunkFetches = new Map();

function chunkCacheKey(eraMilestone, offset) {
  return `${eraMilestone}_${offset}`;
}

export class CandidatePoolUnavailableError extends Error {
  constructor(message, { status, offset, retryAfterSeconds } = {}) {
    super(message);
    this.name = "CandidatePoolUnavailableError";
    this.code = "LEADERBOARD_UPSTREAM_UNAVAILABLE";
    this.upstreamStatus = status;
    this.failedOffset = offset;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}

async function fetchCandidateChunk(eraMilestone, offset) {
  const key = chunkCacheKey(eraMilestone, offset);
  const cached = rankCandidateCache.get(key);
  if (cached && Date.now() - cached.timestamp < RANK_CANDIDATE_CACHE_TTL_MS) {
    if (DEBUG_ON) console.log(`[fetchCandidateChunk] cache HIT for ${key}`);
    return { items: cached.items, isLastPage: cached.isLastPage };
  }

  if (inFlightChunkFetches.has(key)) return inFlightChunkFetches.get(key);

  const promise = (async () => {
    const url = `${MAVIS_API_URL}/origins/v2/season-leaderboards?limit=${SEASON_LEADERBOARD_API_MAX_LIMIT}&offset=${offset}&milestone=${eraMilestone}`;
    const res = await fetchWithRetry(
      url,
      { headers: { "x-api-key": AXIE_ECHELON_API_KEY } },
      { debug: DEBUG_ON }
    );

    if (!res.ok) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())
        ? Number(retryAfterHeader.trim())
        : null;
      throw new CandidatePoolUnavailableError(
        `Rank candidate fetch failed at offset ${offset}: ${res.status}`,
        { status: res.status, offset, retryAfterSeconds }
      );
    }

    const data = await res.json();
    const items = Array.isArray(data._items) ? data._items : [];
    const isLastPage = items.length < SEASON_LEADERBOARD_API_MAX_LIMIT;
    rankCandidateCache.set(key, { items, timestamp: Date.now(), isLastPage });
    return { items, isLastPage };
  })();

  inFlightChunkFetches.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightChunkFetches.delete(key);
  }
}

// Fetch the raw (unenriched) rank/name/mmr list for ranks 1..maxRank, merging
// as many upstream season-leaderboards calls as needed given the confirmed
// 100-per-request cap. This is intentionally separate from
// fetchAndEnrichLeaderboard() (leaderboardEnrichment.js), which fetches+enriches
// one fixed page for the normal leaderboard view -- this fetches a much
// larger raw slice with no enrichment, since enrichment only happens for
// whichever candidates the rune scan (or, later, another filter) actually
// needs to inspect.
export async function fetchRankCandidates(eraMilestone, maxRank) {
  const merged = [];
  for (let offset = 0; offset < maxRank; offset += SEASON_LEADERBOARD_API_MAX_LIMIT) {
    const { items, isLastPage } = await fetchCandidateChunk(eraMilestone, offset);
    merged.push(...items);
    if (isLastPage) break;
  }

  if (DEBUG_ON) console.log(`[fetchRankCandidates] assembled ${merged.length} candidates for era=${eraMilestone} maxRank=${maxRank}`);
  return merged.slice(0, maxRank);
}
