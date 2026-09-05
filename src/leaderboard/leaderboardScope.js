// A leaderboard source is either one numbered season era or the current
// offseason ladder. Keeping that distinction explicit prevents callers from
// inventing a fake milestone for offseason data.
export function normalizeLeaderboardScope(scope) {
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    if (scope.offSeasonMode) {
      return {
        ...scope,
        seasonId: scope.seasonId ?? "unknown",
        offSeasonMode: true,
        milestone: null,
        eraName: scope.eraName || "Offseason"
      };
    }

    if (scope.milestone === null || scope.milestone === undefined || scope.milestone === "") {
      throw new Error("A seasonal leaderboard scope requires a milestone.");
    }

    return {
      ...scope,
      seasonId: scope.seasonId ?? "unknown",
      offSeasonMode: false,
      milestone: scope.milestone
    };
  }

  // Compatibility for internal callers and fixtures that still pass a raw
  // milestone while the scope-aware path is adopted.
  return {
    seasonId: "legacy",
    offSeasonMode: false,
    milestone: scope
  };
}

export function getLeaderboardScopeKey(scope) {
  const normalized = normalizeLeaderboardScope(scope);
  if (normalized.offSeasonMode) return `offseason:${normalized.seasonId}`;
  return `season:${normalized.seasonId}:milestone:${normalized.milestone}`;
}

// The current resolver result and the selected data source are intentionally
// separate concepts. During offseason, a numbered era remains a historical
// season source, not an alias for the current offseason ladder.
export function createHistoricalLeaderboardScope(automaticScope, milestone, eraName) {
  const normalizedAutomaticScope = normalizeLeaderboardScope(automaticScope);
  const normalizedMilestone = String(milestone);
  if (!/^[1-4]$/.test(normalizedMilestone)) {
    throw new Error("A historical leaderboard scope requires milestone 1 through 4.");
  }

  return {
    seasonId: normalizedAutomaticScope.seasonId,
    seasonName: normalizedAutomaticScope.seasonName,
    offSeasonMode: false,
    milestone: normalizedMilestone,
    eraName: eraName || `Era ${normalizedMilestone}`
  };
}

export function getSelectedEraMilestone(scope) {
  const normalized = normalizeLeaderboardScope(scope);
  return normalized.offSeasonMode ? null : String(normalized.milestone);
}

// An era only becomes historical once it has been reached. During offseason
// the completed season makes all four numbered eras available.
export function getVisibleEraMilestones(automaticScope) {
  const normalized = normalizeLeaderboardScope(automaticScope);
  if (normalized.offSeasonMode) return ["1", "2", "3", "4"];

  const currentMilestone = Number(normalized.milestone);
  if (!Number.isInteger(currentMilestone) || currentMilestone < 1 || currentMilestone > 4) {
    return [];
  }
  return Array.from({ length: currentMilestone }, (_, index) => String(index + 1));
}

// The selected tab already identifies the automatic current era. A return
// action is needed only after a manual historical selection; offseason keeps
// its current label visible because it has no numbered tab of its own.
export function getCurrentLeaderboardControl(automaticScope, isManualHistoricalScope) {
  const normalized = normalizeLeaderboardScope(automaticScope);
  const visible = Boolean(isManualHistoricalScope) || normalized.offSeasonMode;
  return {
    visible,
    label: visible ? `Current: ${normalized.eraName}` : "",
    actionable: Boolean(isManualHistoricalScope)
  };
}

export function isCurrentLeaderboardScope(responseScope, currentScope) {
  return getLeaderboardScopeKey(responseScope) === getLeaderboardScopeKey(currentScope);
}

export function appendLeaderboardScopeParams(params, scope) {
  const normalized = normalizeLeaderboardScope(scope);
  if (normalized.offSeasonMode) {
    params.delete("milestone");
  } else {
    params.set("milestone", String(normalized.milestone));
  }
  return params;
}

export function getLeaderboardEndpointPath(scope) {
  return normalizeLeaderboardScope(scope).offSeasonMode
    ? "/origins/v2/leaderboards"
    : "/origins/v2/season-leaderboards";
}
