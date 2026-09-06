import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository } from "./snapshotRepository.js";
import { captureArchivalBattleLogs } from "./archivalBattleLogWorker.js";

test("persists successful players and sanitized failures, then resumes only unfinished players", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-worker-")));
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 4 });
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
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 2 });
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
