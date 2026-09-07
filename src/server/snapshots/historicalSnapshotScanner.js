import { fighterMatchesBodyParts } from "../../bodyPartFilter.js";
import { normalizeLeaderboardScope } from "../../leaderboard/leaderboardScope.js";
import { LEADERBOARD_MAX_RANK, RUNE_SCAN_ENRICHMENT_BATCH_SIZE } from "../leaderboard/leaderboardConstants.js";
import { SnapshotRepository } from "./snapshotRepository.js";
import { extractHistoricalTeam, findAcceptedSnapshot } from "./snapshotReader.js";

function snapshotUnavailable(message) {
  const error = new Error(message);
  error.code = "HISTORICAL_SNAPSHOT_UNAVAILABLE";
  return error;
}

function teamEvidenceUnavailable(message) {
  const error = new Error(message);
  error.code = "HISTORICAL_TEAM_EVIDENCE_UNAVAILABLE";
  return error;
}

function snapshotMetadata(snapshot) {
  return {
    captureId: snapshot.captureId,
    revision: snapshot.revision,
    scopeKey: snapshot.scopeKey,
    capturedAt: snapshot.completedAt,
    hasTeamEvidence: snapshot.hasTeamEvidence !== false,
    eraCoverage: snapshot.battleLogSummary.eraCoverage,
    candidateScope: snapshot.candidateScope
  };
}

async function loadAcceptedSnapshot(repository, leaderboardScope) {
  const scope = normalizeLeaderboardScope(leaderboardScope);
  if (scope.offSeasonMode) {
    throw snapshotUnavailable("Offseason has no historical numeric-era snapshot.");
  }
  const snapshot = await findAcceptedSnapshot(repository, scope);
  if (!snapshot) {
    throw snapshotUnavailable("No accepted historical leaderboard snapshot is available for this era.");
  }
  // Fail closed immediately if team evidence is not available
  if (snapshot.hasTeamEvidence === false) {
    throw teamEvidenceUnavailable("This historical snapshot contains only leaderboard candidates; team evidence is not available for scanning.");
  }
  const eraStartedAt = Number(snapshot.eraStartedAt);
  const eraEndedAt = Number(snapshot.eraEndedAt);
  if (!Number.isFinite(eraStartedAt) || !Number.isFinite(eraEndedAt) || eraStartedAt >= eraEndedAt) {
    throw snapshotUnavailable("The accepted snapshot has no verified era window.");
  }
  return { scope, snapshot };
}

function narrowCandidates(candidates, { rankMin, rankMax, name }) {
  const nameQuery = String(name || "").trim().toLowerCase();
  return candidates.filter((candidate) => {
    const rank = Number(candidate?.topRank ?? candidate?.rank);
    if (!Number.isFinite(rank) || rank < rankMin || rank > rankMax) return false;
    return !nameQuery || String(candidate?.name || candidate?.userID || "").toLowerCase().includes(nameQuery);
  });
}

