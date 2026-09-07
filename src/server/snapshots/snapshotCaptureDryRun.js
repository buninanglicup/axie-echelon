import { LEADERBOARD_MAX_RANK } from "../leaderboard/leaderboardConstants.js";
import { buildSeasonalLeaderboardUrl } from "./candidateFreezer.js";

const RANK_MIN = 1;

// This is deliberately dependency-injected so the command's dry-run behavior
// can be verified without credentials or network access.
export async function runSnapshotCaptureDryRun({
  options,
  apiKey,
  apiUrl,
  eraWindow,
  fetchImpl = fetch,
  battleLogProbe
}) {
  const response = await fetchImpl(
    buildSeasonalLeaderboardUrl({
      apiUrl,
      seasonId: options.season,
      milestone: options.milestone,
      limit: 1,
      offset: 0
    }),
    { headers: { "x-api-key": apiKey } }
  );
  if (!response.ok) throw new Error(`Dry-run candidate availability check failed: ${response.status}`);

  const payload = await response.json();
  const available = Array.isArray(payload?._items) ? payload._items.length : 0;
  const report = {
    dryRun: true,
    season: options.season,
    milestone: options.milestone,
    scopeKey: `season:${options.season}:milestone:${options.milestone}`,
    rankRange: `${RANK_MIN}-${LEADERBOARD_MAX_RANK}`,
    firstPageCandidates: available,
    estimatedLeaderboardPages: Math.ceil(LEADERBOARD_MAX_RANK / 100),
    candidatesOnly: options.candidatesOnly || false,
    storesBattleLogs: false
  };

  if (options.candidatesOnly) {
    report.estimatedBattleLogRequests = 0;
    report.battleLogProbe = { skipped: "candidates-only mode" };
    return report;
  }

  const probeCandidate = payload?._items?.[0];
  if (!probeCandidate?.userID) throw new Error("Dry-run candidate availability check returned no usable user ID.");
  if (typeof battleLogProbe !== "function") throw new Error("Dry-run battle-log probe is required.");
  const battleLog = await battleLogProbe({
    userId: probeCandidate.userID,
    apiUrl,
    apiKey,
    eraStartedAt: eraWindow.eraStartedAt,
    eraEndedAt: eraWindow.eraEndedAt
  });
  report.estimatedBattleLogRequests = LEADERBOARD_MAX_RANK;
  report.battleLogProbe = {
    httpStatus: battleLog.httpStatus,
    requestedLimit: battleLog.requestedLimit,
    battleLogsFetchedCount: battleLog.normalized.battleLogsFetchedCount,
    eraCoverage: battleLog.normalized.eraCoverage
  };
  return report;
}
