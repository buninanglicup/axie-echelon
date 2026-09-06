import { createHash } from "node:crypto";
import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { withBattleLogSlot } from "../shared/concurrency.js";
import { fetchWithRetry } from "../shared/httpRetry.js";

// The public API documents a 100-item maximum, but the established live
// integration uses 20 and the initial archival run received 400 responses at
// 100. Season 18 is a deliberately best-effort, one-page recovery capture;
// keep this request aligned with the known-good live shape until pagination is
// implemented and verified for archival use.
const REQUESTED_LIMIT = 20;

function toIsoTimestamp(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toEpochMs(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function battleTimestamp(battle) {
  const data = battle?.gameData || battle;
  return toIsoTimestamp(
    data?.endedAt ?? battle?.endedAt ?? data?.createdAt ?? battle?.createdAt ??
    data?.startedAt ?? battle?.startedAt ?? data?.timestamp ?? battle?.timestamp
  );
}

function normalizeBattleLogs(userId, payload, eraStartedAt, eraEndedAt) {
  const battles = Array.isArray(payload?._items) ? payload._items : [];
  const rankedBattles = battles.filter((battle) => battle?.gameData?.gameMode === "ranked");
  const timestamps = rankedBattles.map(battleTimestamp).filter(Boolean).sort();
  const eraStartMs = toEpochMs(eraStartedAt);
  const eraEndMs = toEpochMs(eraEndedAt);
  const inEra = rankedBattles.filter((battle) => {
    const timestamp = battleTimestamp(battle);
    if (!timestamp) return false;
    const time = Date.parse(timestamp);
    return (!eraStartedAt || time >= eraStartMs) &&
      (!eraEndedAt || time < eraEndMs);
  });
  const missingTimestampCount = rankedBattles.length - timestamps.length;
  const oldestBattleReturnedAt = timestamps[0] || null;
  const reachedLimit = battles.length >= REQUESTED_LIMIT;
  const oldestAfterStart = oldestBattleReturnedAt && Number.isFinite(eraStartMs)
    ? Date.parse(oldestBattleReturnedAt) > eraStartMs
    : false;
  const eraCoverage = reachedLimit || oldestAfterStart ? "partial" : "unknown";

  return {
    battleLogsFetchedCount: battles.length,
    rankedBattlesInEraCount: inEra.length,
    oldestBattleReturnedAt,
    newestBattleReturnedAt: timestamps.at(-1) || null,
    missingTimestampCount,
    eraCoverage,
    rankedBattles: inEra.map((battle) => ({
      timestamp: battleTimestamp(battle),
      gameData: battle?.gameData || null
    })),
    userID: userId
  };
}

export function buildBattleLogUrl({ apiUrl = MAVIS_API_URL, userId }) {
  return `${apiUrl}/origin/v2/community/users/${encodeURIComponent(userId)}/battle-logs?limit=${REQUESTED_LIMIT}`;
}

export async function fetchArchivalBattleLogs({
  userId,
  eraStartedAt = null,
  eraEndedAt = null,
  fetchImpl = fetch,
  apiUrl = MAVIS_API_URL,
  apiKey = AXIE_ECHELON_API_KEY,
  signal
}) {
  const url = buildBattleLogUrl({ apiUrl, userId });
  const response = await withBattleLogSlot(
    () => fetchWithRetry(
      url,
      { headers: { "x-api-key": apiKey }, signal },
      { debug: DEBUG_ON, fetchImpl }
    ),
    "low"
  );
  if (!response.ok) {
    const error = new Error(`Archival battle-log fetch failed: ${response.status}`);
    error.status = response.status;
    error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
    throw error;
  }
  const rawResponse = await response.json();
  const normalized = normalizeBattleLogs(userId, rawResponse, eraStartedAt, eraEndedAt);
  return {
    rawResponse,
    normalized,
    httpStatus: response.status,
    requestedLimit: REQUESTED_LIMIT,
    checksum: createHash("sha256").update(JSON.stringify(rawResponse), "utf8").digest("hex")
  };
}

export { normalizeBattleLogs, REQUESTED_LIMIT };
