const enabled = ["1", "true"].includes(String(process.env.RUNE_SCAN_DIAGNOSTICS || "").toLowerCase());

function createState() {
  return {
    scanStartedAt: null,
    candidatePoolEndedAt: null,
    candidatePoolRequests: 0,
    candidatePoolCacheHits: 0,
    battleLogFetches: 0,
    battleLogAttempts: 0,
    battleLogSuccesses: 0,
    battleLogFailures: 0,
    battleLogLatencyMs: [],
    battleLogQueueWaitMs: [],
    battleLogActive: 0,
    battleLogMaxActive: 0,
    retryableStatusCount: 0,
    retryAfterPresentCount: 0,
    retryAfterMs: [],
    retryAfterExceedsPlannedBackoffCount: 0
  };
}

let state = createState();

export const RUNE_SCAN_DIAGNOSTICS_ENABLED = enabled;

export function resetRuneScanDiagnostics() {
  if (enabled) state = createState();
}

export function markRuneScanStart() {
  if (enabled) state.scanStartedAt = Date.now();
}

export function markCandidatePoolEnd() {
  if (enabled) state.candidatePoolEndedAt = Date.now();
}

export function recordCandidatePoolRequest() {
  if (enabled) state.candidatePoolRequests += 1;
}

export function recordCandidatePoolCacheHit() {
  if (enabled) state.candidatePoolCacheHits += 1;
}

export function recordBattleLogFetch() {
  if (enabled) state.battleLogFetches += 1;
}

export function recordBattleLogQueueWait(waitMs) {
  if (enabled) state.battleLogQueueWaitMs.push(waitMs);
}

export function startBattleLogAttempt() {
  if (!enabled) return null;
  state.battleLogAttempts += 1;
  state.battleLogActive += 1;
  state.battleLogMaxActive = Math.max(state.battleLogMaxActive, state.battleLogActive);
  return Date.now();
}

export function finishBattleLogAttempt(startedAt, success) {
  if (!enabled) return;
  if (startedAt !== null) state.battleLogLatencyMs.push(Date.now() - startedAt);
  state.battleLogActive -= 1;
  if (success) state.battleLogSuccesses += 1;
  else state.battleLogFailures += 1;
}

export function recordRetryableResponse(retryAfterMs, plannedBackoffMs) {
  if (!enabled) return;
  state.retryableStatusCount += 1;
  if (retryAfterMs === null) return;
  state.retryAfterPresentCount += 1;
  state.retryAfterMs.push(retryAfterMs);
  if (retryAfterMs > plannedBackoffMs) state.retryAfterExceedsPlannedBackoffCount += 1;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function getRuneScanDiagnosticsSnapshot() {
  const latencyMs = state.battleLogLatencyMs;
  return {
    enabled,
    scanStartedAt: state.scanStartedAt,
    candidatePoolEndedAt: state.candidatePoolEndedAt,
    candidatePoolDurationMs:
      state.scanStartedAt !== null && state.candidatePoolEndedAt !== null
        ? state.candidatePoolEndedAt - state.scanStartedAt
        : null,
    candidatePoolRequests: state.candidatePoolRequests,
    candidatePoolCacheHits: state.candidatePoolCacheHits,
    battleLogFetches: state.battleLogFetches,
    battleLogAttempts: state.battleLogAttempts,
    battleLogRetryAttempts: Math.max(0, state.battleLogAttempts - state.battleLogFetches),
    battleLogSuccesses: state.battleLogSuccesses,
    battleLogFailures: state.battleLogFailures,
    battleLogAvgLatencyMs: average(latencyMs),
    battleLogMaxLatencyMs: latencyMs.length ? Math.max(...latencyMs) : null,
    battleLogAvgQueueWaitMs: average(state.battleLogQueueWaitMs),
    battleLogMaxQueueWaitMs: state.battleLogQueueWaitMs.length ? Math.max(...state.battleLogQueueWaitMs) : null,
    battleLogMaxActive: state.battleLogMaxActive,
    retryableStatusCount: state.retryableStatusCount,
    retryAfterPresentCount: state.retryAfterPresentCount,
    retryAfterAvgMs: average(state.retryAfterMs),
    retryAfterMaxMs: state.retryAfterMs.length ? Math.max(...state.retryAfterMs) : null,
    retryAfterExceedsPlannedBackoffCount: state.retryAfterExceedsPlannedBackoffCount
  };
}
