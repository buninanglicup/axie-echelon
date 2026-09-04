import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { loadRuneScanFixture, createFixtureFetch } from "./__fixtures__/runeScanFixtureFetch.js";

process.env.RUNE_SCAN_ENRICHMENT_BATCH_SIZE = "5";
process.env.RUNE_SCAN_BATCH_PAUSE_MS = "0";
process.env.BATTLELOG_FETCH_ATTEMPTS = "1";

const { scanLeaderboardForRune } = await import("./runeScanner.js");
const { startRuneScanJob, getRuneScanJob, runeScanJobStore, JOB_STATUS } = await import("./runeScanJobs.js");
const { rankCandidateCache } = await import("./leaderboardCandidates.js");
const { teamCache } = await import("./leaderboardCaches.js");

const fixture = loadRuneScanFixture();
const expectedRanks = [3, 6, 9, 12, 15, 18, 21, 24];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  rankCandidateCache.clear();
  teamCache.clear();
  runeScanJobStore.clear();
});

async function waitForJob(jobId) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const job = getRuneScanJob(jobId);
    if ([JOB_STATUS.COMPLETE, JOB_STATUS.FAILED, JOB_STATUS.CANCELLED].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Fixture scan did not finish in time");
}

test("fixture scanner reports five batches and the expected matches", async () => {
  globalThis.fetch = createFixtureFetch(fixture);
  const progress = [];
  const matches = await scanLeaderboardForRune(["rune-fixture-alpha"], fixture.eraMilestone, {
    rankMin: 1,
    rankMax: fixture.candidates.length,
    onProgress: (batchMatches, processedCount, totalCandidates) => {
      progress.push({ batchMatches, processedCount, totalCandidates });
    }
  });

  assert.deepEqual(progress.map((entry) => entry.processedCount), [5, 10, 15, 20, 24]);
  assert.ok(progress.every((entry) => entry.totalCandidates === 24));
  assert.deepEqual(matches.map((match) => match.rank), expectedRanks);
  assert.deepEqual(progress.flatMap((entry) => entry.batchMatches).map((match) => match.rank).sort((a, b) => a - b), expectedRanks);
});

test("fixture job completes and a second scan reuses warm teams", async () => {
  const battleLogCalls = [];
  globalThis.fetch = createFixtureFetch(fixture, { onBattleLogCall: (userID) => battleLogCalls.push(userID) });
  const first = startRuneScanJob({ runeIds: ["rune-fixture-alpha"], eraMilestone: fixture.eraMilestone, rankMin: 1, rankMax: 24 });
  const firstFinished = await waitForJob(first.jobId);
  assert.equal(firstFinished.status, JOB_STATUS.COMPLETE);
  assert.deepEqual(firstFinished.matches.map((match) => match.rank), expectedRanks);
  const callsAfterFirst = battleLogCalls.length;

  const second = startRuneScanJob({ runeIds: ["rune-fixture-alpha"], eraMilestone: fixture.eraMilestone, rankMin: 1, rankMax: 24 });
  const secondFinished = await waitForJob(second.jobId);
  assert.equal(secondFinished.status, JOB_STATUS.COMPLETE);
  const secondScanCalls = battleLogCalls.slice(callsAfterFirst);
  assert.ok(secondScanCalls.every((userID) => !Object.hasOwn(fixture.teams, userID)));
});
