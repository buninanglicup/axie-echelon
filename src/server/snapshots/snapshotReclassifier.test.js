import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository } from "./snapshotRepository.js";
import { reclassifySnapshot } from "./snapshotReclassifier.js";

test("creates a new bounded revision from existing raw evidence without an upstream request", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-reclassify-")));
  const source = await repository.createCapture({ seasonId: 19, milestone: 4 });
  await repository.writeCandidatePage(source, 1, { _items: [{ userID: "player-1" }] }, [{ userID: "player-1", rank: 1 }]);
  await repository.updateManifest(source, {
    candidateScope: { ...source.candidateScope, pagesFetched: 1, frozenCandidateCount: 1 }
  });
  await repository.writeBattleLog(source, "player-1", {
    rawResponse: {
      _items: [
        { gameData: { gameMode: "ranked", endedAt: 150, players: [{ userID: "player-1", team: { fighters: [{ axieID: 1 }] } }] } },
        { gameData: { gameMode: "ranked", endedAt: 250, players: [{ userID: "player-1", team: { fighters: [{ axieID: 2 }] } }] } }
      ]
    },
    normalized: { rankedBattles: [] }
  });
  const completedSource = await repository.publishCapture(source);

  const derived = await reclassifySnapshot({
    repository,
    sourceManifest: completedSource,
    eraWindow: { seasonId: 19, milestone: 4, eraName: "Final", eraStartedAt: 100, eraEndedAt: 200 }
  });

  assert.equal(derived.status, "completed");
  assert.equal(derived.revision, 2);
  assert.equal(derived.parentCaptureId, completedSource.captureId);
  assert.equal(derived.eraStartedAt, 100);
  assert.equal(derived.battleLogSummary.rankedBattlesInEraCount, 1);
  assert.equal((await repository.readNormalizedBattleLog(derived, "player-1")).rankedBattles[0].gameData.players[0].team.fighters[0].axieID, 1);
});
