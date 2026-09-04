// Manual-only live benchmark for the async rune-scan job against real
// Skymavis data. This complements the offline fixture tests and is not run
// by npm test or CI. See docs/implementation/rune-scan-fixtures.md.
//
// Usage:
//   node scripts/live-rune-scan-benchmark.mjs <eraMilestone> <runeId>
//
// Example:
//   node scripts/live-rune-scan-benchmark.mjs 3 rune_dusk_40040_s18
//
// Requires AXIE_ECHELON_API_KEY in .env and consumes live API quota. It
// prints progress such as `12000ms: 400/1000, 3 matches, running`, followed
// by a final elapsed-time line. Do not use this script for CI assertions;
// network latency and upstream rate limits make live timings variable.
import "dotenv/config";
import { startRuneScanJob, getRuneScanJob } from "../src/server/leaderboard/runeScanJobs.js";
import { LEADERBOARD_MAX_RANK } from "../src/server/leaderboard/leaderboardConstants.js";

const eraMilestone = process.argv[2];
const runeId = process.argv[3];
if (!eraMilestone || !runeId) {
  console.error("Usage: node scripts/live-rune-scan-benchmark.mjs <eraMilestone> <runeId>");
  process.exit(1);
}

const startedAt = Date.now();
const started = startRuneScanJob({ runeIds: [runeId], eraMilestone, rankMin: 1, rankMax: LEADERBOARD_MAX_RANK });
console.log(`Started ${started.jobId} (${started.status})`);
let lastProcessed = -1;
while (true) {
  const job = getRuneScanJob(started.jobId);
  if (job.processedCount !== lastProcessed) {
    console.log(`${Date.now() - startedAt}ms: ${job.processedCount}/${job.totalCandidates ?? "?"}, ${job.matches.length} matches, ${job.status}`);
    lastProcessed = job.processedCount;
  }
  if (["complete", "failed", "cancelled"].includes(job.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const finalJob = getRuneScanJob(started.jobId);
console.log(`Finished in ${Date.now() - startedAt}ms with status=${finalJob.status}`);
console.log(`Final progress: ${finalJob.processedCount}/${finalJob.totalCandidates ?? "?"}, ${finalJob.matches.length} matches`);
if (finalJob.error) console.log(`Error: ${finalJob.error.code} - ${finalJob.error.message}`);
