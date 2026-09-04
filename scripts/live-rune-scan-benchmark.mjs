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
console.log(`Finished in ${Date.now() - startedAt}ms`);
