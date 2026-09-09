// Small mutable state module matching the vanilla-JavaScript frontend pattern.
// The profile endpoint is capped at its observed 20-battle display window;
// scope fields keep historical-snapshot requests aligned with leaderboard scope.
export const profileState = {
  userID: null,
  totalItems: 0,
  items: [],
  source: null,
  liveFetchFailed: false,
  retention: null,
  loading: false,
  error: null
};

export async function fetchProfileBattleLogPage(userID, { leaderboardScope = null } = {}) {
  const params = new URLSearchParams({ limit: "20" });
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
    const data = await fetchProfileBattleLogPage(userID, { leaderboardScope });
    Object.assign(profileState, {
      userID: data.resolvedUserID || userID,
      totalItems: data.totalItems,
      items: data.items,
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
