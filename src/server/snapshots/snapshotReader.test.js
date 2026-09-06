import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository } from "./snapshotRepository.js";
import { getHistoricalSnapshotCandidates, getHistoricalSnapshotEnrichment } from "./snapshotReader.js";

async function createAcceptedSnapshot() {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-reader-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeBattleLog(manifest, "player-1", {
    rawResponse: { _items: [] },
    normalized: {
      rankedBattles: [{
        timestamp: "2026-09-01T10:00:00.000Z",
        gameData: {
          players: [{
            userID: "player-1",
            team: { fighters: [{ axieID: 7, position: 2, genes: "genes", genes_metamorphed: "captured-genes", runes: ["rune-1"], charms: { eyes: "charm" } }] }
          }]
        }
      }]
    }
  });
  const completed = await repository.publishCapture(manifest);
  await repository.acceptCapture(completed);
  return { repository, scope: { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" } };
}

test("reads an accepted snapshot without reaching the live enrichment path", async () => {
  const { repository, scope } = await createAcceptedSnapshot();
  const result = await getHistoricalSnapshotEnrichment({ repository, leaderboardScope: scope, userID: "player-1" });

  assert.equal(result.status, "ready");
  assert.equal(result.source, "historical-snapshot");
  assert.equal(result.team.fighters[0].axieID, 7);
  assert.equal(result.team.fighters[0].genes_metamorph, "captured-genes");
  assert.equal(result.snapshot.scopeKey, "season:19:milestone:4");
});

test("reads compact selected-team evidence from an accepted historical snapshot", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-reader-compact-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeBattleLog(manifest, "player-1", {
    rawResponse: {
      id: "battle-compact",
      gameData: {
        players: [{
          userID: "player-1",
          team: { fighters: [{ axieID: 27, position: 2, genes: "genes", genes_metamorphed: "compact-genes", runes: ["rune-1"], charms: { eyes: "charm" } }] }
        }]
      }
    },
    normalized: {
      teamEvidence: "observed",
      teamEvidenceReason: "Captured team from the latest observed ranked battle in this era.",
      selectedBattleId: "battle-compact",
      selectedBattleTimestamp: "2026-09-01T10:00:00.000Z",
      selectedTeam: { fighters: [{ axieID: 27, position: 2, genes: "genes", genes_metamorph: "compact-genes", runes: ["rune-1"], charms: { eyes: "charm" } }] },
      provenance: { playerID: "player-1" }
    }
  });
  const completed = await repository.publishCapture(manifest);
  await repository.acceptCapture(completed);

  const result = await getHistoricalSnapshotEnrichment({
    repository,
    leaderboardScope: { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" },
    userID: "player-1"
  });

  assert.equal(result.status, "ready");
  assert.equal(result.team.fighters[0].axieID, 27);
  assert.equal(result.team.fighters[0].genes_metamorph, "compact-genes");
});

test("reads frozen candidate rows from an accepted snapshot without a live candidate source", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-reader-candidates-")));
  const manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  await repository.writeCandidatePage(manifest, 1, { _items: [] }, [
    { rank: 1, userID: "player-1", name: "Snapshot One", mmr: 2300 },
    { rank: 2, userID: "player-2", name: "Snapshot Two", mmr: 2200 }
  ]);
  await repository.updateManifest(manifest, {
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 2 }
  });
  const completed = await repository.publishCapture(manifest);
  await repository.acceptCapture(completed);

  const result = await getHistoricalSnapshotCandidates({
    repository,
    leaderboardScope: { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" },
    rankMin: 2,
    rankMax: 2
  });

  assert.equal(result.status, "ready");
  assert.equal(result.source, "historical-snapshot");
  assert.deepEqual(result.players.map((player) => player.userID), ["player-2"]);
  assert.equal(result.snapshot.captureId, completed.captureId);
});

test("returns unavailable when an era has no accepted snapshot", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-reader-")));
  const result = await getHistoricalSnapshotEnrichment({
    repository,
    leaderboardScope: { seasonId: 19, offSeasonMode: false, milestone: 3, eraName: "Mystic" },
    userID: "player-1"
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.error, /No accepted historical team snapshot/i);
});

test("does not present an unbounded accepted capture as historical team data", async () => {
  const repository = new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-reader-")));
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 4 });
  const completed = await repository.publishCapture(manifest);
  await repository.acceptCapture(completed);

  const result = await getHistoricalSnapshotEnrichment({
    repository,
    leaderboardScope: { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" },
    userID: "player-1"
  });

  assert.equal(result.status, "unavailable");
  assert.match(result.error, /no verified era window/i);
});
