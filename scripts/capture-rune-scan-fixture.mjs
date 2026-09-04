// Manual, local-only capture of a real top-1000 rune-scan snapshot from
// Skymavis, for inspecting real data shapes. This is not a source for the
// committed synthetic fixture. See docs/implementation/rune-scan-fixtures.md
// for the full fixture workflow.
//
// Usage:
//   node scripts/capture-rune-scan-fixture.mjs <eraMilestone>
//
// Example:
//   node scripts/capture-rune-scan-fixture.mjs season18
//
// Requires AXIE_ECHELON_API_KEY in .env. A full top-1000 capture makes up to
// ten leaderboard calls plus one battle-log call per candidate, so it can
// take a while and consume real API quota. Run it manually, never in CI.
//
// On success, the script prints the candidate/team counts and output path.
// The output contains real player IDs, names, and team data and must never be
// committed. It is written under api-responses/, which .gitignore excludes.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import { fetchRankCandidates } from "../src/server/leaderboard/leaderboardCandidates.js";
import { fetchBattleLogsForClientDeduped } from "../src/server/leaderboard/battleLogClient.js";
import { LEADERBOARD_MAX_RANK } from "../src/server/leaderboard/leaderboardConstants.js";

const eraMilestone = process.argv[2];
if (!eraMilestone) {
  console.error("Usage: node scripts/capture-rune-scan-fixture.mjs <eraMilestone>");
  process.exit(1);
}

const outputPath = path.join(process.cwd(), "api-responses", "rune-scan-fixture-capture.json");

async function main() {
  const candidates = await fetchRankCandidates(eraMilestone, LEADERBOARD_MAX_RANK);
  const teams = {};
  const erroredUserIDs = [];
  for (const candidate of candidates) {
    if (!candidate.userID) continue;
    const team = await fetchBattleLogsForClientDeduped(candidate.userID, 20, "low");
    if (team) teams[candidate.userID] = team;
    else erroredUserIDs.push(candidate.userID);
  }
  const capture = {
    capturedAt: new Date().toISOString(),
    eraMilestone,
    sourceEndpoint: "origins/v2/season-leaderboards + origin/v2/community/users/:id/battle-logs",
    candidates,
    teams,
    erroredUserIDs
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(capture, null, 2));
  console.log(
    `Wrote local-only capture to ${outputPath} ` +
      `(${candidates.length} candidates, ${Object.keys(teams).length} teams, ` +
      `${erroredUserIDs.length} errored). This file is git-ignored -- never commit it as-is.`
  );
}

main().catch((error) => {
  console.error(`Capture failed: ${error.message}`);
  process.exit(1);
});
