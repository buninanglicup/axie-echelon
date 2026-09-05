import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

// Job-lifecycle env knobs. See bodyPartScanJobs.js for defaults; these
// mirror the values runeScanJobs.test.js uses for its own job env vars.
process.env.MAX_CONCURRENT_BODY_PART_SCAN_JOBS = "2";
process.env.BODY_PART_SCAN_JOB_HEARTBEAT_TIMEOUT_MS = "100000";
process.env.BODY_PART_SCAN_JOB_RESULT_TTL_MS = "300000";
process.env.BODY_PART_SCAN_JOB_SWEEP_INTERVAL_MS = "30000";
process.env.BODY_PART_SCAN_JOB_MAX_DURATION_MS = "300000";

const {
  startBodyPartScanJob,
  getBodyPartScanJob,
  cancelBodyPartScanJob,
  bodyPartScanJobStore,
  JOB_STATUS,
  __setBodyPartScannerForTesting
} = await import("./bodyPartScanJobs.js");

// This suite deliberately mocks scanLeaderboardForBodyParts itself rather
// than mocking fetch and exercising the real candidate-pool/battle-log
// stack the way runeScanJobs.test.js does for the rune scan. That stack
// (and bodyPartScanner.test.js's own coverage of it) depends on gene
// decoding and the ignored api-responses fixtures; none of that is
// relevant to job-state tracking, which is all this file tests. Swapping
// the scanner out keeps this suite runnable from a plain checkout with no
// fixtures present.
const scanLeaderboardForBodyParts = mock.fn();

afterEach(() => {
  __setBodyPartScannerForTesting(scanLeaderboardForBodyParts);
  scanLeaderboardForBodyParts.mock.resetCalls();
  bodyPartScanJobStore.clear();
});

function match(rank) {
  return { rank, name: `Player ${rank}`, bodyParts: [] };
}

