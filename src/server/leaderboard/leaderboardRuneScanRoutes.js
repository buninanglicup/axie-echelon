import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { resolveEraMilestone } from "../seasonRoutes.js";
import { startRuneScanJob, getRuneScanJob, cancelRuneScanJob } from "./runeScanJobs.js";

const router = express.Router();

// Same runeId-merging convention as leaderboardRuneRoutes.js's sync route,
// minus the :runeId path param -- job creation isn't scoped to a single
// rune in the URL, so all runeIds come from repeatable ?runeId= query params.
function parseRuneIds(request) {
  const queryRuneIds = Array.isArray(request.query.runeId)
    ? request.query.runeId
    : request.query.runeId
    ? [request.query.runeId]
    : [];
  return [...new Set(queryRuneIds.map(String).map((value) => value.trim()).filter(Boolean))];
}

router.post("/api/leaderboard/rune-scan", (request, response) => {
  const runeIds = parseRuneIds(request);
  if (!runeIds.length) {
    return response.status(400).json({ error: "At least one runeId is required.", code: "RUNE_ID_REQUIRED" });
  }

  const eraMilestone = resolveEraMilestone(request);
  const rankMin = Math.max(1, Number(request.query.rankMin) || 1);
  const requestedRankMax = Math.max(rankMin, Number(request.query.rankMax) || LEADERBOARD_MAX_RANK);
  const rankMax = Math.min(requestedRankMax, LEADERBOARD_MAX_RANK);
  const name = typeof request.query.name === "string" ? request.query.name.trim() : "";

  if (DEBUG_ON) {
    console.log(
      `[POST /api/leaderboard/rune-scan] starting job runeIds=${runeIds.join(",")} eraMilestone=${eraMilestone} ranks=${rankMin}-${rankMax}`
    );
  }

  // startRuneScanJob() returns synchronously (queued/running/dedup-hit) --
  // the scan itself runs in the background via runeScanJobs.js. 202 signals
  // "accepted for async processing," matching that -- the response body is
  // the job snapshot the client will keep polling with GET.
  const job = startRuneScanJob({ runeIds, eraMilestone, rankMin, rankMax, name });
  response.status(202).json(job);
});

router.get("/api/leaderboard/rune-scan/:jobId", (request, response) => {
  const job = getRuneScanJob(request.params.jobId);
  if (!job) {
    return response.status(404).json({ error: "Rune scan job not found.", code: "RUNE_SCAN_JOB_NOT_FOUND" });
  }
  response.json(job);
});

router.delete("/api/leaderboard/rune-scan/:jobId", (request, response) => {
  const job = cancelRuneScanJob(request.params.jobId);
  if (!job) {
    return response.status(404).json({ error: "Rune scan job not found.", code: "RUNE_SCAN_JOB_NOT_FOUND" });
  }
  response.json(job);
});

export default router;