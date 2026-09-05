// PHASE 1 FILE SPLIT (2026-08-19) -- moved from the old server.js.
import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { fetchWithRetry, parseRetryAfterMs } from "../shared/httpRetry.js";
import { RANK_CANDIDATE_CACHE_TTL_MS, SEASON_LEADERBOARD_API_MAX_LIMIT } from "./leaderboardConstants.js";
import { recordCandidatePoolRequest, recordCandidatePoolCacheHit } from "./runeScanDiagnostics.js";
import {
  appendLeaderboardScopeParams,
  getLeaderboardEndpointPath,
  getLeaderboardScopeKey,
  normalizeLeaderboardScope
} from "../../leaderboard/leaderboardScope.js";

export const rankCandidateCache = new Map();
const inFlightChunkFetches = new Map();

export function chunkCacheKey(scope, offset) {
  return `${getLeaderboardScopeKey(scope)}:offset:${offset}`;
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

async function fetchCandidateChunk(scope, offset) {
  const key = chunkCacheKey(scope, offset);
  const cached = rankCandidateCache.get(key);
  if (cached && Date.now() - cached.timestamp < RANK_CANDIDATE_CACHE_TTL_MS) {
    if (DEBUG_ON) console.log(`[fetchCandidateChunk] cache HIT for ${key}`);
    recordCandidatePoolCacheHit();
    return { items: cached.items, isLastPage: cached.isLastPage };
  }

  if (inFlightChunkFetches.has(key)) return inFlightChunkFetches.get(key);

  const promise = (async () => {
    const params = appendLeaderboardScopeParams(
      new URLSearchParams({ limit: String(SEASON_LEADERBOARD_API_MAX_LIMIT), offset: String(offset) }),
      scope
    );
    const url = `${MAVIS_API_URL}${getLeaderboardEndpointPath(scope)}?${params.toString()}`;
    recordCandidatePoolRequest();
    const res = await fetchWithRetry(
      url,
      { headers: { "x-api-key": AXIE_ECHELON_API_KEY } },
      { debug: DEBUG_ON }
    );

    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      const retryAfterSeconds = retryAfterMs !== null ? Math.ceil(retryAfterMs / 1000) : null;
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
export async function fetchRankCandidates(leaderboardScope, maxRank) {
  const scope = normalizeLeaderboardScope(leaderboardScope);
  const merged = [];
  for (let offset = 0; offset < maxRank; offset += SEASON_LEADERBOARD_API_MAX_LIMIT) {
    const { items, isLastPage } = await fetchCandidateChunk(scope, offset);
    merged.push(...items);
    if (isLastPage) break;
  }

  if (DEBUG_ON) console.log(`[fetchRankCandidates] assembled ${merged.length} candidates for scope=${getLeaderboardScopeKey(scope)} maxRank=${maxRank}`);
  return merged.slice(0, maxRank);
}
