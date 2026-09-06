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
  let completedPlayers = 0;
  let failedPlayers = 0;
  let attemptedPlayers = manifest.progress.attemptedPlayers || 0;
  const pending = [];
  for (const candidate of candidates) {
    if (!candidate.userID) continue;
    if (await repository.hasBattleLog(manifest, candidate.userID)) {
      completedPlayers += 1;
      continue;
    }
    if (await repository.hasFailure(manifest, candidate.userID)) failedPlayers += 1;
    pending.push(candidate);
  }
  const current = await repository.updateManifest(manifest, {
    status: "running",
    progress: {
      ...manifest.progress,
      pendingPlayers: pending.length,
      completedPlayers,
      failedPlayers,
      attemptedPlayers
    }
  });
  let battleLogsFetchedCount = current.battleLogSummary.battleLogsFetchedCount || 0;
  let rankedBattlesInEraCount = current.battleLogSummary.rankedBattlesInEraCount || 0;
  let missingTimestampCount = current.battleLogSummary.missingTimestampCount || 0;
  const oldestBattleTimes = [];
  const newestBattleTimes = [];
  let coverageValues = [current.battleLogSummary.eraCoverage];
  let processedThisRun = 0;

  async function persistProgress() {
    await repository.updateManifest(current, {
      progress: {
        ...current.progress,
        pendingPlayers: Math.max(0, pending.length - processedThisRun),
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
  }

  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      if (signal?.aborted) throw cancellationError();
      const candidate = pending[cursor++];
      const hadFailure = await repository.hasFailure(current, candidate.userID);
      let record;
      try {
        record = await fetchClient({
          userId: candidate.userID,
          eraStartedAt: current.eraStartedAt,
          eraEndedAt: current.eraEndedAt,
          signal
        });
        await repository.writeBattleLog(current, candidate.userID, record);
      } catch (error) {
        if (signal?.aborted) throw cancellationError();
        const failureAttempt = attemptedPlayers + 1;
        await repository.writeFailure(current, candidate.userID, {
          status: error.status,
          code: error.code || "SNAPSHOT_BATTLE_LOG_FAILED",
          message: error.message,
          retryable: error.retryable
        }, failureAttempt);
        if (!hadFailure) failedPlayers += 1;
        attemptedPlayers += 1;
        processedThisRun += 1;
        await persistProgress();
        continue;
      }

      // A player record is durable before progress is updated. If the latter
      // fails, a later resume derives completion from the saved raw and
      // normalized files instead of recording a false player failure.
      completedPlayers += 1;
      if (hadFailure) failedPlayers -= 1;
      attemptedPlayers += 1;
      processedThisRun += 1;
      battleLogsFetchedCount += record.normalized.battleLogsFetchedCount;
      rankedBattlesInEraCount += record.normalized.rankedBattlesInEraCount;
      missingTimestampCount += record.normalized.missingTimestampCount;
      if (record.normalized.oldestBattleReturnedAt) oldestBattleTimes.push(record.normalized.oldestBattleReturnedAt);
      if (record.normalized.newestBattleReturnedAt) newestBattleTimes.push(record.normalized.newestBattleReturnedAt);
      coverageValues.push(record.normalized.eraCoverage);
      await persistProgress();
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    const finished = await repository.readManifest(current);
    if (finished.progress.failedPlayers > 0 || finished.progress.pendingPlayers > 0) {
      return repository.updateManifest(current, { status: "partial" });
    }
    return repository.publishCapture(current);
  } catch (error) {
    if (error.code === "SNAPSHOT_BATTLE_LOG_CANCELLED" || signal?.aborted) {
      return repository.updateManifest(current, { status: "cancelled", cancelledAt: new Date().toISOString() });
    }
    throw error;
  }
}
