import { getLeaderboardScopeKey, normalizeLeaderboardScope } from "../../leaderboard/leaderboardScope.js";
import { SnapshotRepository } from "./snapshotRepository.js";
import { getRuneMetadata } from "../leaderboard/runeCatalog.js";

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
    hasTeamEvidence: snapshot.hasTeamEvidence !== false,
    eraCoverage: snapshot.battleLogSummary.eraCoverage,
    candidateScope: snapshot.candidateScope
  };
}

function getSelectedBattleTimestamp(normalizedBattleLog) {
  if (normalizedBattleLog?.selectedBattleTimestamp) return normalizedBattleLog.selectedBattleTimestamp;

  const battles = Array.isArray(normalizedBattleLog?.rankedBattles)
    ? [...normalizedBattleLog.rankedBattles]
    : [];
  battles.sort((left, right) => Date.parse(right?.timestamp || 0) - Date.parse(left?.timestamp || 0));
  return battles[0]?.timestamp || null;
}

// Keep evidence separate from the team itself. This is application-facing
// provenance only; raw battle payloads remain in the local snapshot artifact.
function historicalTeamEvidence(normalizedBattleLog, hasTeam) {
  return {
    teamEvidence: normalizedBattleLog?.teamEvidence || (hasTeam ? "legacy" : "unavailable"),
    teamEvidenceReason: normalizedBattleLog?.teamEvidenceReason || null,
    selectedBattleTimestamp: getSelectedBattleTimestamp(normalizedBattleLog),
    capturedAt: normalizedBattleLog?.capturedAt || null
  };
}

function mapSnapshotFighter(fighter) {
  // Preserve the snapshot's raw rune array, but also provide the legacy
  // singular `rune` field that the live renderer expects. The `rune`
  // object must be lightweight and comes only from the snapshot; do not
  // attempt any live enrichment here.
  const rawRunes = Array.isArray(fighter?.runes)
    ? fighter.runes
    : (Array.isArray(fighter?.rune) ? fighter.rune : []);
  const runesArray = [...rawRunes];
  const firstRune = runesArray.length > 0 ? runesArray[0] : (fighter?.rune ?? fighter?.runeId ?? fighter?.runeID ?? null);

  // Normalize rune entries safely. Accept either string IDs or object shapes.
  // - string/number -> { id: String(...), name: null, imageUrl: null }
  // - object -> { id: String(id), name: string|null, imageUrl: string|null }
  // Never leave rune.id as a non-primitive object.
  function normalizeRuneEntry(entry) {
    if (entry == null) return null;
    if (Array.isArray(entry)) return normalizeRuneEntry(entry[0] ?? null);
    const t = typeof entry;
    if (t === "string" || t === "number" || t === "boolean") {
      const idStr = String(entry);
      const meta = getRuneMetadata(idStr);
      if (meta) return { id: meta.id, name: meta.name || null, imageUrl: meta.imageUrl || null };
      return { id: idStr, name: null, imageUrl: null };
    }
    if (t === "object") {
      let idVal = entry.id ?? entry.runeId ?? entry.runeID ?? entry.rune ?? null;
      if (idVal == null) {
        const nameFallback = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : null;
        if (nameFallback) return { id: String(nameFallback), name: nameFallback, imageUrl: null };
        return null;
      }
      if (typeof idVal === "object") idVal = String(idVal);
      else idVal = String(idVal);
      // Prefer explicit entry fields but hydrate from local registry when missing
      let name = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : null;
      let imageUrl = entry.imageUrl || entry.image_url || null;
      const meta = getRuneMetadata(idVal);
      if (meta) {
        if (!name) name = meta.name || null;
        if (!imageUrl) imageUrl = meta.imageUrl || null;
      }
      return { id: idVal, name, imageUrl };
    }
    const idStr = String(entry);
    const meta = getRuneMetadata(idStr);
    if (meta) return { id: meta.id, name: meta.name || null, imageUrl: meta.imageUrl || null };
    return { id: idStr, name: null, imageUrl: null };
  }

  const runeObj = normalizeRuneEntry(firstRune);

  return {
    axieID: fighter?.axieID,
    name: fighter?.name,
    genes: fighter?.genes,
    // The live renderer expects the existing singular field. Preserve raw
    // payloads untouched, but provide a stable compatibility property here.
    genes_metamorph: fighter?.genes_metamorph ?? fighter?.genes_metamorphed,
    position: Number(fighter?.position ?? 0),
    axieType: fighter?.axieType,
    // Keep raw array for any future uses that expect multiple runes.
    runes: runesArray,
    // Compatibility: single-runne expectation used by the renderer.
    rune: runeObj,
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

  // Check if this snapshot has team evidence
  if (snapshot.hasTeamEvidence === false) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      snapshot: snapshotMetadata(snapshot),
      error: "This historical snapshot contains only leaderboard candidates; team evidence is not available."
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
  const evidence = historicalTeamEvidence(normalizedBattleLog, Boolean(team));
  if (!team) {
    return {
      status: "unavailable",
      source: "historical-snapshot",
      snapshot: snapshotMetadata(snapshot),
      evidence,
      error: "No archived ranked team is available for this player."
    };
  }

  return {
    status: "ready",
    source: "historical-snapshot",
    team,
    fetchedAt: normalizedBattleLog.capturedAt,
    snapshot: snapshotMetadata(snapshot),
    evidence
  };
}
