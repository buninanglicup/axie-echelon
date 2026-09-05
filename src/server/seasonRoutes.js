import express from "express";
import { getCurrentEraForConfiguredSeason } from "../eraResolver.js";

const router = express.Router();

// An explicit milestone is always a request for a season-era ladder. When no
// milestone is supplied, use the configured current mode, which may be the
// non-milestone offseason ladder.
export function resolveLeaderboardScope(request) {
  const current = getCurrentEraForConfiguredSeason();
  const requestedMilestone = typeof request.query.milestone === "string"
    ? request.query.milestone.trim()
    : "";

  // Only the four configured season eras may select the seasonal endpoint.
  // Invalid values deliberately fall back to automatic mode so neither
  // `milestone=null` nor an invented fifth milestone reaches Sky Mavis.
  if (!/^[1-4]$/.test(requestedMilestone)) return current;

  return {
    seasonId: current.seasonId,
    seasonName: current.seasonName,
    offSeasonMode: false,
    milestone: requestedMilestone,
    eraName: `Era ${requestedMilestone}`
  };
}

// Retained for callers outside the scope-aware leaderboard paths. It returns
// null in automatic offseason mode rather than serializing null as "null".
export function resolveEraMilestone(request) {
  return resolveLeaderboardScope(request).milestone;
}

router.get("/api/season/current", (request, response) => {
  response.json(getCurrentEraForConfiguredSeason());
});

export default router;
