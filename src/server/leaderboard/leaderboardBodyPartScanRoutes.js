import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { resolveEraMilestone } from "../seasonRoutes.js";
import { startBodyPartScanJob, getBodyPartScanJob, cancelBodyPartScanJob } from "./bodyPartScanJobs.js";

const router = express.Router();

function parseBodyPartNames(request) {
  const queryBodyPartNames = Array.isArray(request.query.bodyPartName)
    ? request.query.bodyPartName
    : request.query.bodyPartName
    ? [request.query.bodyPartName]
    : [];
  return [...new Set(queryBodyPartNames.map(String).map((value) => value.trim()).filter(Boolean))];
}

router.post("/api/leaderboard/body-part-scan", (request, response) => {
  const bodyPartNames = parseBodyPartNames(request);
  if (!bodyPartNames.length) {
    return response.status(400).json({ error: "At least one bodyPartName is required.", code: "BODY_PART_NAME_REQUIRED" });
  }

  const eraMilestone = resolveEraMilestone(request);
  const requestedRankMin = Math.max(1, Number(request.query.rankMin) || 1);
  const rankMin = Math.min(requestedRankMin, LEADERBOARD_MAX_RANK);
  const requestedRankMax = Math.max(rankMin, Number(request.query.rankMax) || LEADERBOARD_MAX_RANK);
  const rankMax = Math.min(requestedRankMax, LEADERBOARD_MAX_RANK);
  const name = typeof request.query.name === "string" ? request.query.name.trim() : "";

  if (DEBUG_ON) {
    console.log(
      `[POST /api/leaderboard/body-part-scan] starting job bodyPartNames=${bodyPartNames.join(",")} eraMilestone=${eraMilestone} ranks=${rankMin}-${rankMax}`
    );
  }

  const job = startBodyPartScanJob({ bodyPartNames, eraMilestone, rankMin, rankMax, name });
  response.status(202).json(job);
});

router.get("/api/leaderboard/body-part-scan/:jobId", (request, response) => {
  const job = getBodyPartScanJob(request.params.jobId);
  if (!job) {
    return response.status(404).json({ error: "Body-part scan job not found.", code: "BODY_PART_SCAN_JOB_NOT_FOUND" });
  }
  response.json(job);
});

router.delete("/api/leaderboard/body-part-scan/:jobId", (request, response) => {
  const job = cancelBodyPartScanJob(request.params.jobId);
  if (!job) {
    return response.status(404).json({ error: "Body-part scan job not found.", code: "BODY_PART_SCAN_JOB_NOT_FOUND" });
  }
  response.json(job);
});

export default router;
