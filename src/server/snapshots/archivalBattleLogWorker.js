import { fetchArchivalBattleLogs } from "./archivalBattleLogClient.js";

function cancellationError() {
  const error = new Error("Archival battle-log capture was cancelled.");
  error.code = "SNAPSHOT_BATTLE_LOG_CANCELLED";
  return error;
}

function aggregateCoverage(records) {
  const coverage = records.map((record) => typeof record === "string" ? record : record.normalized.eraCoverage);
  return coverage.length > 0 && coverage.every((value) => value === "complete")
    ? "complete"
    : coverage.some((value) => value === "partial") ? "partial" : "unknown";
}

export async function captureArchivalBattleLogs({
  repository,
  manifest,
  fetchClient = fetchArchivalBattleLogs,
  concurrency = 2,
  signal
}) {
  const candidates = await repository.readFrozenCandidates(manifest);
  const current = await repository.updateManifest(manifest, {
    status: "running",
    progress: {
      ...manifest.progress,
      pendingPlayers: candidates.length,
      attemptedPlayers: manifest.progress.attemptedPlayers || 0
    }
  });
  let completedPlayers = current.progress.completedPlayers || 0;
  let failedPlayers = current.progress.failedPlayers || 0;
  let attemptedPlayers = current.progress.attemptedPlayers || 0;
  let battleLogsFetchedCount = current.battleLogSummary.battleLogsFetchedCount || 0;
  let rankedBattlesInEraCount = current.battleLogSummary.rankedBattlesInEraCount || 0;
  let missingTimestampCount = current.battleLogSummary.missingTimestampCount || 0;
  const oldestBattleTimes = [];
  const newestBattleTimes = [];
  let coverageValues = [];
  const records = [];
  const pending = [];
  for (const candidate of candidates) {
    if (!candidate.userID || await repository.hasBattleLog(current, candidate.userID)) continue;
    pending.push(candidate);
  }
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      if (signal?.aborted) throw cancellationError();
      const candidate = pending[cursor++];
      try {
        const record = await fetchClient({
          userId: candidate.userID,
          eraStartedAt: current.eraStartedAt,
          eraEndedAt: current.eraEndedAt,
          signal
        });
        await repository.writeBattleLog(current, candidate.userID, record);
        records.push(record);
        completedPlayers += 1;
        attemptedPlayers += 1;
        battleLogsFetchedCount += record.normalized.battleLogsFetchedCount;
        rankedBattlesInEraCount += record.normalized.rankedBattlesInEraCount;
        missingTimestampCount += record.normalized.missingTimestampCount;
        if (record.normalized.oldestBattleReturnedAt) oldestBattleTimes.push(record.normalized.oldestBattleReturnedAt);
        if (record.normalized.newestBattleReturnedAt) newestBattleTimes.push(record.normalized.newestBattleReturnedAt);
        coverageValues.push(record.normalized.eraCoverage);
        await repository.updateManifest(current, {
          progress: {
            ...current.progress,
            pendingPlayers: Math.max(0, candidates.length - completedPlayers - failedPlayers),
            completedPlayers,
            failedPlayers,
            attemptedPlayers
          },
          battleLogSummary: {
            ...current.battleLogSummary,
            battleLogsFetchedCount,
            rankedBattlesInEraCount,
            oldestBattleReturnedAt: oldestBattleTimes.sort()[0] || current.battleLogSummary.oldestBattleReturnedAt,
            newestBattleReturnedAt: newestBattleTimes.sort().at(-1) || current.battleLogSummary.newestBattleReturnedAt,
            missingTimestampCount,
            eraCoverage: aggregateCoverage(coverageValues)
          }
        });
      } catch (error) {
        await repository.writeFailure(current, candidate.userID, {
          status: error.status,
          code: error.code || "SNAPSHOT_BATTLE_LOG_FAILED",
          message: error.message,
          retryable: error.retryable
        });
        failedPlayers += 1;
        attemptedPlayers += 1;
        await repository.updateManifest(current, {
          progress: {
            ...current.progress,
            pendingPlayers: Math.max(0, candidates.length - completedPlayers - failedPlayers),
            completedPlayers,
            failedPlayers,
            attemptedPlayers
          }
        });
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    return repository.readManifest(current);
  } catch (error) {
    if (error.code === "SNAPSHOT_BATTLE_LOG_CANCELLED" || signal?.aborted) {
      return repository.updateManifest(current, { status: "cancelled", cancelledAt: new Date().toISOString() });
    }
    throw error;
  }
}
