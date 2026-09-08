function formatHistoricalTimestamp(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function historicalCoverageText(coverage) {
  if (coverage === "partial") return "Coverage: partial — recent battle logs only; not exhaustive era history.";
  if (coverage === "unknown") return "Coverage: unknown — completeness could not be verified; not exhaustive era history.";
  return "Coverage: complete under this capture's documented policy.";
}

// Keep the visible label compact while returning detail for the native tooltip.
export function formatHistoricalTeamProvenance(player) {
  const evidence = player?.historicalTeamEvidence;
  const snapshot = player?.snapshot;
  const selectedBattle = formatHistoricalTimestamp(evidence?.selectedBattleTimestamp);
  const coverage = snapshot?.eraCoverage || "unknown";
  const label = evidence?.teamEvidence === "legacy" ? "Historical ranked team" : "Historical team";
  const parts = [label, selectedBattle && `battle ${selectedBattle}`].filter(Boolean);
  if (coverage !== "complete") parts.push(`${coverage} coverage`);
  return {
    text: parts.join(" · "),
    detail: historicalCoverageText(coverage),
    capturedAt: formatHistoricalTimestamp(evidence?.capturedAt || snapshot?.capturedAt)
  };
}
