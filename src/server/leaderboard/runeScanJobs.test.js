import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.RUNE_SCAN_ENRICHMENT_BATCH_SIZE = "2";
process.env.RUNE_SCAN_BATCH_PAUSE_MS = "0";
process.env.BATTLELOG_FETCH_CONCURRENCY = "5";
process.env.BATTLELOG_FETCH_ATTEMPTS = "1";
process.env.MAX_CONCURRENT_RUNE_SCAN_JOBS = "2";

const {
  startRuneScanJob,
  getRuneScanJob,
  cancelRuneScanJob,
  runeScanJobStore,
  JOB_STATUS,
  __setRuneScannerForTesting
} = await import(
  "./runeScanJobs.js"
);
const { rankCandidateCache } = await import("./leaderboardCandidates.js");
const { teamCache } = await import("./leaderboardCaches.js");

const originalFetch = globalThis.fetch;

afterEach(() => {
  __setRuneScannerForTesting();
  globalThis.fetch = originalFetch;
  rankCandidateCache.clear();
  teamCache.clear();
  runeScanJobStore.clear();
});

function candidateResponse(count, startRank) {
  const items = Array.from({ length: count }, (_, index) => ({
    rank: startRank + index,
    topRank: startRank + index,
    userID: `user-${startRank + index}`,
    name: `Player ${startRank + index}`,
    vstar: 3000 - (startRank + index)
  }));
  return new Response(JSON.stringify({ _items: items }), { status: 200 });
}

function battleLogResponse(userID, runeId) {
  return new Response(
    JSON.stringify({
      _items: [
        {
          gameData: {
            gameMode: "ranked",
            startedAt: Date.now() - 60_000,
            endedAt: Date.now(),
            players: [
              {
                userID,
                team: {
                  fighters: [
                    { axieID: 1, position: 0, runes: runeId ? [runeId] : [] },
                    { axieID: 2, position: 1, runes: [] },
                    { axieID: 3, position: 2, runes: [] }
                  ]
                }
              }
            ]
          }
        }
      ]
    }),
    { status: 200 }
  );
}

