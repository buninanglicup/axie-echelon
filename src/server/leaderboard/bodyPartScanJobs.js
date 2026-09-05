// Owns the async body-part-scan job lifecycle: creation/dedup, status
// tracking, heartbeat-based consumer presence, best-effort cancellation at
// batch boundaries, and TTL cleanup of finished jobs. Delegates the actual
// scan work to scanLeaderboardForBodyParts() (bodyPartScanner.js) via its
// onProgress callback -- this module has no knowledge of candidate
// fetching, team enrichment, gene decoding, or battle-log priority; it
// only tracks job state.
//
// This is a direct structural port of runeScanJobs.js for the body-part
// scan feature described in docs/implementation/body-part-filtering.md
// ("Next Milestone" #1). The job-lifecycle behavior (dedup key shape,
// cancellation semantics, watchdog, heartbeat sweep) is intentionally
// identical to the rune-scan job; only the scan payload (body-part names
// instead of rune IDs) and the delegated scan function differ. See
// runeScanJobs.js for the full design rationale -- it is not repeated
// here to avoid the two modules drifting into two competing explanations
// of the same design.
//
// Body-part-scan-specific notes:
// - Dedup key: milestone|sorted(bodyPartNames)|rankMin|rankMax|name. Same
//   shape as the rune-scan dedup key, with bodyPartNames in place of
//   runeIds.
// - This module intentionally does NOT import RUNE_SCAN_ENRICHMENT_BATCH_SIZE
//   or RUNE_SCAN_BATCH_PAUSE_MS from leaderboardConstants.js: those govern
//   bodyPartScanner.js's internal batching and are irrelevant to job-state
//   tracking, exactly as runeScanJobs.js does not import them either.
// - Test seam: __setBodyPartScannerForTesting() lets
//   bodyPartScanJobs.test.js substitute the scanner with a controllable
//   stub, so job-lifecycle behavior can be exercised without depending on
//   the candidate-pool/battle-log network stack or the ignored fixtures
//   that bodyPartScanner.test.js exercises directly. It is not part of
//   the public job API and defaults to the real scanner.

import { randomUUID } from "node:crypto";
import { scanLeaderboardForBodyParts as defaultScanLeaderboardForBodyParts } from "./bodyPartScanner.js";
import { DEBUG_ON } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";

export const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETE: "complete",
  PARTIAL: "partial",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

const MAX_CONCURRENT_BODY_PART_SCAN_JOBS = Number(process.env.MAX_CONCURRENT_BODY_PART_SCAN_JOBS || 2);
const JOB_HEARTBEAT_TIMEOUT_MS = Number(process.env.BODY_PART_SCAN_JOB_HEARTBEAT_TIMEOUT_MS || 60_000);
const JOB_RESULT_TTL_MS = Number(process.env.BODY_PART_SCAN_JOB_RESULT_TTL_MS || 300_000);
const JOB_SWEEP_INTERVAL_MS = Number(process.env.BODY_PART_SCAN_JOB_SWEEP_INTERVAL_MS || 30_000);
const BODY_PART_SCAN_JOB_MAX_DURATION_MS = Number(process.env.BODY_PART_SCAN_JOB_MAX_DURATION_MS || 300_000);

// Swappable at runtime only via __setBodyPartScannerForTesting (test-only).
let scanLeaderboardForBodyParts = defaultScanLeaderboardForBodyParts;

class BodyPartScanCancelledError extends Error {
  constructor(jobId) {
    super(`Body-part scan job ${jobId} was cancelled`);
    this.name = "BodyPartScanCancelledError";
    this.code = "BODY_PART_SCAN_CANCELLED";
  }
}

class BodyPartScanWatchdogTimeoutError extends Error {
  constructor(jobId, maxDurationMs) {
    super(`Body-part scan job ${jobId} exceeded ${maxDurationMs}ms and was force-failed by the watchdog`);
    this.name = "BodyPartScanWatchdogTimeoutError";
    this.code = "BODY_PART_SCAN_TIMEOUT";
  }
}

// Exported for tests, same convention as rankCandidateCache/teamCache in
// leaderboardCandidates.js/leaderboardCaches.js and runeScanJobStore in
// runeScanJobs.js.
export const bodyPartScanJobStore = new Map(); // jobId -> job record