async function waitForStatus(jobId, targetStatuses, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getBodyPartScanJob(jobId);
    if (targetStatuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${targetStatuses.join("/")}`);
}

test("runs a job to completion with full coverage", async () => {
  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    const matches = [match(2), match(4), match(6)];
    onProgress(matches, 6, 6);
    return matches;
  });

  const started = startBodyPartScanJob({ bodyPartNames: ["Hazy"], eraMilestone: "job-test", rankMin: 1, rankMax: 6 });
  assert.ok([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING].includes(started.status));

  const finished = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(finished.status, JOB_STATUS.COMPLETE);
  assert.deepEqual(finished.matches.map((m) => m.rank), [2, 4, 6]);
  assert.equal(finished.processedCount, 6);
  assert.equal(finished.totalCandidates, 6);
});

test("dedups two requests for the same scan shape into one job", async () => {
  let callCount = 0;
  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    callCount += 1;
    const matches = [match(1)];
    onProgress(matches, 4, 4);
    return matches;
  });

  const first = startBodyPartScanJob({ bodyPartNames: ["Hazy"], eraMilestone: "dedup-test", rankMin: 1, rankMax: 4 });
  const second = startBodyPartScanJob({ bodyPartNames: ["Hazy"], eraMilestone: "dedup-test", rankMin: 1, rankMax: 4 });
  assert.equal(first.jobId, second.jobId);

  await waitForStatus(first.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(callCount, 1);
});

test("bodyPartNames order and whitespace don't defeat dedup", async () => {
  let callCount = 0;
  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    callCount += 1;
    const matches = [match(1)];
    onProgress(matches, 1, 1);
    return matches;
  });

  const first = startBodyPartScanJob({
    bodyPartNames: ["Hazy", "Clear"],
    eraMilestone: "dedup-order-test",
    rankMin: 1,
    rankMax: 4
  });
  const second = startBodyPartScanJob({
    bodyPartNames: [" Clear ", "Hazy"],
    eraMilestone: "dedup-order-test",
    rankMin: 1,
    rankMax: 4
  });
  assert.equal(first.jobId, second.jobId);

  await waitForStatus(first.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(callCount, 1);
});

test("body-part name casing does not defeat dedup", async () => {
  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    onProgress([], 0, 0);
    return [];
  });

  const first = startBodyPartScanJob({ bodyPartNames: ["Hazy"], eraMilestone: "dedup-case-test" });
  const second = startBodyPartScanJob({ bodyPartNames: ["hazy"], eraMilestone: "dedup-case-test" });
  assert.equal(first.jobId, second.jobId);
  assert.deepEqual(first.bodyPartNames, ["Hazy"]);
  await waitForStatus(first.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
});

test("rejects an empty body-part selection", () => {
  assert.throws(
    () => startBodyPartScanJob({ bodyPartNames: [" ", ""], eraMilestone: "empty-selection-test" }),
    /At least one body-part name is required/
  );
});

test("cancelling a queued job marks it cancelled without ever scanning", async () => {
  const releaseActiveJobs = [];
  __setBodyPartScannerForTesting(async () => {
    await new Promise((resolve) => releaseActiveJobs.push(resolve));
    return [];
  });

  startBodyPartScanJob({ bodyPartNames: ["A"], eraMilestone: "cancel-queued-test", rankMin: 1, rankMax: 4 });
  startBodyPartScanJob({ bodyPartNames: ["B"], eraMilestone: "cancel-queued-test", rankMin: 1, rankMax: 4 });
  const queued = startBodyPartScanJob({ bodyPartNames: ["C"], eraMilestone: "cancel-queued-test", rankMin: 1, rankMax: 4 });
  assert.equal(getBodyPartScanJob(queued.jobId).status, JOB_STATUS.QUEUED);

  const cancelled = cancelBodyPartScanJob(queued.jobId);
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.equal(getBodyPartScanJob(queued.jobId).status, JOB_STATUS.CANCELLED);

  releaseActiveJobs.forEach((release) => release());
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("cancelling a running job stops it at the next batch boundary, keeping prior matches", async () => {
  let releaseSecondBatch;
  const secondBatchGate = new Promise((resolve) => {
    releaseSecondBatch = resolve;
  });

  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    onProgress([match(1), match(2)], 2, 4); // throws if the job was cancelled first
    await secondBatchGate;
    onProgress([match(3), match(4)], 4, 4); // throws if cancelled during the gate
    return [match(1), match(2), match(3), match(4)];
  });

  const started = startBodyPartScanJob({
    bodyPartNames: ["Hazy"],
    eraMilestone: "cancel-running-test",
    rankMin: 1,
    rankMax: 4
  });

  const deadline = Date.now() + 2000;
  while (getBodyPartScanJob(started.jobId).processedCount < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const cancelled = cancelBodyPartScanJob(started.jobId);
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.deepEqual(
    cancelled.matches.map((m) => m.rank),
    [1, 2]
  );

  releaseSecondBatch();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(getBodyPartScanJob(started.jobId).status, JOB_STATUS.CANCELLED);
});

test("watchdog produces a partial result when a scan never settles", async () => {
  process.env.BODY_PART_SCAN_JOB_MAX_DURATION_MS = "50";
  const {
    startBodyPartScanJob: startWithShortWatchdog,
    getBodyPartScanJob: getWithShortWatchdog,
    JOB_STATUS: watchdogStatuses,
    __setBodyPartScannerForTesting: setScannerForShortWatchdog
  } = await import(`./bodyPartScanJobs.js?watchdog-test=${Date.now()}`);

  setScannerForShortWatchdog(async () => new Promise(() => {}));

  const started = startWithShortWatchdog({
    bodyPartNames: ["Hazy"],
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
  assert.equal(partial.error.code, "BODY_PART_SCAN_TIMEOUT");
  assert.equal(partial.processedCount, 0);
  assert.equal(partial.totalCandidates, null);
});

test("watchdog preserves completed batches and ignores a late batch", async () => {
  process.env.BODY_PART_SCAN_JOB_MAX_DURATION_MS = "50";
  const {
    startBodyPartScanJob: startPartial,
    getBodyPartScanJob: getPartial,
    JOB_STATUS: partialStatuses,
    __setBodyPartScannerForTesting: setScannerForPartial
  } = await import(`./bodyPartScanJobs.js?partial-batch-test=${Date.now()}`);

  let releaseSecondBatch;
  const secondBatchGate = new Promise((resolve) => {
    releaseSecondBatch = resolve;
  });

  setScannerForPartial(async (bodyPartNames, eraMilestone, { onProgress }) => {
    onProgress([match(1), match(2)], 2, 4);
    await secondBatchGate;
    onProgress([match(3), match(4)], 4, 4);
    return [match(1), match(2), match(3), match(4)];
  });

  const started = startPartial({ bodyPartNames: ["Hazy"], eraMilestone: "partial-batch-test", rankMin: 1, rankMax: 4 });

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
  assert.deepEqual(partial.matches.map((m) => m.rank), [1, 2]);
  assert.equal(partial.processedCount, 2);
  assert.equal(partial.totalCandidates, 4);

  releaseSecondBatch();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const settled = getPartial(started.jobId);
  assert.equal(settled.status, partialStatuses.PARTIAL);
  assert.deepEqual(settled.matches.map((m) => m.rank), [1, 2]);
});

test("a scanner failure with no error code fails the job with the generic scan-failed code", async () => {
  __setBodyPartScannerForTesting(async () => {
    throw new Error("boom");
  });

  const started = startBodyPartScanJob({
    bodyPartNames: ["Hazy"],
    eraMilestone: "generic-failure-test",
    rankMin: 1,
    rankMax: 4
  });

  const failed = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.error.code, "BODY_PART_SCAN_FAILED");
});

test("a scanner failure with an upstream error code preserves that code", async () => {
  __setBodyPartScannerForTesting(async () => {
    const error = new Error("upstream unavailable");
    error.code = "LEADERBOARD_UPSTREAM_UNAVAILABLE";
    throw error;
  });

  const started = startBodyPartScanJob({
    bodyPartNames: ["Hazy"],
    eraMilestone: "pool-unavailable-test",
    rankMin: 1,
    rankMax: 4
  });

  const failed = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.error.code, "LEADERBOARD_UPSTREAM_UNAVAILABLE");
});

test("getBodyPartScanJob returns null for an unknown job id", () => {
  assert.equal(getBodyPartScanJob("does-not-exist"), null);
});

test("cancelBodyPartScanJob returns null for an unknown job id", () => {
  assert.equal(cancelBodyPartScanJob("does-not-exist"), null);
});

test("cancelling an already-terminal job is a no-op that returns its current state", async () => {
  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    const matches = [match(1)];
    onProgress(matches, 1, 1);
    return matches;
  });

  const started = startBodyPartScanJob({ bodyPartNames: ["Hazy"], eraMilestone: "terminal-cancel-test", rankMin: 1, rankMax: 1 });
  const finished = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(finished.status, JOB_STATUS.COMPLETE);

  const cancelResult = cancelBodyPartScanJob(started.jobId);
  assert.equal(cancelResult.status, JOB_STATUS.COMPLETE);
});

test("empty narrowed scans report zero progress", async () => {
  __setBodyPartScannerForTesting(async (bodyPartNames, eraMilestone, { onProgress }) => {
    onProgress([], 0, 0);
    return [];
  });

  const started = startBodyPartScanJob({ bodyPartNames: ["Hazy"], eraMilestone: "zero-progress-test" });
  const finished = await waitForStatus(started.jobId, [JOB_STATUS.COMPLETE, JOB_STATUS.FAILED]);
  assert.equal(finished.status, JOB_STATUS.COMPLETE);
  assert.equal(finished.processedCount, 0);
  assert.equal(finished.totalCandidates, 0);
});