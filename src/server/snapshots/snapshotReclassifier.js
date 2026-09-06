import { normalizeBattleLogs } from "./archivalBattleLogClient.js";

function aggregateCoverage(coverageValues) {
  return coverageValues.length > 0 && coverageValues.every((value) => value === "complete")
    ? "complete"
    : coverageValues.some((value) => value === "partial") ? "partial" : "unknown";
}

function cancelledError() {
  const error = new Error("Historical snapshot reclassification was cancelled.");
  error.code = "SNAPSHOT_RECLASSIFY_CANCELLED";
  return error;
}

function assertSourceAndWindow(source, eraWindow) {
  if (source.status !== "completed") throw new Error("Only a completed snapshot can be reclassified.");
  if (source.seasonId !== eraWindow.seasonId || String(source.milestone) !== String(eraWindow.milestone)) {
    throw new Error("The reclassification era window must match the source snapshot scope.");
  }
  if (!Number.isFinite(Number(eraWindow.eraStartedAt)) || !Number.isFinite(Number(eraWindow.eraEndedAt))) {
    throw new Error("Reclassification requires a verified era window.");
  }
}

// Rebuilds normalized views from immutable, already-local raw payloads. This
// is intentionally not a refresh: it performs no upstream request and creates
// a new revision linked to the source evidence.
export async function reclassifySnapshot({ repository, sourceManifest, eraWindow, signal }) {
  const source = await repository.readManifest(sourceManifest);
  assertSourceAndWindow(source, eraWindow);

  const derived = await repository.createCapture({
    seasonId: source.seasonId,
    milestone: source.milestone,
    eraName: eraWindow.eraName,
    eraStartedAt: eraWindow.eraStartedAt,
    eraEndedAt: eraWindow.eraEndedAt,
    candidateScope: { ...source.candidateScope },
    parentCaptureId: source.captureId
  });

  try {
    for (let page = 1; page <= source.candidateScope.pagesFetched; page += 1) {
      if (signal?.aborted) throw cancelledError();
      const sourcePage = await repository.readCandidatePage(source, page);
      await repository.writeCandidatePage(derived, page, sourcePage.raw, sourcePage.normalized);
    }

    let current = await repository.updateManifest(derived, {
      status: "running",
      progress: {
        pendingPlayers: source.candidateScope.frozenCandidateCount,
        completedPlayers: 0,
        failedPlayers: 0,
        attemptedPlayers: 0
      }
    });
    const candidates = await repository.readFrozenCandidates(current);
    let completedPlayers = 0;
    let failedPlayers = 0;
    let attemptedPlayers = 0;
    let battleLogsFetchedCount = 0;
    let rankedBattlesInEraCount = 0;
    let missingTimestampCount = 0;
    const oldestBattleTimes = [];
    const newestBattleTimes = [];
    const coverageValues = [];

    for (const candidate of candidates) {
      if (signal?.aborted) throw cancelledError();
      const sourceRecord = await repository.readRawBattleLog(source, candidate.userID);
      attemptedPlayers += 1;
      if (!sourceRecord?.rawResponse) {
        failedPlayers += 1;
        await repository.writeFailure(current, candidate.userID, {
          code: "SNAPSHOT_SOURCE_RECORD_MISSING",
          message: "The source snapshot has no raw battle-log record for this player.",
          retryable: false
        });
      } else {
        const normalized = normalizeBattleLogs(
          candidate.userID,
          sourceRecord.rawResponse,
          eraWindow.eraStartedAt,
          eraWindow.eraEndedAt
        );
        await repository.writeBattleLog(current, candidate.userID, {
          rawResponse: sourceRecord.rawResponse,
          checksum: sourceRecord.checksum,
          capturedAt: sourceRecord.capturedAt,
          status: sourceRecord.status,
          httpStatus: sourceRecord.httpStatus,
          requestedLimit: sourceRecord.requestedLimit,
          normalized
        });
        completedPlayers += 1;
        battleLogsFetchedCount += normalized.battleLogsFetchedCount;
        rankedBattlesInEraCount += normalized.rankedBattlesInEraCount;
        missingTimestampCount += normalized.missingTimestampCount;
        if (normalized.oldestBattleReturnedAt) oldestBattleTimes.push(normalized.oldestBattleReturnedAt);
        if (normalized.newestBattleReturnedAt) newestBattleTimes.push(normalized.newestBattleReturnedAt);
        coverageValues.push(normalized.eraCoverage);
      }

      current = await repository.updateManifest(current, {
        progress: {
          pendingPlayers: Math.max(0, candidates.length - attemptedPlayers),
          completedPlayers,
          failedPlayers,
          attemptedPlayers
        },
        battleLogSummary: {
          ...current.battleLogSummary,
          battleLogsFetchedCount,
          rankedBattlesInEraCount,
          oldestBattleReturnedAt: oldestBattleTimes.sort()[0] || null,
          newestBattleReturnedAt: newestBattleTimes.sort().at(-1) || null,
          missingTimestampCount,
          eraCoverage: aggregateCoverage(coverageValues)
        }
      });
    }

    if (failedPlayers > 0) return repository.updateManifest(current, { status: "partial" });
    return repository.publishCapture(current);
  } catch (error) {
    if (error.code === "SNAPSHOT_RECLASSIFY_CANCELLED" || signal?.aborted) {
      return repository.updateManifest(derived, { status: "cancelled", cancelledAt: new Date().toISOString() });
    }
    throw error;
  }
}