const dedupIndex = new Map(); // dedupKey -> jobId, queued/running jobs only
const pendingQueue = []; // jobIds waiting for a concurrency slot
let runningCount = 0;

function normalizeBodyPartNames(bodyPartNames) {
  const namesByKey = new Map();
  for (const value of (Array.isArray(bodyPartNames) ? bodyPartNames : [bodyPartNames])) {
    const displayName = String(value || "").trim();
    const key = displayName.toLowerCase();
    if (displayName && !namesByKey.has(key)) namesByKey.set(key, displayName);
  }
  return [...namesByKey.values()];
}

function buildDedupKey({ bodyPartNames, eraMilestone, rankMin, rankMax, name }) {
  const sortedBodyPartNames = [...new Set(bodyPartNames.map((value) => String(value).toLowerCase()))].sort();
  return `${eraMilestone}|${sortedBodyPartNames.join(",")}|${rankMin}|${rankMax}|${String(name || "").trim().toLowerCase()}`;
}

function toPublicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    bodyPartNames: job.bodyPartNames,
    eraMilestone: job.eraMilestone,
    rankMin: job.rankMin,
    rankMax: job.rankMax,
    name: job.name,
    matches: job.matches,
    processedCount: job.processedCount,
    totalCandidates: job.totalCandidates,
    unknownCount: job.unknownCount,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function touchHeartbeat(job) {
  job.lastPolledAt = Date.now();
}

function scheduleNextQueuedJob() {
  if (runningCount >= MAX_CONCURRENT_BODY_PART_SCAN_JOBS) return;
  const nextJobId = pendingQueue.shift();
  if (!nextJobId) return;
  const job = bodyPartScanJobStore.get(nextJobId);
  // Job may have been cancelled/swept while still queued -- skip it.
  if (!job || job.status !== JOB_STATUS.QUEUED) {
    scheduleNextQueuedJob();
    return;
  }
  runJob(job);
}

function runJob(job) {
  runningCount += 1;
  job.status = JOB_STATUS.RUNNING;
  job.updatedAt = Date.now();

  const onProgress = (batchMatches, processedCount, totalCandidates, batchUnknownCount = 0) => {
    if (job.cancelRequested || job.status !== JOB_STATUS.RUNNING) {
      throw new BodyPartScanCancelledError(job.jobId);
    }
    job.matches.push(...batchMatches);
    job.processedCount = processedCount;
    job.totalCandidates = totalCandidates;
    job.unknownCount += batchUnknownCount;
    job.updatedAt = Date.now();
  };

  const scanPromise = scanLeaderboardForBodyParts(job.bodyPartNames, job.eraMilestone, {
    rankMin: job.rankMin,
    rankMax: job.rankMax,
    name: job.name,
    onProgress
  });

  let watchdogTimer;
  const watchdogPromise = new Promise((_, reject) => {
    watchdogTimer = setTimeout(() => {
      reject(new BodyPartScanWatchdogTimeoutError(job.jobId, BODY_PART_SCAN_JOB_MAX_DURATION_MS));
    }, BODY_PART_SCAN_JOB_MAX_DURATION_MS);
    watchdogTimer.unref?.();
  });

  Promise.race([scanPromise, watchdogPromise])
    .then((finalMatches) => {
      if (job.status !== JOB_STATUS.RUNNING) return;
      job.matches = finalMatches;
      job.status = JOB_STATUS.COMPLETE;
      job.updatedAt = Date.now();
    })
    .catch((error) => {
      if (error instanceof BodyPartScanCancelledError) return; // status already set by cancel path
      if (error instanceof BodyPartScanWatchdogTimeoutError) {
        job.status = JOB_STATUS.PARTIAL;
        job.error = { message: error.message, code: error.code || "BODY_PART_SCAN_TIMEOUT" };
        job.updatedAt = Date.now();
        return;
      }
      if (DEBUG_ON) console.error(`[bodyPartScanJobs] job ${job.jobId} failed: ${error.message}`);
      job.status = JOB_STATUS.FAILED;
      job.error = { message: error.message, code: error.code || "BODY_PART_SCAN_FAILED" };
      job.updatedAt = Date.now();
    })
    .finally(() => {
      clearTimeout(watchdogTimer);
      runningCount -= 1;
      if (dedupIndex.get(job.dedupKey) === job.jobId) dedupIndex.delete(job.dedupKey);
      scheduleNextQueuedJob();
    });

  // A watchdog can settle the job while the underlying scan remains in
  // flight. Consume that later rejection so a hung upstream cannot become
  // an unhandled process-level rejection.
  scanPromise.catch(() => {});
}

