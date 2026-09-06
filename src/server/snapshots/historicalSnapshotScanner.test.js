import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository } from "./snapshotRepository.js";
import {
  scanHistoricalSnapshotForBodyParts,
  scanHistoricalSnapshotForRunes
} from "./historicalSnapshotScanner.js";

const scope = { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" };

async function createAcceptedSnapshot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "axie-historical-scan-"));
  const repository = new SnapshotRepository(root);
  let manifest = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraName: "Final",
    eraStartedAt: 1787110200,
    eraEndedAt: 1788319800
  });
  const candidates = [
    { rank: 1, userID: "player-a", name: "Alpha", mmr: 2400 },
    { rank: 2, userID: "player-b", name: "Bravo", mmr: 2300 },
    { rank: 3, userID: "player-c", name: "Charlie", mmr: 2200 }
  ];
  await repository.writeCandidatePage(manifest, 1, { _items: [] }, candidates);
  manifest = await repository.updateManifest(manifest, {
    status: "running",
    candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: candidates.length }
  });
  await repository.writeBattleLog(manifest, "player-a", {
    rawResponse: { id: "synthetic-a" },
    normalized: {
      selectedBattleTimestamp: "2026-09-01T10:00:00.000Z",
      selectedTeam: { fighters: [{ axieID: 101, position: 0, runes: ["rune-a"] }] }
    }
  });
  await repository.writeBattleLog(manifest, "player-b", {
    rawResponse: { id: "synthetic-b" },
    normalized: {
      selectedBattleTimestamp: "2026-09-01T11:00:00.000Z",
      selectedTeam: { fighters: [{ axieID: 102, position: 0, runes: [{ id: "rune-b" }] }] }
    }
  });
  const completed = await repository.publishCapture(manifest);
  await repository.acceptCapture(completed);
  return { root, repository };
}

test("matches multiple rune selections with OR semantics using only accepted snapshot evidence", async () => {
  const { root, repository } = await createAcceptedSnapshot();
  const progress = [];
  const matches = await scanHistoricalSnapshotForRunes(["rune-a", "rune-b"], scope, {
    repository,
    onProgress: (batch, processed, total) => progress.push({ batch, processed, total })
  });

  assert.deepEqual(matches.map((match) => match.userID), ["player-a", "player-b"]);
  assert.equal(matches[0].source, "historical-snapshot");
  assert.equal(matches[0].snapshot.scopeKey, "season:19:milestone:4");
  assert.equal(matches[1].lastRankedBattleTime, "2026-09-01T11:00:00.000Z");
  assert.deepEqual(progress.at(-1), { batch: matches, processed: 3, total: 3 });
  await rm(root, { recursive: true, force: true });
});

test("applies rank/name narrowing and ignores unavailable historical team evidence", async () => {
  const { root, repository } = await createAcceptedSnapshot();
  const matches = await scanHistoricalSnapshotForRunes(["rune-a", "rune-b"], scope, {
    repository,
    rankMin: 2,
    rankMax: 3,
    name: "brav"
  });

  assert.deepEqual(matches.map((match) => match.userID), ["player-b"]);
  await rm(root, { recursive: true, force: true });
});

test("matches multiple body parts with OR semantics without a live enrichment fallback", async () => {
  const { root, repository } = await createAcceptedSnapshot();
  const matches = await scanHistoricalSnapshotForBodyParts(["Hazy", "Clear"], scope, {
    repository,
    matchTeam: (team, selectedNames) => {
      const marker = team.fighters[0].axieID === 101 ? "hazy" : "clear";
      const matched = selectedNames.some((name) => name.toLowerCase() === marker);
      return { matched, known: true, unknownCount: 0, parts: matched ? [{ canonicalName: marker }] : [] };
    }
  });

  assert.deepEqual(matches.map((match) => match.userID), ["player-a", "player-b"]);
  assert.deepEqual(matches.map((match) => match.bodyParts[0].canonicalName), ["hazy", "clear"]);
  await rm(root, { recursive: true, force: true });
});

test("fails closed when no accepted bounded snapshot exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "axie-historical-scan-missing-"));
  const repository = new SnapshotRepository(root);
  await assert.rejects(
    () => scanHistoricalSnapshotForRunes(["rune-a"], scope, { repository }),
    (error) => error.code === "HISTORICAL_SNAPSHOT_UNAVAILABLE"
  );
  await rm(root, { recursive: true, force: true });
});
