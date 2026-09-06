import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository } from "./snapshotRepository.js";
import { captureArchivalBattleLogs } from "./archivalBattleLogWorker.js";

test("persists successful players and sanitized failures, then resumes only unfinished players", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeCandidatePage(manifest, 1, {}, [
    { userID: "user-1", rank: 1 },
    { userID: "user-2", rank: 2 },
    { userID: "user-3", rank: 3 }
  ]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 3 }
  });
  let calls = 0;
  let userTwoCalls = 0;
  const fetchClient = async ({ userId }) => {
    calls += 1;
    if (userId === "user-2") {
      userTwoCalls += 1;
      if (userTwoCalls > 1) return { rawResponse: { _items: [] }, normalized: {
        battleLogsFetchedCount: 0, rankedBattlesInEraCount: 0,
        oldestBattleReturnedAt: null, newestBattleReturnedAt: null,
        missingTimestampCount: 0, eraCoverage: "unknown"
      }, checksum: "hash" };
      const error = new Error("busy");
      error.status = 429;
      error.retryable = true;
      throw error;
    }
    return { rawResponse: { _items: [] }, normalized: {
      battleLogsFetchedCount: 0, rankedBattlesInEraCount: 0,
      oldestBattleReturnedAt: null, newestBattleReturnedAt: null,
      missingTimestampCount: 0, eraCoverage: "unknown"
    }, checksum: "hash" };
  };
  const first = await captureArchivalBattleLogs({ repository, manifest, fetchClient, concurrency: 1 });
  assert.equal(first.progress.completedPlayers, 2);
  assert.equal(first.progress.failedPlayers, 1);
  assert.equal(calls, 3);

  const second = await captureArchivalBattleLogs({ repository, manifest: first, fetchClient, concurrency: 1 });
  assert.equal(second.status, "completed");
  assert.equal(second.progress.completedPlayers, 3);
  assert.equal(second.progress.failedPlayers, 0);
  assert.equal(calls, 4);
});

test("cancels after persisted progress without scheduling the next player", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-cancel-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 2,
    eraStartedAt: 1784691000,
    eraEndedAt: 1785900600
  });
  await repository.writeCandidatePage(manifest, 1, {}, [
    { userID: "user-1", rank: 1 },
    { userID: "user-2", rank: 2 }
  ]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 2 }
  });
  const controller = new AbortController();
  let calls = 0;
  const result = await captureArchivalBattleLogs({
    repository,
    manifest,
    concurrency: 1,
    signal: controller.signal,
    fetchClient: async () => {
      calls += 1;
      controller.abort();
      return { rawResponse: {}, normalized: {
        battleLogsFetchedCount: 1, rankedBattlesInEraCount: 0,
        oldestBattleReturnedAt: null, newestBattleReturnedAt: null,
        missingTimestampCount: 1, eraCoverage: "unknown"
      }, checksum: "hash" };
    }
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.progress.completedPlayers, 1);
  assert.equal(calls, 1);
});

test("selects the latest in-era ranked battle and stores raw/source checksum metadata separately", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-compact-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeCandidatePage(manifest, 1, {}, [{ userID: "user-1", rank: 1 }]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 1 }
  });

  const selectedBattle = {
    id: "battle-2",
    gameData: {
      gameMode: "ranked",
      endedAt: 1787400000,
      players: [
        { userID: "user-1", team: { fighters: [{ axieID: 12, position: 1 }] } },
        { userID: "user-2", team: { fighters: [{ axieID: 90, position: 1 }] } }
      ]
    }
  };
  const fetchClient = async () => ({
    rawResponse: {
      _items: [
        selectedBattle,
        { id: "battle-1", gameData: { gameMode: "ranked", endedAt: 1787300000, players: [{ userID: "user-1", team: { fighters: [{ axieID: 7, position: 2 }] } }, { userID: "user-2", team: { fighters: [{ axieID: 88, position: 2 }] } }] } },
        { id: "battle-out", gameData: { gameMode: "ranked", endedAt: 1787000000, players: [{ userID: "user-1", team: { fighters: [{ axieID: 99, position: 3 }] } }] } },
        { id: "battle-unranked", gameData: { gameMode: "unranked", endedAt: 1787900000, players: [{ userID: "user-1", team: { fighters: [{ axieID: 3, position: 1 }] } }] } },
        { id: "battle-missing-ts", gameData: { gameMode: "ranked", players: [{ userID: "user-1", team: { fighters: [{ axieID: 44, position: 1 }] } }] } }
      ]
    },
    normalized: {
      battleLogsFetchedCount: 5,
      rankedBattlesInEraCount: 3,
      oldestBattleReturnedAt: "2026-09-01T00:00:00.000Z",
      newestBattleReturnedAt: "2026-09-03T00:00:00.000Z",
      missingTimestampCount: 1,
      eraCoverage: "partial"
    },
    checksum: "full-response-checksum",
    requestedLimit: 20,
    httpStatus: 200,
    status: "fetched"
  });

  const completed = await captureArchivalBattleLogs({ repository, manifest, fetchClient, concurrency: 1 });
  const normalized = await repository.readNormalizedBattleLog(completed, "user-1");
  const raw = await repository.readRawBattleLog(completed, "user-1");
  const selectedRawChecksum = createHash("sha256").update(JSON.stringify(selectedBattle), "utf8").digest("hex");

  assert.equal(normalized.teamEvidence, "observed");
  assert.equal(normalized.teamEvidenceReason, "Captured team from the latest observed ranked battle in this era.");
  assert.equal(normalized.selectedBattleId, "battle-2");
  assert.equal(normalized.selectedTeam.fighters[0].axieID, 12);
  assert.equal("selectedBattleRaw" in normalized, false);
  assert.equal(raw.rawResponse.id, "battle-2");
  assert.equal(raw.checksum, selectedRawChecksum);
  assert.equal(normalized.provenance.sourceResponseChecksum, "full-response-checksum");
  assert.notEqual(raw.checksum, normalized.provenance.sourceResponseChecksum);
  assert.equal(normalized.provenance.playerID, "user-1");
  assert.equal(normalized.provenance.selectionAlgorithmVersion, 1);
  assert.equal(normalized.provenance.normalizerVersion, 1);
  assert.equal(normalized.provenance.reachedLimit, false);
});

