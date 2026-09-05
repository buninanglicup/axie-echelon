// Owns the async rune-scan job lifecycle: creation/dedup, status tracking,
// heartbeat-based consumer presence, best-effort cancellation at batch
// boundaries, and TTL cleanup of finished jobs. Delegates the actual scan
// work to scanLeaderboardForRune() (runeScanner.js) via its onProgress
// callback -- this module has no knowledge of candidate fetching, team
// enrichment, or battle-log priority; it only tracks job state.
//
// Design notes (2026-09-04):
// - Dedup key: milestone|sorted(runeIds)|rankMin|rankMax|name. Two requests
//   for the same scan share one job instead of re-scanning the same range
//   twice. Only queued/running jobs are indexed for dedup -- once a job
//   finishes (any terminal status), a new request for the same shape
//   starts a fresh job rather than replaying a stale result.
// - Status is the only completeness signal callers should rely on --
//   matches.length === 0 is a legitimate outcome for a rare rune, not an
//   indication the job is still running.
// - Cancellation is best-effort, honored at the next batch boundary: since
//   scanLeaderboardForRune() has no cancellation token, cancelling throws a
//   sentinel error out of the onProgress callback, which propagates out of
//   the scan loop before the next batch starts. Whatever partial matches
//   accumulated from batches before the cancel are kept; the in-flight
//   batch's matches are discarded.
// - Consumer presence is heartbeat-based, not refcounted: every GET poll
//   renews lastPolledAt. A queued/running job with no poll in
//   RUNE_SCAN_JOB_HEARTBEAT_TIMEOUT_MS is treated as abandoned and
//   cancelled -- this frees its concurrency slot and stops burning shared
//   battle-log capacity on a scan nothing is still watching.
// - Active-job scheduling: MAX_CONCURRENT_RUNE_SCAN_JOBS caps how many jobs
//   actually run scanLeaderboardForRune() at once. This is separate from
//   BATTLELOG_FETCH_CONCURRENCY in concurrency.js, which bounds individual
//   battle-log fetches -- this bounds how many full top-1000 scans run
//   concurrently, so scan jobs don't collectively flood the low-priority
//   battle-log queue that concurrency.js already fairness-limits.

import { randomUUID } from "node:crypto";
import { scanLeaderboardForRune as defaultScanLeaderboardForRune } from "./runeScanner.js";
import { DEBUG_ON } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { getLeaderboardScopeKey, normalizeLeaderboardScope } from "../../leaderboard/leaderboardScope.js";

export const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETE: "complete",
  PARTIAL: "partial",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

const MAX_CONCURRENT_RUNE_SCAN_JOBS = Number(process.env.MAX_CONCURRENT_RUNE_SCAN_JOBS || 2);
const JOB_HEARTBEAT_TIMEOUT_MS = Number(process.env.RUNE_SCAN_JOB_HEARTBEAT_TIMEOUT_MS || 60_000);
const JOB_RESULT_TTL_MS = Number(process.env.RUNE_SCAN_JOB_RESULT_TTL_MS || 300_000);
const JOB_SWEEP_INTERVAL_MS = Number(process.env.RUNE_SCAN_JOB_SWEEP_INTERVAL_MS || 30_000);
const RUNE_SCAN_JOB_MAX_DURATION_MS = Number(process.env.RUNE_SCAN_JOB_MAX_DURATION_MS || 300_000);

// Swappable only for lifecycle tests. It keeps scope/dedup tests independent
// of the candidate-pool and battle-log fetch stack.
let scanLeaderboardForRune = defaultScanLeaderboardForRune;

class RuneScanCancelledError extends Error {
  constructor(jobId) {
    super(`Rune scan job ${jobId} was cancelled`);
    this.name = "RuneScanCancelledError";
    this.code = "RUNE_SCAN_CANCELLED";
  }
}

class RuneScanWatchdogTimeoutError extends Error {
  constructor(jobId, maxDurationMs) {
    super(`Rune scan job ${jobId} exceeded ${maxDurationMs}ms and was force-failed by the watchdog`);
    this.name = "RuneScanWatchdogTimeoutError";
    this.code = "RUNE_SCAN_TIMEOUT";
  }
}

// Exported for tests, same convention as rankCandidateCache/teamCache in
// leaderboardCandidates.js/leaderboardCaches.js.
export const runeScanJobStore = new Map(); // jobId -> job record

const dedupIndex = new Map(); // dedupKey -> jobId, queued/running jobs only
const pendingQueue = []; // jobIds waiting for a concurrency slot
let runningCount = 0;

function buildDedupKey({ runeIds, leaderboardScope, rankMin, rankMax, name }) {
  const sortedRuneIds = [...new Set(runeIds.map(String))].sort();
  return `${getLeaderboardScopeKey(leaderboardScope)}|${sortedRuneIds.join(",")}|${rankMin}|${rankMax}|${name || ""}`;
}

function toPublicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    runeIds: job.runeIds,
    eraMilestone: job.eraMilestone,
    leaderboardScope: job.leaderboardScope,
    rankMin: job.rankMin,
    rankMax: job.rankMax,
    name: job.name,
    matches: job.matches,
    processedCount: job.processedCount,
    totalCandidates: job.totalCandidates,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function touchHeartbeat(job) {
  job.lastPolledAt = Date.now();
}

