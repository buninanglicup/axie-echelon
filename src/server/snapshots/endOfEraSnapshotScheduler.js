import { AXIE_ECHELON_API_KEY } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "../leaderboard/leaderboardConstants.js";
import { getConfiguredEraWindow } from "../../eraResolver.js";
import { freezeSeasonCandidates } from "./candidateFreezer.js";
import { captureArchivalBattleLogs } from "./archivalBattleLogWorker.js";
import { SnapshotRepository } from "./snapshotRepository.js";
import { requireSnapshotApiKey } from "./snapshotCapturePreflight.js";

export const DEFAULT_SCHEDULER_GRACE_PERIOD_MS = 15 * 60 * 1000;
export const DEFAULT_SCHEDULER_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MILESTONES = [1, 2, 3, 4];

function asTimestamp(value) {
  return value instanceof Date ? value.getTime() : Number(value);
}

export function getDueEraWindows({
  now = Date.now(),
  gracePeriodMs = DEFAULT_SCHEDULER_GRACE_PERIOD_MS,
  catchUp = false,
  getEraWindow = getConfiguredEraWindow
} = {}) {
  const nowMs = asTimestamp(now);
  if (!Number.isFinite(nowMs)) throw new Error("Snapshot scheduler requires a valid current time.");
  if (!Number.isFinite(gracePeriodMs) || gracePeriodMs < 0) {
    throw new Error("Snapshot scheduler gracePeriodMs must be zero or greater.");
  }

  const ended = MILESTONES
    .map((milestone) => getEraWindow(milestone))
    .filter((window) => nowMs >= Number(window.eraEndedAt) * 1000 + gracePeriodMs);

  // Normal operation reaches each milestone shortly after it ends. A tracker
  // first enabled after a season has finished should not silently queue four
  // recovery captures; older missed eras require an explicit catch-up choice.
  return catchUp || ended.length < 2 ? ended : [ended.at(-1)];
}

async function readLatestManifest(repository, eraWindow) {
  const reference = {
    seasonId: eraWindow.seasonId,
    milestone: String(eraWindow.milestone),
    scopeKey: `season:${eraWindow.seasonId}:milestone:${eraWindow.milestone}`
  };
  const index = await repository.readIndex(reference);
  const latest = Array.isArray(index?.captures)
    ? [...index.captures].sort((left, right) => right.revision - left.revision)[0]
    : null;
  if (!latest) return { index, manifest: null };
  return {
    index,
    manifest: await repository.readManifest({ ...reference, captureId: latest.captureId })
  };
}

function resultForCompleted(manifest, index) {
  return {
    scopeKey: manifest.scopeKey,
    captureId: manifest.captureId,
    status: index?.acceptedCaptureId === manifest.captureId ? "accepted" : "awaiting_acceptance"
  };
}

function safeLog(logger, level, message) {
  const target = logger?.[level];
  if (typeof target === "function") target.call(logger, message);
}

// This scheduler is deliberately opt-in at the server boundary. It creates or
// resumes only a local, unaccepted capture; a human still reviews and accepts
// a completed revision before a historical UI can read it.
export function createEndOfEraSnapshotScheduler({
  repository = new SnapshotRepository(),
  apiKey = AXIE_ECHELON_API_KEY,
  gracePeriodMs = DEFAULT_SCHEDULER_GRACE_PERIOD_MS,
  checkIntervalMs = DEFAULT_SCHEDULER_CHECK_INTERVAL_MS,
  catchUp = false,
  rankMin = 1,
  rankMax = LEADERBOARD_MAX_RANK,
  battleLogConcurrency = 2,
  getEraWindow = getConfiguredEraWindow,
  now = () => Date.now(),
  freezeCandidates = freezeSeasonCandidates,
  captureBattleLogs = captureArchivalBattleLogs,
  logger = console
} = {}) {
  if (!Number.isFinite(checkIntervalMs) || checkIntervalMs <= 0) {
    throw new Error("Snapshot scheduler checkIntervalMs must be greater than zero.");
  }

  let timer = null;
  let running = null;
  let activeController = null;
  let warnedAboutCredentials = false;

  async function captureEra(eraWindow, signal) {
    const reference = {
      seasonId: eraWindow.seasonId,
      milestone: String(eraWindow.milestone),
      scopeKey: `season:${eraWindow.seasonId}:milestone:${eraWindow.milestone}`
    };
    try {
      return await repository.withScopeLock(reference, async () => {
        const existing = await readLatestManifest(repository, eraWindow);
        if (existing.manifest?.status === "completed") {
          return resultForCompleted(existing.manifest, existing.index);
        }

        let manifest = existing.manifest;
        if (!manifest) {
          manifest = await repository.createCapture({
            ...reference,
            eraName: eraWindow.eraName,
            eraStartedAt: eraWindow.eraStartedAt,
            eraEndedAt: eraWindow.eraEndedAt,
            candidateScope: {
              rankStart: rankMin,
              rankEnd: rankMax,
              configuredCeiling: rankMax,
              upstreamReportedTotal: null,
              pagesFetched: 0,
              frozenCandidateCount: 0
            }
          });
        }

        manifest = await freezeCandidates({
          repository,
          manifest,
          rankMin,
          rankMax,
          apiKey,
          signal
        });
        if (manifest.status === "cancelled" || manifest.status === "failed") {
          return { scopeKey: manifest.scopeKey, captureId: manifest.captureId, status: manifest.status };
        }

        manifest = await captureBattleLogs({
          repository,
          manifest,
          concurrency: battleLogConcurrency,
          signal
        });
        return {
          scopeKey: manifest.scopeKey,
          captureId: manifest.captureId,
          status: manifest.status === "completed" ? "awaiting_acceptance" : manifest.status
        };
      });
    } catch (error) {
      if (error?.code === "SNAPSHOT_SCOPE_LOCKED") {
        return { scopeKey: reference.scopeKey, status: "locked" };
      }
      // Do not log raw upstream errors here: those can contain request data in
      // future client implementations. Durable failure records remain the
      // source of operator detail and are already sanitized by the repository.
      safeLog(logger, "error", `[snapshot scheduler] ${reference.scopeKey} failed (${error?.code || "SNAPSHOT_CAPTURE_FAILED"}).`);
      return { scopeKey: reference.scopeKey, status: "failed" };
    }
  }

  async function runOnce() {
    if (running) return running;
    running = (async () => {
      try {
        requireSnapshotApiKey(apiKey);
      } catch {
        if (!warnedAboutCredentials) {
          safeLog(logger, "warn", "[snapshot scheduler] Disabled for this run: AXIE_ECHELON_API_KEY is not configured.");
          warnedAboutCredentials = true;
        }
        return [{ status: "missing_credentials" }];
      }

      activeController = new AbortController();
      const windows = getDueEraWindows({
        now: now(),
        gracePeriodMs,
        catchUp,
        getEraWindow
      });
      const results = [];
      for (const eraWindow of windows) {
        if (activeController.signal.aborted) break;
        results.push(await captureEra(eraWindow, activeController.signal));
      }
      return results;
    })().finally(() => {
      activeController = null;
      running = null;
    });
    return running;
  }

  function start() {
    if (timer) return;
    void runOnce();
    timer = setInterval(() => { void runOnce(); }, checkIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    activeController?.abort();
  }

  return {
    runOnce,
    start,
    stop,
    get isRunning() { return Boolean(running); },
    get isStarted() { return Boolean(timer); }
  };
}
