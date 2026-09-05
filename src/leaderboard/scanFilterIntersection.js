export function intersectScanMatches(primaryMatches, secondaryMatches) {
  const secondaryPlayerIds = new Set(
    secondaryMatches.map((player) => player.userID ?? `rank:${player.rank}`)
  );
  return primaryMatches.filter((player) => secondaryPlayerIds.has(player.userID ?? `rank:${player.rank}`));
}
