import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createEndOfEraSnapshotScheduler,
  getDueEraWindows
} from "./endOfEraSnapshotScheduler.js";
import { SnapshotRepository } from "./snapshotRepository.js";

const minute = 60 * 1000;
const baseWindows = {
  1: { seasonId: 19, milestone: "1", eraName: "Rare", eraStartedAt: 100, eraEndedAt: 200 },
  2: { seasonId: 19, milestone: "2", eraName: "Epic", eraStartedAt: 200, eraEndedAt: 300 },
  3: { seasonId: 19, milestone: "3", eraName: "Mystic", eraStartedAt: 300, eraEndedAt: 400 },
  4: { seasonId: 19, milestone: "4", eraName: "Final", eraStartedAt: 400, eraEndedAt: 500 }
};

function getWindow(milestone) {
  return baseWindows[milestone];
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "axie-scheduler-"));
  return { root, repository: new SnapshotRepository(root) };
}

test("waits through the grace period and normally selects only the latest ended era", () => {
  // Final has not passed its grace period yet, so the scheduler sees Mystic
  // as the newest eligible completed era rather than prematurely capturing
  // Final.
  assert.deepEqual(
    getDueEraWindows({ now: 500 * 1000 + (14 * minute), gracePeriodMs: 15 * minute, getEraWindow: getWindow }).map((entry) => entry.milestone),
    ["3"]
  );
  assert.deepEqual(
    getDueEraWindows({ now: 500 * 1000 + (15 * minute), gracePeriodMs: 15 * minute, getEraWindow: getWindow }).map((entry) => entry.milestone),
    ["4"]
  );
  assert.deepEqual(
    getDueEraWindows({ now: 500 * 1000 + (15 * minute), gracePeriodMs: 15 * minute, catchUp: true, getEraWindow: getWindow }).map((entry) => entry.milestone),
    ["1", "2", "3", "4"]
  );
});

test("creates an era-bounded capture after grace, then waits for explicit acceptance", async () => {
  const { root, repository } = await createRepository();
  let frozen = 0;
  let captured = 0;
  const scheduler = createEndOfEraSnapshotScheduler({
    repository,
    apiKey: "test-key",
    now: () => 500 * 1000 + minute,
    gracePeriodMs: 0,
    getEraWindow: getWindow,
    freezeCandidates: async ({ manifest }) => {
      frozen += 1;
      return repository.updateManifest(manifest, { status: "running" });
    },
    captureBattleLogs: async ({ manifest }) => {
      captured += 1;
      return repository.publishCapture(manifest);
    },
    logger: null
  });

  const [initial] = await scheduler.runOnce();
  assert.equal(initial.scopeKey, "season:19:milestone:4");
  assert.match(initial.captureId, /.+/);
  assert.equal(initial.status, "awaiting_acceptance");
  const index = await repository.readIndex({ seasonId: 19, milestone: "4" });
  const manifest = await repository.readManifest({ seasonId: 19, milestone: "4", captureId: index.captures[0].captureId });
  assert.equal(frozen, 1);
  assert.equal(captured, 1);
  assert.equal(manifest.eraName, "Final");
  assert.equal(manifest.eraStartedAt, 400);
  assert.equal(manifest.eraEndedAt, 500);
  assert.equal(index.acceptedCaptureId, null);
  assert.equal((await scheduler.runOnce())[0].status, "awaiting_acceptance");
  assert.equal(frozen, 1);
  assert.equal(captured, 1);
  await rm(root, { recursive: true, force: true });
});

test("resumes the latest incomplete revision instead of creating another one", async () => {
  const { root, repository } = await createRepository();
  const existing = await repository.createCapture({
    seasonId: 19,
    milestone: 4,
    eraName: "Final",
    eraStartedAt: 400,
    eraEndedAt: 500
  });
  const partial = await repository.updateManifest(existing, { status: "partial" });
  let resumedCaptureId = null;
  const scheduler = createEndOfEraSnapshotScheduler({
    repository,
    apiKey: "test-key",
    now: () => 501 * 1000,
    gracePeriodMs: 0,
    getEraWindow: getWindow,
    freezeCandidates: async ({ manifest }) => {
      resumedCaptureId = manifest.captureId;
      return repository.updateManifest(manifest, { status: "running" });
    },
    captureBattleLogs: async ({ manifest }) => repository.publishCapture(manifest),
    logger: null
  });

  const [result] = await scheduler.runOnce();
  assert.equal(result.captureId, partial.captureId);
  assert.equal(resumedCaptureId, partial.captureId);
  assert.equal((await repository.readIndex(partial)).captures.length, 1);
  await rm(root, { recursive: true, force: true });
});

test("does not overlap local runs and does not attempt work without credentials", async () => {
  const { root, repository } = await createRepository();
  let release;
  let calls = 0;
  let startedFreeze;
  const freezeStarted = new Promise((resolve) => { startedFreeze = resolve; });
  const scheduler = createEndOfEraSnapshotScheduler({
    repository,
    apiKey: "test-key",
    now: () => 501 * 1000,
    gracePeriodMs: 0,
    getEraWindow: getWindow,
    freezeCandidates: async ({ manifest }) => {
      calls += 1;
      startedFreeze();
      await new Promise((resolve) => { release = resolve; });
      return repository.updateManifest(manifest, { status: "running" });
    },
    captureBattleLogs: async ({ manifest }) => repository.publishCapture(manifest),
    logger: null
  });
  const first = scheduler.runOnce();
  const second = scheduler.runOnce();
  await freezeStarted;
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);

  const missing = createEndOfEraSnapshotScheduler({ repository, apiKey: "", getEraWindow: getWindow, logger: null });
  assert.deepEqual(await missing.runOnce(), [{ status: "missing_credentials" }]);
  await rm(root, { recursive: true, force: true });
});
