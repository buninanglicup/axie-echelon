import express from "express";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { CandidatePoolUnavailableError, fetchRankCandidates } from "./leaderboardCandidates.js";
import { resolveEraMilestone } from "../seasonRoutes.js";

const router = express.Router();

router.get("/api/leaderboard/pool", async (request, response) => {
  try {
    const eraMilestone = resolveEraMilestone(request);
    const rankMin = Math.max(1, Number(request.query.rankMin) || 1);
    const requestedRankMax = Math.max(rankMin, Number(request.query.rankMax) || LEADERBOARD_MAX_RANK);
    const rankMax = Math.min(requestedRankMax, LEADERBOARD_MAX_RANK);
    const candidates = await fetchRankCandidates(eraMilestone, rankMax);

    const players = candidates
      .filter((player) => {
        const rank = Number(player.topRank || player.rank);
        return Number.isFinite(rank) && rank >= rankMin && rank <= rankMax;
      })
      .map((player) => ({
        rank: player.topRank || player.rank,
        name: player.name || player.userID,
        mmr: player.vstar || player.rating,
        // NOT YET IMPLEMENTED: win_rate, daily_change, and recent_form do not exist
        // on the real Skymavis season-leaderboards response (confirmed against a
        // live payload -- see docs/planning/leaderboard-roadmap.md). These fields
        // have always evaluated to null / "-" / [] for every player. Left in place,
        // clearly marked, as a known future feature rather than removed, since
        // comparable leaderboard tools do support this and it's worth adding once a
        // real data source (per-player call, or a different upstream field) is
        // identified.
        winRate: player.win_rate !== null && player.win_rate !== undefined ? player.win_rate * 100 : null,
        dailyChange: player.daily_change || "-",
        recentForm: Array.isArray(player.recent_form) ? player.recent_form : [],
        userID: player.userID,
        enrichment: { status: "not_requested" }
      }));

    response.json({ players, rankMin, rankMax, milestone: eraMilestone, poolMaxRank: LEADERBOARD_MAX_RANK });
  } catch (error) {
    console.error("[/api/leaderboard/pool] Error:", error.message);
    if (error instanceof CandidatePoolUnavailableError || error.code === "LEADERBOARD_UPSTREAM_UNAVAILABLE") {
      response.set("Retry-After", String(error.retryAfterSeconds ?? 5));
      response.status(503).json({ error: "Leaderboard upstream is temporarily unavailable." });
      return;
    }
    response.status(500).json({ error: "Failed to fetch leaderboard pool." });
  }
});

export default router;