async function waitForStatus(jobId, targetStatuses, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getRuneScanJob(jobId);
    if (targetStatuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${targetStatuses.join("/")}`);
}

test("runs a job to completion with full coverage", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(6, 1);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      const rank = Number(userID.split("-")[1]);
      return battleLogResponse(userID, rank % 2 === 0 ? "rune-x" : null);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const started = startRuneScanJob({ runeIds: ["rune-x"], eraMilestone: "job-test", rankMin: 1, rankMax: 6 });
  assert.ok([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING].includes(started.status));

  const finished = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(finished.status, JOB_STATUS.COMPLETE);
  assert.deepEqual(finished.matches.map((m) => m.rank), [2, 4, 6]);
  assert.equal(finished.processedCount, 6);
  assert.equal(finished.totalCandidates, 6);
});

test("dedups two requests for the same scan shape into one job", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(4, 1);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      return battleLogResponse(userID, "rune-x");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const first = startRuneScanJob({ runeIds: ["rune-x"], eraMilestone: "dedup-test", rankMin: 1, rankMax: 4 });
  const second = startRuneScanJob({ runeIds: ["rune-x"], eraMilestone: "dedup-test", rankMin: 1, rankMax: 4 });
  assert.equal(first.jobId, second.jobId);

  await waitForStatus(first.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
});

test("cancelling a queued job marks it cancelled without ever scanning", async () => {
  const releaseActiveJobs = [];
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) {
      await new Promise((resolve) => releaseActiveJobs.push(resolve));
      return responseForItems(0, 1);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  startRuneScanJob({ runeIds: ["rune-a"], eraMilestone: "cancel-queued-test", rankMin: 1, rankMax: 4 });
  startRuneScanJob({ runeIds: ["rune-b"], eraMilestone: "cancel-queued-test", rankMin: 1, rankMax: 4 });
  const queued = startRuneScanJob({ runeIds: ["rune-c"], eraMilestone: "cancel-queued-test", rankMin: 1, rankMax: 4 });

  assert.equal(getRuneScanJob(queued.jobId).status, JOB_STATUS.QUEUED);
  const cancelled = cancelRuneScanJob(queued.jobId);
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.equal(getRuneScanJob(queued.jobId).status, JOB_STATUS.CANCELLED);

  releaseActiveJobs.forEach((release) => release());
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("cancelling a running job stops it at the next batch boundary, keeping prior matches", async () => {
  let releaseSecondBatch;
  const secondBatchGate = new Promise((resolve) => {
    releaseSecondBatch = resolve;
  });

  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(4, 1); // batch size 2 -> 2 batches
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      const rank = Number(userID.split("-")[1]);
      if (rank > 2) await secondBatchGate; // hold the second batch open
      return battleLogResponse(userID, "rune-x");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const started = startRuneScanJob({ runeIds: ["rune-x"], eraMilestone: "cancel-running-test", rankMin: 1, rankMax: 4 });

  // Wait until the first batch has landed (processedCount reaches 2) before cancelling.
  const deadline = Date.now() + 2000;
  while (getRuneScanJob(started.jobId).processedCount < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const cancelled = cancelRuneScanJob(started.jobId);
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.deepEqual(
    cancelled.matches.map((m) => m.rank),
    [1, 2]
  );

  releaseSecondBatch();
  await new Promise((resolve) => setTimeout(resolve, 20)); // let the scan settle
  assert.equal(getRuneScanJob(started.jobId).status, JOB_STATUS.CANCELLED);
});

test("watchdog produces a partial result when a scan never settles", async () => {
  process.env.RUNE_SCAN_JOB_MAX_DURATION_MS = "50";
  const {
    startRuneScanJob: startWithShortWatchdog,
    getRuneScanJob: getWithShortWatchdog,
    JOB_STATUS: watchdogStatuses
  } = await import(`./runeScanJobs.js?watchdog-test=${Date.now()}`);

  globalThis.fetch = async () => new Promise(() => {});

  const started = startWithShortWatchdog({
    runeIds: ["rune-watchdog"],
    eraMilestone: "watchdog-test",
    rankMin: 1,
    rankMax: 4
  });
  const deadline = Date.now() + 2000;
  let partial;
  while (Date.now() < deadline) {
    const current = getWithShortWatchdog(started.jobId);
    if (current.status === watchdogStatuses.PARTIAL) {
      partial = current;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(partial, "watchdog did not produce a partial job");
  assert.equal(partial.error.code, "RUNE_SCAN_TIMEOUT");
  assert.equal(partial.processedCount, 0);
  assert.equal(partial.totalCandidates, null);
});

test("watchdog preserves completed batches and ignores a late batch", async () => {
  process.env.RUNE_SCAN_JOB_MAX_DURATION_MS = "50";
  const {
    startRuneScanJob: startPartial,
    getRuneScanJob: getPartial,
    JOB_STATUS: partialStatuses
  } = await import(`./runeScanJobs.js?partial-batch-test=${Date.now()}`);
  let releaseSecondBatch;
  const secondBatchGate = new Promise((resolve) => {
    releaseSecondBatch = resolve;
  });

  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(4, 1);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      if (Number(userID.split("-")[1]) > 2) await secondBatchGate;
      return battleLogResponse(userID, "rune-x");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const started = startPartial({ runeIds: ["rune-x"], eraMilestone: "partial-batch-test", rankMin: 1, rankMax: 4 });
  const deadline = Date.now() + 2000;
  let partial;
  while (Date.now() < deadline) {
    const current = getPartial(started.jobId);
    if (current.status === partialStatuses.PARTIAL) {
      partial = current;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(partial, "watchdog did not produce a partial job");
  assert.deepEqual(partial.matches.map((match) => match.rank), [1, 2]);
  assert.equal(partial.processedCount, 2);
  assert.equal(partial.totalCandidates, 4);
  releaseSecondBatch();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const settled = getPartial(started.jobId);
  assert.equal(settled.status, partialStatuses.PARTIAL);
  assert.deepEqual(settled.matches.map((match) => match.rank), [1, 2]);
});

test("a candidate-pool outage fails the job with the upstream-unavailable code", async () => {
  globalThis.fetch = async () =>
    new Response("unavailable", { status: 503, headers: { "retry-after": "0" } });

  const started = startRuneScanJob({
    runeIds: ["rune-x"],
    eraMilestone: "pool-unavailable-test",
    rankMin: 1,
    rankMax: 4
  });

  const failed = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.error.code, "LEADERBOARD_UPSTREAM_UNAVAILABLE");
});

test("a non-JSON candidate response fails the job with the generic scan-failed code", async () => {
  globalThis.fetch = async () => new Response("not json", { status: 200 });

  const started = startRuneScanJob({
    runeIds: ["rune-x"],
    eraMilestone: "generic-failure-test",
    rankMin: 1,
    rankMax: 4
  });

  const failed = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.error.code, "RUNE_SCAN_FAILED");
});

test("does not deduplicate identical rune scans across Final and offseason scopes", async () => {
  const seenScopes = [];
  let releaseScans;
  const scanGate = new Promise((resolve) => {
    releaseScans = resolve;
  });
  __setRuneScannerForTesting(async (runeIds, leaderboardScope, { onProgress }) => {
    seenScopes.push(leaderboardScope);
    onProgress([], 0, 1);
    await scanGate;
    return [];
  });

  const finalScope = { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" };
  const offseasonScope = { seasonId: 19, offSeasonMode: true, milestone: null, eraName: "Offseason" };
  const finalJob = startRuneScanJob({ runeIds: ["rune-x"], leaderboardScope: finalScope, rankMin: 1, rankMax: 1 });
  const offseasonJob = startRuneScanJob({ runeIds: ["rune-x"], leaderboardScope: offseasonScope, rankMin: 1, rankMax: 1 });

  assert.notEqual(finalJob.jobId, offseasonJob.jobId);
  assert.equal(finalJob.eraMilestone, 4);
  assert.equal(offseasonJob.eraMilestone, null);
  assert.deepEqual(finalJob.leaderboardScope, finalScope);
  assert.deepEqual(offseasonJob.leaderboardScope, offseasonScope);
  assert.deepEqual(seenScopes, [finalScope, offseasonScope]);

  releaseScans();
  await Promise.all([
    waitForStatus(finalJob.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]),
    waitForStatus(offseasonJob.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED])
  ]);
});
