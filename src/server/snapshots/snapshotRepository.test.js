import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository, playerFileId } from "./snapshotRepository.js";

async function createRepository() {
  return new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-snapshot-")));
}

test("creates staged captures with an index and separate raw/normalized records", async () => {
  const repository = await createRepository();
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 4 });

  assert.equal(manifest.scopeKey, "season:19:milestone:4");
  await repository.writeCandidatePage(manifest, 1, { _items: [{ userID: "user-1" }] }, [{ userID: "user-1", rank: 1 }]);
  await repository.writeBattleLog(manifest, "user-1", { rawResponse: { _items: [] }, normalized: { rankedBattles: [] } });
  await repository.writeFailure(manifest, "user-2", { status: 429, message: "rate limited", retryable: true });

  const directory = await repository.getCaptureDirectory(manifest);
  assert.match(await readFile(path.join(directory, "candidate-pages", "0001.raw.json"), "utf8"), /user-1/);
  assert.match(await readFile(path.join(directory, "candidate-pages", "0001.normalized.json"), "utf8"), /rank/);
  assert.match(await readFile(path.join(directory, "battle-logs", `${playerFileId("user-1")}.raw.json`), "utf8"), /rawResponse/);
  assert.match(await readFile(path.join(directory, "failures", `${playerFileId("user-2")}-attempt-001.json`), "utf8"), /rate limited/);
  assert.match(await readFile(path.join(path.dirname(path.dirname(directory)), "index.json"), "utf8"), /captureId/);
});

test("uses stable hashes for hostile and long player IDs", () => {
  const id = "../CON:\\very-long-player-id";
  assert.match(playerFileId(id), /^[a-f0-9]{64}$/);
  assert.equal(playerFileId(id), playerFileId(id));
});

test("treats a battle log as complete only when both raw and normalized files exist", async () => {
  const repository = await createRepository();
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 4 });
  await repository.writeBattleLog(manifest, "user-1", { rawResponse: {}, normalized: {} });
  const directory = await repository.getCaptureDirectory(manifest);
  await rm(path.join(directory, "battle-logs", `${playerFileId("user-1")}.normalized.json`));

  assert.equal(await repository.hasBattleLog(manifest, "user-1"), false);
});

test("creates a new revision linked to the prior capture for the same era scope", async () => {
  const repository = await createRepository();
  const first = await repository.createCapture({ seasonId: 19, milestone: 4 });
  const second = await repository.createCapture({ seasonId: 19, milestone: 4 });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(second.parentCaptureId, first.captureId);
});

test("rejects offseason and invalid milestone snapshot scopes", async () => {
  const repository = await createRepository();
  await assert.rejects(() => repository.createCapture({ seasonId: 19, milestone: 5 }), /milestone 1 through 4/);
  await assert.rejects(() => repository.createCapture({ seasonId: 19, milestone: 4, scopeKey: "offseason:19" }), /scopeKey must be season:19:milestone:4/);
});

test("publishes captures and makes all records immutable", async () => {
  const repository = await createRepository();
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 1 });
  const completed = await repository.publishCapture(manifest);
  assert.equal(completed.status, "completed");
  await repository.acceptCapture(completed);
  assert.equal((await repository.readIndex(completed)).acceptedCaptureId, completed.captureId);
  await assert.rejects(() => repository.updateManifest(completed, { status: "running" }), /immutable/);
  await assert.rejects(() => repository.writeBattleLog(completed, "user-1", { rawResponse: {} }), /immutable/);
  await assert.rejects(() => repository.writeCandidatePage(completed, 1, {}, {}), /immutable/);
});

test("uses a scope lock to prevent competing scheduler decisions", async () => {
  const repository = await createRepository();
  const scope = { seasonId: 19, milestone: 4, scopeKey: "season:19:milestone:4" };
  let release;
  const held = repository.withScopeLock(scope, () => new Promise((resolve) => { release = resolve; }));

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => repository.withScopeLock(scope, async () => {}),
    (error) => error.code === "SNAPSHOT_SCOPE_LOCKED"
  );
  release();
  await held;
  await repository.withScopeLock(scope, async () => {});
});
