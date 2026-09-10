// This bounded in-memory store retains battles that the app has already
// observed. Explicit profile pagination remains the source for deeper history.

const MAX_RETAINED_BATTLES_PER_USER = Number(process.env.PROFILE_BATTLE_LOG_RETENTION_MAX || 200);
const MAX_RETAINED_AGE_MS = Number(process.env.PROFILE_BATTLE_LOG_RETENTION_MAX_AGE_MS || 30 * 24 * 60 * 60 * 1000);
const SWEEP_INTERVAL_MS = Number(process.env.PROFILE_BATTLE_LOG_RETENTION_SWEEP_INTERVAL_MS || 10 * 60 * 1000);

const retentionStore = new Map();

function battleKey(entry) {
  return entry.battleId || `${entry.timestamp || "unknown"}::${entry.opponent?.userID || "unknown"}`;
}

export function mergeObservedBattleLogs(userID, entries) {
  if (!userID || !Array.isArray(entries) || entries.length === 0) return;
  let userMap = retentionStore.get(userID);
  if (!userMap) {
    userMap = new Map();
    retentionStore.set(userID, userMap);
  }
  const observedAt = Date.now();
  for (const entry of entries) {
    const key = battleKey(entry);
    const existing = userMap.get(key);
    userMap.set(key, { ...entry, observedAt: existing?.observedAt || observedAt });
  }
  enforcePerUserCap(userMap);
}

export function getRetainedBattleLogs(userID) {
  const userMap = retentionStore.get(userID);
  if (!userMap) return [];
  return [...userMap.values()].sort(
    (left, right) => Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0)
  );
}

export function getRetentionInfo(userID) {
  const userMap = retentionStore.get(userID);
  return {
    retainedCount: userMap ? userMap.size : 0,
    maxRetainedBattles: MAX_RETAINED_BATTLES_PER_USER,
    maxRetainedAgeMs: MAX_RETAINED_AGE_MS,
    note: "Only battles observed by this app are retained in memory. Deeper profile history is fetched explicitly in offset pages."
  };
}

function enforcePerUserCap(userMap) {
  if (userMap.size <= MAX_RETAINED_BATTLES_PER_USER) return;
  const sortedNewestFirst = [...userMap.entries()].sort(
    (left, right) => Date.parse(right[1].timestamp || 0) - Date.parse(left[1].timestamp || 0)
  );
  for (const [key] of sortedNewestFirst.slice(MAX_RETAINED_BATTLES_PER_USER)) userMap.delete(key);
}

function sweepRetentionStore() {
  const now = Date.now();
  for (const [userID, userMap] of retentionStore) {
    for (const [key, entry] of userMap) {
      if (now - entry.observedAt > MAX_RETAINED_AGE_MS) userMap.delete(key);
    }
    enforcePerUserCap(userMap);
    if (userMap.size === 0) retentionStore.delete(userID);
  }
}

const retentionSweepTimer = setInterval(sweepRetentionStore, SWEEP_INTERVAL_MS);
retentionSweepTimer.unref?.();

export { MAX_RETAINED_BATTLES_PER_USER, MAX_RETAINED_AGE_MS };
