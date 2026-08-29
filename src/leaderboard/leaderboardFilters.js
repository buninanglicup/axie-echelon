// Pure leaderboard filter predicates. This module reads shared state but does
// not manipulate the DOM or trigger network requests.
import { leaderboardState } from "./leaderboardState.js";
import { battleTimeCacheKey, lastKnownGoodBattleTime } from "./leaderboardState.js";

export function applyRankFilter(players) {
  const { rankMin, rankMax } = leaderboardState;
  return (players || []).filter((player) => {
    const rank = Number(player?.rank);
    if (!Number.isFinite(rank) || rank <= 0) return false;
    if (rankMin && rank < rankMin) return false;
    if (rankMax && rank > rankMax) return false;
    return true;
  });
}

export function getLastBattleTimestamp(player) {
  if (player.lastRankedBattleTime) return player.lastRankedBattleTime;
  if (player.team?.lastRankedBattleTime) return player.team.lastRankedBattleTime;

  // A failed live poll is not evidence that a previously active player
  // became inactive. Use the last successful timestamp for filtering only;
  // the renderer still receives the raw current-cycle value.
  if (player.userID) {
    const key = battleTimeCacheKey(leaderboardState.currentEraMilestone, player.userID);
    if (lastKnownGoodBattleTime.has(key)) return lastKnownGoodBattleTime.get(key);
  }

  return null;
}

export function applyLeaderboardActivityFilter(players) {
  const { liveModeEnabled, activeBattleWindowMinutes } = leaderboardState;
  if (!liveModeEnabled || activeBattleWindowMinutes === null || activeBattleWindowMinutes === undefined) return players;

  const now = Date.now();
  const windowMs = activeBattleWindowMinutes * 60 * 1000;

  return (players || []).filter((player) => {
    const timestamp = getLastBattleTimestamp(player);
    if (!timestamp) return false;

    const ts = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(ts)) return false;

    const ageMs = now - ts;
    return ageMs >= 0 && ageMs <= windowMs;
  });
}

export function applyLeaderboardFilters(players) {
  return applyRankFilter(applyLeaderboardActivityFilter(players));
}
