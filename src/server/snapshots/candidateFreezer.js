import { fetchWithRetry } from "../shared/httpRetry.js";
import { MAVIS_API_URL, AXIE_ECHELON_API_KEY, DEBUG_ON } from "../shared/env.js";
import { SEASON_LEADERBOARD_API_MAX_LIMIT, LEADERBOARD_MAX_RANK } from "../leaderboard/leaderboardConstants.js";

function cancellationError() {
  const error = new Error("Candidate freezing was cancelled.");
  error.code = "SNAPSHOT_CANDIDATE_CANCELLED";
  return error;
}

function assertNotCancelled(signal) {
  if (signal?.aborted) throw cancellationError();
}

function getUpstreamTotal(payload) {
  const candidates = [
    payload?._meta?.total,
    payload?._meta?.count,
    payload?.total,
    payload?.count,
    payload?._total
  ];
  return candidates.find((value) => Number.isFinite(Number(value))) ?? null;
}

export function normalizeCandidate(player) {
  return {
    rank: player?.topRank ?? player?.rank ?? null,
    userID: player?.userID ?? null,
    name: player?.name ?? null,
    mmr: player?.vstar ?? player?.rating ?? null,
    tier: player?.tier ?? null,
    avatar: player?.avatar ?? null
  };
}

export function buildSeasonalLeaderboardUrl({ apiUrl = MAVIS_API_URL, seasonId, milestone, limit, offset }) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    milestone: String(milestone)
  });
  return `${apiUrl}/origins/v2/season-leaderboards?${params.toString()}`;
}

export async function freezeSeasonCandidates({
  repository,
  manifest,
  rankMin = 1,
  rankMax = LEADERBOARD_MAX_RANK,
  fetchImpl = fetch,
  apiUrl = MAVIS_API_URL,
  apiKey = AXIE_ECHELON_API_KEY,
  signal
}) {
  if (!repository || !manifest) throw new Error("Candidate freezing requires a repository and manifest.");
  if (manifest.scopeKey !== `season:${manifest.seasonId}:milestone:${manifest.milestone}`) {
    throw new Error("Candidate freezing requires a seasonal snapshot scope.");
  }
  if (!Number.isInteger(rankMin) || rankMin < 1) throw new Error("rankMin must be a positive integer.");
  if (!Number.isInteger(rankMax) || rankMax < rankMin) throw new Error("rankMax must be at least rankMin.");

  const current = await repository.updateManifest(manifest, {
    status: "running",
    startedAt: manifest.startedAt || new Date().toISOString(),
    candidateScope: {
      ...manifest.candidateScope,
      rankStart: rankMin,
      rankEnd: rankMax,
      configuredCeiling: LEADERBOARD_MAX_RANK
    }
  });
  let candidateCount = current.candidateScope.frozenCandidateCount || 0;
  let pagesFetched = current.candidateScope.pagesFetched || 0;
  let upstreamReportedTotal = current.candidateScope.upstreamReportedTotal ?? null;
  const firstOffset = rankMin - 1 + pagesFetched * SEASON_LEADERBOARD_API_MAX_LIMIT;

  try {
    for (let offset = firstOffset; offset < rankMax; offset += SEASON_LEADERBOARD_API_MAX_LIMIT) {
      assertNotCancelled(signal);
      const limit = Math.min(SEASON_LEADERBOARD_API_MAX_LIMIT, rankMax - offset);
      const url = buildSeasonalLeaderboardUrl({ apiUrl, seasonId: manifest.seasonId, milestone: manifest.milestone, limit, offset });
      const response = await fetchWithRetry(
        url,
        { headers: { "x-api-key": apiKey }, signal },
        { debug: DEBUG_ON, fetchImpl }
      );
      if (!response.ok) {
        const error = new Error(`Seasonal leaderboard fetch failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      const items = Array.isArray(payload?._items) ? payload._items : null;
      if (!items) throw new Error("Seasonal leaderboard response did not contain an _items array.");
      upstreamReportedTotal = upstreamReportedTotal ?? getUpstreamTotal(payload);
      const normalized = items.map(normalizeCandidate);
      await repository.writeCandidatePage(current, pagesFetched + 1, payload, normalized);
      pagesFetched += 1;
      candidateCount += normalized.length;
      const next = await repository.updateManifest(current, {
        candidateScope: {
          ...current.candidateScope,
          rankStart: rankMin,
          rankEnd: rankMax,
          configuredCeiling: LEADERBOARD_MAX_RANK,
          upstreamReportedTotal,
          pagesFetched,
          frozenCandidateCount: candidateCount
        },
        progress: {
          ...current.progress,
          pendingPlayers: candidateCount,
          attemptedPlayers: current.progress.attemptedPlayers
        }
      });
      Object.assign(current, next);
      if (items.length < limit) break;
    }
    return await repository.readManifest(current);
  } catch (error) {
    if (error.code === "SNAPSHOT_CANDIDATE_CANCELLED" || signal?.aborted) {
      return repository.updateManifest(current, {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        candidateScope: {
          ...current.candidateScope,
          pagesFetched,
          frozenCandidateCount: candidateCount,
          upstreamReportedTotal
        },
        progress: { ...current.progress, pendingPlayers: candidateCount }
      });
    }
    await repository.updateManifest(current, {
      status: "failed",
      candidateScope: {
        ...current.candidateScope,
        pagesFetched,
        frozenCandidateCount: candidateCount,
        upstreamReportedTotal
      },
      progress: { ...current.progress, pendingPlayers: candidateCount }
    });
    throw error;
  }
}
