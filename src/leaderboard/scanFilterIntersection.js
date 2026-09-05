export function intersectScanMatches(primaryMatches, secondaryMatches) {
  const safePrimaryMatches = Array.isArray(primaryMatches) ? primaryMatches : [];
  const safeSecondaryMatches = Array.isArray(secondaryMatches) ? secondaryMatches : [];
  const secondaryPlayerIds = new Set(
    safeSecondaryMatches.map((player) => player.userID ?? `rank:${player.rank}`)
  );
  return safePrimaryMatches.filter((player) => secondaryPlayerIds.has(player.userID ?? `rank:${player.rank}`));
}

// Scan endpoints already apply OR semantics within each filter type. The view
// only intersects the two completed result sets when both filters are active.
export function getVisibleScanMatches({
  runeFilterActive,
  runeMatches,
  bodyPartFilterActive,
  bodyPartMatches
}) {
  if (runeFilterActive && bodyPartFilterActive) {
    return intersectScanMatches(runeMatches, bodyPartMatches);
  }
  if (runeFilterActive) return Array.isArray(runeMatches) ? runeMatches : [];
  if (bodyPartFilterActive) return Array.isArray(bodyPartMatches) ? bodyPartMatches : [];
  return [];
}

// Keeps controller response ordering deterministic: a cancelled, cleared, or
// superseded job must never replace the newer scan's matches or status.
export function isCurrentScanUpdate({ generation, currentGeneration, filterActive }) {
  return filterActive && generation === currentGeneration;
}

// Returns a new state object so callers can clear one scan filter without
// resetting the other scan selection or unrelated leaderboard filters.
export function clearScanFilterState(state, filterType) {
  if (filterType === "rune") {
    return {
      ...state,
      activeRuneId: null,
      selectedRunes: [],
      runeFilterActive: false
    };
  }
  if (filterType === "body-part") {
    return {
      ...state,
      selectedBodyPartNames: [],
      bodyPartFilterActive: false
    };
  }
  return { ...state };
}