function selectedBattleTimestamp(record) {
  if (record?.selectedBattleTimestamp) return record.selectedBattleTimestamp;
  const battles = Array.isArray(record?.rankedBattles) ? record.rankedBattles : [];
  return [...battles]
    .map((battle) => battle?.timestamp ?? battle?.gameData?.endedAt ?? battle?.gameData?.startedAt ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function mapHistoricalMatch(candidate, team, normalizedRecord, snapshot) {
  return {
    rank: candidate.topRank ?? candidate.rank,
    name: candidate.name || candidate.userID,
    mmr: candidate.vstar ?? candidate.mmr ?? candidate.rating ?? null,
    winRate: null,
    dailyChange: "-",
    recentForm: [],
    team,
    lastRankedBattleTime: selectedBattleTimestamp(normalizedRecord),
    userID: candidate.userID,
    source: "historical-snapshot",
    snapshot: snapshotMetadata(snapshot)
  };
}

function normalizeRuneIds(runeIds) {
  return new Set((Array.isArray(runeIds) ? runeIds : [runeIds])
    .map((runeId) => String(runeId || "").trim())
    .filter(Boolean));
}

function runeIdentifier(rune) {
  if (typeof rune === "string" || typeof rune === "number") return String(rune);
  return String(rune?.runeID ?? rune?.runeId ?? rune?.id ?? "");
}

export function historicalTeamHasRune(team, runeIds) {
  const selected = normalizeRuneIds(runeIds);
  return selected.size > 0 && Array.isArray(team?.fighters) && team.fighters.some((fighter) => {
    const runeEntries = [
      ...(Array.isArray(fighter?.runes) ? fighter.runes : []),
      ...(fighter?.rune ? [fighter.rune] : [])
    ];
    return runeEntries.some((rune) => selected.has(runeIdentifier(rune)));
  });
}

export function historicalTeamMatchesBodyParts(team, selectedNames) {
  if (!Array.isArray(team?.fighters)) return { matched: false, known: false, unknownCount: 0, parts: [] };
  const matches = [];
  let knownFighterCount = 0;
  let unknownCount = 0;
  for (const fighter of team.fighters) {
    const result = fighterMatchesBodyParts(fighter, selectedNames);
    if (result.known) knownFighterCount += 1;
    else unknownCount += 1;
    matches.push(...result.parts);
  }
  return { matched: matches.length > 0, known: knownFighterCount > 0, unknownCount, parts: matches };
}

async function scanAcceptedSnapshot({
  repository,
  leaderboardScope,
  rankMin,
  rankMax,
  name,
  onProgress,
  inspectCandidate
}) {
  const { snapshot } = await loadAcceptedSnapshot(repository, leaderboardScope);
  const candidates = narrowCandidates(await repository.readFrozenCandidates(snapshot), { rankMin, rankMax, name });
  const matches = [];
  if (candidates.length === 0) {
    onProgress?.([], 0, 0, 0);
    return matches;
  }

  for (let start = 0; start < candidates.length; start += RUNE_SCAN_ENRICHMENT_BATCH_SIZE) {
    const batch = candidates.slice(start, start + RUNE_SCAN_ENRICHMENT_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (candidate) => {
      if (!candidate.userID) return { match: null, unknownCount: 0 };
      const normalizedRecord = await repository.readNormalizedBattleLog(snapshot, candidate.userID);
      const team = extractHistoricalTeam(candidate.userID, normalizedRecord);
      if (!team) return { match: null, unknownCount: 0 };
      return inspectCandidate({ candidate, team, normalizedRecord, snapshot });
    }));
    const batchMatches = batchResults.map((result) => result.match).filter(Boolean);
    const batchUnknownCount = batchResults.reduce((total, result) => total + (result.unknownCount || 0), 0);
    matches.push(...batchMatches);
    onProgress?.(batchMatches, Math.min(start + batch.length, candidates.length), candidates.length, batchUnknownCount);
  }
  return matches.sort((left, right) => (Number(left.rank) || Infinity) - (Number(right.rank) || Infinity));
}

// These scans read only an explicitly accepted local capture. They never call
// candidate, enrichment, or battle-log clients, and a player with unavailable
// team evidence is deliberately treated as an unknown non-match.
export async function scanHistoricalSnapshotForRunes(
  runeIds,
  leaderboardScope,
  {
    repository = new SnapshotRepository(),
    rankMin = 1,
    rankMax = LEADERBOARD_MAX_RANK,
    name = "",
    onProgress
  } = {}
) {
  return scanAcceptedSnapshot({
    repository,
    leaderboardScope,
    rankMin,
    rankMax,
    name,
    onProgress,
    inspectCandidate: ({ candidate, team, normalizedRecord, snapshot }) => ({
      match: historicalTeamHasRune(team, runeIds)
        ? mapHistoricalMatch(candidate, team, normalizedRecord, snapshot)
        : null,
      unknownCount: 0
    })
  });
}

export async function scanHistoricalSnapshotForBodyParts(
  selectedNames,
  leaderboardScope,
  {
    repository = new SnapshotRepository(),
    rankMin = 1,
    rankMax = LEADERBOARD_MAX_RANK,
    name = "",
    onProgress,
    matchTeam = historicalTeamMatchesBodyParts
  } = {}
) {
  return scanAcceptedSnapshot({
    repository,
    leaderboardScope,
    rankMin,
    rankMax,
    name,
    onProgress,
    inspectCandidate: ({ candidate, team, normalizedRecord, snapshot }) => {
      const result = matchTeam(team, selectedNames);
      return {
        match: result.matched
          ? { ...mapHistoricalMatch(candidate, team, normalizedRecord, snapshot), bodyParts: result.parts }
          : null,
        unknownCount: result.unknownCount || 0
      };
    }
  });
}