test("never selects the opponent team when the tracked player is absent", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-opponent-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeCandidatePage(manifest, 1, {}, [{ userID: "user-1", rank: 1 }]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 1 }
  });

  const fetchClient = async () => ({
    rawResponse: {
      _items: [
        { id: "battle-opponent", gameData: { gameMode: "ranked", endedAt: 1788200000, players: [{ userID: "user-2", team: { fighters: [{ axieID: 77, position: 1 }] } }] } }
      ]
    },
    normalized: { battleLogsFetchedCount: 1, rankedBattlesInEraCount: 1, oldestBattleReturnedAt: "2026-09-03T00:00:00.000Z", newestBattleReturnedAt: "2026-09-03T00:00:00.000Z", missingTimestampCount: 0, eraCoverage: "unknown" },
    checksum: "full-opponent-checksum",
    requestedLimit: 20,
    httpStatus: 200,
    status: "fetched"
  });

  const completed = await captureArchivalBattleLogs({ repository, manifest, fetchClient, concurrency: 1 });
  const normalized = await repository.readNormalizedBattleLog(completed, "user-1");
  const raw = await repository.readRawBattleLog(completed, "user-1");

  assert.equal(normalized.teamEvidence, "unavailable");
  assert.equal(normalized.teamEvidenceReason, "NO_VALID_IN_ERA_RANKED_BATTLE_FOUND_FOR_PLAYER");
  assert.equal(normalized.selectedBattleId, null);
  assert.equal(raw.rawResponse, null);
});

test("creates invalid evidence when the tracked player's team is empty or malformed", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-invalid-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeCandidatePage(manifest, 1, {}, [{ userID: "user-1", rank: 1 }]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 1 }
  });

  const fetchClient = async () => ({
    rawResponse: {
      _items: [
        { id: "battle-invalid", gameData: { gameMode: "ranked", endedAt: 1787600000, players: [{ userID: "user-1", team: { fighters: [] } }] } }
      ]
    },
    normalized: { battleLogsFetchedCount: 1, rankedBattlesInEraCount: 1, oldestBattleReturnedAt: "2026-09-03T00:00:00.000Z", newestBattleReturnedAt: "2026-09-03T00:00:00.000Z", missingTimestampCount: 0, eraCoverage: "unknown" },
    checksum: "full-invalid-checksum",
    requestedLimit: 20,
    httpStatus: 200,
    status: "fetched"
  });

  const completed = await captureArchivalBattleLogs({ repository, manifest, fetchClient, concurrency: 1 });
  const normalized = await repository.readNormalizedBattleLog(completed, "user-1");
  const raw = await repository.readRawBattleLog(completed, "user-1");

  assert.equal(normalized.teamEvidence, "invalid");
  assert.equal(normalized.teamEvidenceReason, "INVALID_TRACKED_PLAYER_TEAM_FIGHTERS");
  assert.equal(normalized.selectedBattleId, null);
  assert.equal(raw.rawResponse, null);
});

test("uses a deterministic battle-id tie-breaker when timestamps are equal", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-tie-break-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeCandidatePage(manifest, 1, {}, [{ userID: "user-1", rank: 1 }]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 1 }
  });

  const fetchClient = async () => ({
    rawResponse: {
      _items: [
        { id: "battle-z", gameData: { gameMode: "ranked", endedAt: 1787500000, players: [{ userID: "user-1", team: { fighters: [{ axieID: 55, position: 1 }] } }] } },
        { id: "battle-a", gameData: { gameMode: "ranked", endedAt: 1787500000, players: [{ userID: "user-1", team: { fighters: [{ axieID: 66, position: 1 }] } }] } }
      ]
    },
    normalized: { battleLogsFetchedCount: 2, rankedBattlesInEraCount: 2, oldestBattleReturnedAt: "2026-09-01T00:00:00.000Z", newestBattleReturnedAt: "2026-09-03T00:00:00.000Z", missingTimestampCount: 0, eraCoverage: "partial" },
    checksum: "full-tie-checksum",
    requestedLimit: 20,
    httpStatus: 200,
    status: "fetched"
  });

  const completed = await captureArchivalBattleLogs({ repository, manifest, fetchClient, concurrency: 1 });
  const normalized = await repository.readNormalizedBattleLog(completed, "user-1");
  assert.equal(normalized.selectedBattleId, "battle-a");
  assert.equal(normalized.selectedTeam.fighters[0].axieID, 66);
});

test("rejects an archival capture that lacks an era window", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-unbounded-")));
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 4 });

  await assert.rejects(
    captureArchivalBattleLogs({ repository, manifest }),
    /requires a verified era window/i
  );
});
