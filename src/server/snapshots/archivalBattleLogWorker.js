import { createHash } from "node:crypto";
import { fetchArchivalBattleLogs, battleTimestamp, toEpochMs } from "./archivalBattleLogClient.js";

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

function assertVerifiedEraWindow(manifest) {
  const start = Number(manifest?.eraStartedAt);
  const end = Number(manifest?.eraEndedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Archival battle-log capture requires a verified era window.");
  }
}

export async function captureArchivalBattleLogs({
  repository,
  manifest,
  fetchClient = fetchArchivalBattleLogs,
  concurrency = 2,
  signal
}) {
  assertVerifiedEraWindow(manifest);
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

        // New compact-capture logic: deterministically select a single ranked
        // battle observed for the tracked player within the era window and
        // persist only the selected raw battle plus a normalized team view and
        // provenance metadata. Maintain backwards compatibility by leaving
        // legacy full-response normalization untouched when present.
        const rawItems = Array.isArray(record.rawResponse?._items) ? record.rawResponse._items : [];
        const eraStartMs = toEpochMs(current.eraStartedAt);
        const eraEndMs = toEpochMs(current.eraEndedAt);

        function trackedPlayerEntry(battle) {
          const players = Array.isArray(battle?.gameData?.players)
            ? battle.gameData.players
            : Array.isArray(battle?.players)
              ? battle.players
              : [];
          return players.find((player) => player?.userID === candidate.userID) ?? null;
        }

        const rankedInEraEntries = rawItems.map((battle, index) => {
          const mode = battle?.gameData?.gameMode || battle?.gameMode || null;
          const tsIso = battleTimestamp(battle);
          const tsMs = tsIso ? Date.parse(tsIso) : null;
          const playerEntry = trackedPlayerEntry(battle);
          const fighters = Array.isArray(playerEntry?.team?.fighters) ? playerEntry.team.fighters : null;
          const isObservedTeam = Array.isArray(fighters) && fighters.length > 0 && fighters.every((fighter) => fighter && typeof fighter === "object");
          const inEra = tsMs !== null && (!eraStartMs || tsMs >= eraStartMs) && (!eraEndMs || tsMs < eraEndMs);
          return { battle, index, tsIso, tsMs, mode, playerEntry, fighters, isObservedTeam, inEra };
        }).filter((entry) => entry.battle && entry.mode === "ranked" && entry.playerEntry && entry.inEra);

        const validSelectedCandidates = rankedInEraEntries.filter((entry) => entry.isObservedTeam);
        let selected = null;
        if (validSelectedCandidates.length > 0) {
          validSelectedCandidates.sort((left, right) => {
            if (left.tsMs !== right.tsMs) return right.tsMs - left.tsMs;
            const leftId = String(left.battle?.id ?? left.battle?.gameData?.id ?? "");
            const rightId = String(right.battle?.id ?? right.battle?.gameData?.id ?? "");
            if (leftId && rightId && leftId !== rightId) return leftId < rightId ? -1 : 1;
            return right.index - left.index;
          });
          selected = validSelectedCandidates[0];
        }

        const hasInvalidTrackedTeam = rankedInEraEntries.some((entry) => entry.playerEntry && !entry.isObservedTeam);
        const sourceResponseChecksum = record.checksum || null;
        const selectedRawChecksum = selected ? createHash("sha256").update(JSON.stringify(selected.battle), "utf8").digest("hex") : null;

        // Build the compact normalized evidence record
        const provenance = {
          playerID: candidate.userID,
          frozenCandidate: candidate,
          captureId: current.captureId,
          revision: current.revision,
          scopeKey: current.scopeKey,
          seasonId: current.seasonId,
          milestone: current.milestone,
          eraStartedAt: current.eraStartedAt,
          eraEndedAt: current.eraEndedAt,
          selectionAlgorithmVersion: 1,
          normalizerVersion: 1,
          captureTimestamp: new Date().toISOString(),
          source: "origin/v2/community/users/battle-logs",
          requestedLimit: record.requestedLimit || null,
          fetchedLogCount: record.normalized?.battleLogsFetchedCount ?? rawItems.length,
          rankedLogCount: record.normalized?.rankedBattlesInEraCount ?? rawItems.filter((battle) => (battle?.gameData?.gameMode === "ranked")).length,
          oldestReturnedAt: record.normalized?.oldestBattleReturnedAt ?? null,
          newestReturnedAt: record.normalized?.newestBattleReturnedAt ?? null,
          sourceResponseChecksum,
          selectedRawChecksum,
          reachedLimit: Boolean(record.requestedLimit && rawItems.length >= record.requestedLimit)
        };

        let compactNormalized;
        if (selected) {
          const playerEntry = trackedPlayerEntry(selected.battle);
          const fighters = Array.isArray(playerEntry?.team?.fighters) ? playerEntry.team.fighters : [];
          const mappedFighters = fighters.map((fighter) => ({
            axieID: fighter?.axieID,
            name: fighter?.name ?? null,
            genes: fighter?.genes ?? null,
            genes_metamorph: fighter?.genes_metamorphed ?? fighter?.genes_metamorph ?? null,
            position: Number(fighter?.position ?? 0),
            axieType: fighter?.axieType ?? null,
            runes: Array.isArray(fighter?.runes) ? fighter.runes : [],
            charms: fighter?.charms || null
          })).sort((left, right) => left.position - right.position);

          compactNormalized = {
            teamEvidence: "observed",
            teamEvidenceReason: "Captured team from the latest observed ranked battle in this era.",
            selectedBattleId: selected.battle?.id ?? selected.battle?.gameData?.id ?? null,
            selectedBattleTimestamp: selected.tsIso || null,
            selectedTeam: { fighters: mappedFighters },
            provenance,
            battleLogsFetchedCount: record.normalized?.battleLogsFetchedCount ?? provenance.fetchedLogCount,
            rankedBattlesInEraCount: record.normalized?.rankedBattlesInEraCount ?? provenance.rankedLogCount,
            oldestBattleReturnedAt: record.normalized?.oldestBattleReturnedAt ?? provenance.oldestReturnedAt,
            newestBattleReturnedAt: record.normalized?.newestBattleReturnedAt ?? provenance.newestReturnedAt,
            missingTimestampCount: record.normalized?.missingTimestampCount ?? 0,
            eraCoverage: record.normalized?.eraCoverage ?? "unknown"
          };
        } else if (hasInvalidTrackedTeam) {
          compactNormalized = {
            teamEvidence: "invalid",
            teamEvidenceReason: "INVALID_TRACKED_PLAYER_TEAM_FIGHTERS",
            selectedBattleId: null,
            selectedBattleTimestamp: null,
            selectedTeam: null,
            provenance,
            battleLogsFetchedCount: record.normalized?.battleLogsFetchedCount ?? provenance.fetchedLogCount,
            rankedBattlesInEraCount: record.normalized?.rankedBattlesInEraCount ?? provenance.rankedLogCount,
            oldestBattleReturnedAt: record.normalized?.oldestBattleReturnedAt ?? provenance.oldestReturnedAt,
            newestBattleReturnedAt: record.normalized?.newestBattleReturnedAt ?? provenance.newestReturnedAt,
            missingTimestampCount: record.normalized?.missingTimestampCount ?? 0,
            eraCoverage: record.normalized?.eraCoverage ?? "unknown"
          };
        } else {
          compactNormalized = {
            teamEvidence: "unavailable",
            teamEvidenceReason: "NO_VALID_IN_ERA_RANKED_BATTLE_FOUND_FOR_PLAYER",
            selectedBattleId: null,
            selectedBattleTimestamp: null,
            selectedTeam: null,
            provenance,
            battleLogsFetchedCount: record.normalized?.battleLogsFetchedCount ?? provenance.fetchedLogCount,
            rankedBattlesInEraCount: record.normalized?.rankedBattlesInEraCount ?? provenance.rankedLogCount,
            oldestBattleReturnedAt: record.normalized?.oldestBattleReturnedAt ?? provenance.oldestReturnedAt,
            newestBattleReturnedAt: record.normalized?.newestBattleReturnedAt ?? provenance.newestReturnedAt,
            missingTimestampCount: record.normalized?.missingTimestampCount ?? 0,
            eraCoverage: record.normalized?.eraCoverage ?? "unknown"
          };
        }

        // Persist only the selected raw object and the compact normalized view.
        await repository.writeBattleLog(current, candidate.userID, {
          rawResponse: selected ? selected.battle : null,
          checksum: selectedRawChecksum,
          capturedAt: record.capturedAt || new Date().toISOString(),
          status: record.status || "fetched",
          httpStatus: record.httpStatus ?? null,
          requestedLimit: record.requestedLimit ?? null,
          normalized: compactNormalized
        });
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