export function startBodyPartScanJob({
  bodyPartNames,
  eraMilestone,
  rankMin = 1,
  rankMax = LEADERBOARD_MAX_RANK,
  name = ""
}) {
  const normalizedBodyPartNames = normalizeBodyPartNames(bodyPartNames);
  if (normalizedBodyPartNames.length === 0) {
    throw new Error("At least one body-part name is required.");
  }
  const dedupKey = buildDedupKey({ bodyPartNames: normalizedBodyPartNames, eraMilestone, rankMin, rankMax, name });

  const existingJobId = dedupIndex.get(dedupKey);
  if (existingJobId) {
    const existingJob = bodyPartScanJobStore.get(existingJobId);
    if (existingJob) {
      touchHeartbeat(existingJob);
      return toPublicJob(existingJob);
    }
  }

  const jobId = randomUUID();
  const job = {
    jobId,
    dedupKey,
    status: JOB_STATUS.QUEUED,
    bodyPartNames: normalizedBodyPartNames,
    eraMilestone,
    rankMin,
    rankMax,
    name,
    matches: [],
    processedCount: 0,
    totalCandidates: null,
    unknownCount: 0,
    error: null,
    cancelRequested: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastPolledAt: Date.now()
  };

  bodyPartScanJobStore.set(jobId, job);
  dedupIndex.set(dedupKey, jobId);
  pendingQueue.push(jobId);
  scheduleNextQueuedJob();

  return toPublicJob(job);
}

export function getBodyPartScanJob(jobId) {
  const job = bodyPartScanJobStore.get(jobId);
  if (!job) return null;
  touchHeartbeat(job);
  return toPublicJob(job);
}

export function cancelBodyPartScanJob(jobId) {
  const job = bodyPartScanJobStore.get(jobId);
  if (!job) return null;

  if (job.status === JOB_STATUS.QUEUED) {
    job.status = JOB_STATUS.CANCELLED;
    job.updatedAt = Date.now();
    dedupIndex.delete(job.dedupKey);
    const queueIndex = pendingQueue.indexOf(jobId);
    if (queueIndex !== -1) pendingQueue.splice(queueIndex, 1);
    return toPublicJob(job);
  }

  if (job.status === JOB_STATUS.RUNNING) {
    // Honored at the next onProgress call (next batch boundary).
    job.cancelRequested = true;
    job.status = JOB_STATUS.CANCELLED;
    job.updatedAt = Date.now();
    dedupIndex.delete(job.dedupKey);
    return toPublicJob(job);
  }

  // Already terminal -- no-op, return current state rather than erroring.
  return toPublicJob(job);
}

function sweepStaleJobs() {
  const now = Date.now();
  for (const [jobId, job] of bodyPartScanJobStore) {
    const isFinished =
      job.status === JOB_STATUS.COMPLETE ||
      job.status === JOB_STATUS.PARTIAL ||
      job.status === JOB_STATUS.FAILED ||
      job.status === JOB_STATUS.CANCELLED;

    if (isFinished) {
      if (now - job.updatedAt > JOB_RESULT_TTL_MS) bodyPartScanJobStore.delete(jobId);
      continue;
    }

    if (now - job.lastPolledAt > JOB_HEARTBEAT_TIMEOUT_MS) {
      if (DEBUG_ON) console.log(`[bodyPartScanJobs] sweeping abandoned job ${jobId} (status=${job.status})`);
      cancelBodyPartScanJob(jobId);
    }
  }
}

const jobSweepTimer = setInterval(sweepStaleJobs, JOB_SWEEP_INTERVAL_MS);
jobSweepTimer.unref?.();

// Test-only seam (see file header). Not part of the public job API.
export function __setBodyPartScannerForTesting(scanFn) {
  scanLeaderboardForBodyParts = scanFn || defaultScanLeaderboardForBodyParts;
}