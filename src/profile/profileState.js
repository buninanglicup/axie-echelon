// Small mutable state module matching the vanilla-JavaScript frontend pattern.
// Profile history is fetched in explicit 20-battle offset pages; scope fields
// keep historical-snapshot requests aligned with leaderboard scope.
export const profileState = {
  userID: null,
  playerName: null,
  roninAddress: null,
  totalItems: 0,
  items: [],
  pagination: { limit: 20, offset: 0, hasNext: false },
  loadingMore: false,
  source: null,
  liveFetchFailed: false,
  retention: null,
  loading: false,
  error: null
};

export async function fetchProfileBattleLogPage(userID, { leaderboardScope = null, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (leaderboardScope) {
    if (leaderboardScope.milestone !== undefined && leaderboardScope.milestone !== null) params.set("milestone", String(leaderboardScope.milestone));
    if (leaderboardScope.seasonId !== undefined && leaderboardScope.seasonId !== null) params.set("seasonId", String(leaderboardScope.seasonId));
    if (leaderboardScope.offSeasonMode) params.set("offSeasonMode", "true");
  }

  const response = await fetch(`/api/profile/${encodeURIComponent(userID)}/battle-logs?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

export async function loadProfileBattlePage(userID, leaderboardScope = null) {
  profileState.userID = userID;
  profileState.loading = true;
  profileState.error = null;
  try {
    const data = await fetchProfileBattleLogPage(userID, { leaderboardScope, offset: 0 });
    Object.assign(profileState, {
      userID: data.resolvedUserID || userID,
      playerName: data.resolvedPlayerName || null,
      roninAddress: data.resolvedRoninAddress || null,
      totalItems: data.totalItems,
      items: data.items,
      pagination: data.pagination || { limit: 20, offset: 0, hasNext: false },
      source: data.source,
      liveFetchFailed: Boolean(data.liveFetchFailed),
      retention: data.retention || null,
      loading: false
    });
  } catch (error) {
    profileState.loading = false;
    profileState.error = error.message;
  }
  return profileState;
}

export async function loadMoreProfileBattleLogs(leaderboardScope = null) {
  if (profileState.loadingMore || !profileState.pagination?.hasNext || !profileState.userID) return profileState;
  profileState.loadingMore = true;
  try {
    const offset = profileState.pagination.offset + profileState.pagination.limit;
    const data = await fetchProfileBattleLogPage(profileState.userID, { leaderboardScope, offset });
    const knownBattleIDs = new Set(profileState.items.map((item) => item.battleId).filter(Boolean));
    const newItems = (data.items || []).filter((item) => !item.battleId || !knownBattleIDs.has(item.battleId));
    profileState.items.push(...newItems);
    profileState.pagination = data.pagination || { limit: 20, offset, hasNext: false };
    profileState.totalItems = profileState.items.length;
  } catch (error) {
    profileState.error = error.message;
  } finally {
    profileState.loadingMore = false;
  }
  return profileState;
}
