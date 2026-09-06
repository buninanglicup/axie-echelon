import { getLeaderboardScopeKey, normalizeLeaderboardScope } from "../../leaderboard/leaderboardScope.js";
import { SnapshotRepository } from "./snapshotRepository.js";

function snapshotReference(scope, captureId) {
  return {
    seasonId: Number(scope.seasonId),
    milestone: String(scope.milestone),
    scopeKey: getLeaderboardScopeKey(scope),
    captureId
  };
}

function snapshotMetadata(snapshot) {
  return {
    captureId: snapshot.captureId,
    revision: snapshot.revision,
    scopeKey: snapshot.scopeKey,
    capturedAt: snapshot.completedAt,
    eraCoverage: snapshot.battleLogSummary.eraCoverage,
    candidateScope: snapshot.candidateScope
  };
}

function mapSnapshotFighter(fighter) {
  return {
    axieID: fighter?.axieID,
    name: fighter?.name,
    genes: fighter?.genes,
    // The live renderer expects the existing singular field. Preserve raw
    // payloads untouched, but accept either observed/documented spelling in
    // the normalized snapshot view.
    genes_metamorph: fighter?.genes_metamorph ?? fighter?.genes_metamorphed,
    position: Number(fighter?.position ?? 0),
    axieType: fighter?.axieType,
    runes: Array.isArray(fighter?.runes) ? fighter.runes : [],
    charms: fighter?.charms || null
  };
}

export function extractHistoricalTeam(userID, normalizedBattleLog) {
  // New compact capture path: if a normalized selectedTeam exists, prefer it.
  if (normalizedBattleLog?.selectedTeam?.fighters && Array.isArray(normalizedBattleLog.selectedTeam.fighters)) {
    return {
      fighters: normalizedBattleLog.selectedTeam.fighters.map(mapSnapshotFighter).sort((left, right) => left.position - right.position)
    };
  }

  const battles = Array.isArray(normalizedBattleLog?.rankedBattles)
    ? [...normalizedBattleLog.rankedBattles]
    : [];
  battles.sort((left, right) => Date.parse(right?.timestamp || 0) - Date.parse(left?.timestamp || 0));

  for (const battle of battles) {
    const player = battle?.gameData?.players?.find((entry) => entry?.userID === userID);
    if (!Array.isArray(player?.team?.fighters) || player.team.fighters.length === 0) continue;
    return {
      fighters: player.team.fighters
        .map(mapSnapshotFighter)
        .sort((left, right) => left.position - right.position)
    };
  }
  return null;
}

export async function findAcceptedSnapshot(repository, leaderboardScope) {
  const scope = normalizeLeaderboardScope(leaderboardScope);
  if (scope.offSeasonMode || !Number.isInteger(Number(scope.seasonId))) return null;

  const index = await repository.readIndex(snapshotReference(scope));
  if (!index?.acceptedCaptureId) return null;

  return repository.readManifest(snapshotReference(scope, index.acceptedCaptureId));
}

// Historical rows must come from the same accepted immutable capture as their
// team evidence. This deliberately has no live-candidate fallback: a missing
// snapshot is a product-visible archival gap, not permission to show a later
// upstream leaderboard under historical labels.
export async function getHistoricalSnapshotCandidates({
  repository = new SnapshotRepository(),
  leaderboardScope,
  rankMin = 1,
  rankMax = Infinity
}) {
  const snapshot = await findAcceptedSnapshot(repository, leaderboardScope);
  if (!snapshot) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      error: "No accepted historical leaderboard snapshot is available for this era."
    };
  }

  const eraStartedAt = Number(snapshot.eraStartedAt);
  const eraEndedAt = Number(snapshot.eraEndedAt);
  if (!Number.isFinite(eraStartedAt) || !Number.isFinite(eraEndedAt) || eraStartedAt >= eraEndedAt) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      snapshot: snapshotMetadata(snapshot),
      error: "The accepted snapshot has no verified era window, so it cannot be presented as historical leaderboard data."
    };
  }

  const candidates = await repository.readFrozenCandidates(snapshot);
  const players = candidates.filter((candidate) => {
    const rank = Number(candidate?.topRank ?? candidate?.rank);
    return Number.isFinite(rank) && rank >= rankMin && rank <= rankMax;
  });

  return {
    status: "ready",
    source: "historical-snapshot",
    players,
    snapshot: snapshotMetadata(snapshot)
  };
}

export async function getHistoricalSnapshotEnrichment({
  repository = new SnapshotRepository(),
  leaderboardScope,
  userID
}) {
  const snapshot = await findAcceptedSnapshot(repository, leaderboardScope);
  if (!snapshot) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      error: "No accepted historical team snapshot is available for this era."
    };
  }

  const eraStartedAt = Number(snapshot.eraStartedAt);
  const eraEndedAt = Number(snapshot.eraEndedAt);
  if (!Number.isFinite(eraStartedAt) || !Number.isFinite(eraEndedAt) || eraStartedAt >= eraEndedAt) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      snapshot: {
        captureId: snapshot.captureId,
        revision: snapshot.revision,
        scopeKey: snapshot.scopeKey,
        capturedAt: snapshot.completedAt,
        eraCoverage: snapshot.battleLogSummary.eraCoverage
      },
      error: "The accepted snapshot has no verified era window, so it cannot be presented as historical team data."
    };
  }

  const normalizedBattleLog = await repository.readNormalizedBattleLog(snapshot, userID);
  const team = extractHistoricalTeam(userID, normalizedBattleLog);
  if (!team) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      snapshot: {
        captureId: snapshot.captureId,
        revision: snapshot.revision,
        scopeKey: snapshot.scopeKey,
        capturedAt: snapshot.completedAt,
        eraCoverage: snapshot.battleLogSummary.eraCoverage
      },
      error: "No archived ranked team is available for this player."
    };
  }

  return {
    status: "ready",
    source: "historical-snapshot",
    team,
    fetchedAt: normalizedBattleLog.capturedAt,
    snapshot: {
      captureId: snapshot.captureId,
      revision: snapshot.revision,
      scopeKey: snapshot.scopeKey,
      capturedAt: snapshot.completedAt,
      eraCoverage: snapshot.battleLogSummary.eraCoverage
    }
  };
}