function scheduleNextQueuedJob() {
  if (runningCount >= MAX_CONCURRENT_RUNE_SCAN_JOBS) return;
  const nextJobId = pendingQueue.shift();
  if (!nextJobId) return;
  const job = runeScanJobStore.get(nextJobId);
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

  const onProgress = (batchMatches, processedCount, totalCandidates) => {
    if (job.cancelRequested || job.status !== JOB_STATUS.RUNNING) {
      throw new RuneScanCancelledError(job.jobId);
    }
    job.matches.push(...batchMatches);
    job.processedCount = processedCount;
    job.totalCandidates = totalCandidates;
    job.updatedAt = Date.now();
  };

  const scanPromise = scanLeaderboardForRune(job.runeIds, job.leaderboardScope, {
    rankMin: job.rankMin,
    rankMax: job.rankMax,
    name: job.name,
    onProgress
  });

  let watchdogTimer;
  const watchdogPromise = new Promise((_, reject) => {
    watchdogTimer = setTimeout(() => {
      reject(new RuneScanWatchdogTimeoutError(job.jobId, RUNE_SCAN_JOB_MAX_DURATION_MS));
    }, RUNE_SCAN_JOB_MAX_DURATION_MS);
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
      if (error instanceof RuneScanCancelledError) return; // status already set by cancel path
      if (error instanceof RuneScanWatchdogTimeoutError) {
        job.status = JOB_STATUS.PARTIAL;
        job.error = { message: error.message, code: error.code || "RUNE_SCAN_TIMEOUT" };
        job.updatedAt = Date.now();
        return;
      }
      if (DEBUG_ON) console.error(`[runeScanJobs] job ${job.jobId} failed: ${error.message}`);
      job.status = JOB_STATUS.FAILED;
      job.error = { message: error.message, code: error.code || "RUNE_SCAN_FAILED" };
      job.updatedAt = Date.now();
    })
    .finally(() => {
      clearTimeout(watchdogTimer);
      runningCount -= 1;
      dedupIndex.delete(job.dedupKey);
      scheduleNextQueuedJob();
    });

  // A watchdog can settle the job while the underlying scan remains in
  // flight. Consume that later rejection so a hung upstream cannot become
  // an unhandled process-level rejection.
  scanPromise.catch(() => {});
}

export function startRuneScanJob({
  runeIds,
  leaderboardScope,
  eraMilestone,
  rankMin = 1,
  rankMax = LEADERBOARD_MAX_RANK,
  name = ""
}) {
  const normalizedRuneIds = [
    ...new Set((Array.isArray(runeIds) ? runeIds : [runeIds]).map(String).map((value) => value.trim()).filter(Boolean))
  ];
  const scope = normalizeLeaderboardScope(leaderboardScope ?? eraMilestone);
  const dedupKey = buildDedupKey({ runeIds: normalizedRuneIds, leaderboardScope: scope, rankMin, rankMax, name });

  const existingJobId = dedupIndex.get(dedupKey);
  if (existingJobId) {
    const existingJob = runeScanJobStore.get(existingJobId);
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
    runeIds: normalizedRuneIds,
    eraMilestone: scope.milestone,
    leaderboardScope: scope,
    rankMin,
    rankMax,
    name,
    matches: [],
    processedCount: 0,
    totalCandidates: null,
    error: null,
    cancelRequested: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastPolledAt: Date.now()
  };

  runeScanJobStore.set(jobId, job);
  dedupIndex.set(dedupKey, jobId);
  pendingQueue.push(jobId);
  scheduleNextQueuedJob();

  return toPublicJob(job);
}

export function getRuneScanJob(jobId) {
  const job = runeScanJobStore.get(jobId);
  if (!job) return null;
  touchHeartbeat(job);
  return toPublicJob(job);
}

export function cancelRuneScanJob(jobId) {
  const job = runeScanJobStore.get(jobId);
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
  for (const [jobId, job] of runeScanJobStore) {
    const isFinished =
      job.status === JOB_STATUS.COMPLETE ||
      job.status === JOB_STATUS.PARTIAL ||
      job.status === JOB_STATUS.FAILED ||
      job.status === JOB_STATUS.CANCELLED;

    if (isFinished) {
      if (now - job.updatedAt > JOB_RESULT_TTL_MS) runeScanJobStore.delete(jobId);
      continue;
    }

    if (now - job.lastPolledAt > JOB_HEARTBEAT_TIMEOUT_MS) {
      if (DEBUG_ON) console.log(`[runeScanJobs] sweeping abandoned job ${jobId} (status=${job.status})`);
      cancelRuneScanJob(jobId);
    }
  }
}

const jobSweepTimer = setInterval(sweepStaleJobs, JOB_SWEEP_INTERVAL_MS);
jobSweepTimer.unref?.();

export function __setRuneScannerForTesting(scanFn) {
  scanLeaderboardForRune = scanFn || defaultScanLeaderboardForRune;
}
