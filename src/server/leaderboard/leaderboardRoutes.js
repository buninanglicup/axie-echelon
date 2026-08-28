// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes. Route paths are unchanged, so the frontend requires no
// changes for this split.
import express from "express";
import { DEBUG_ON } from "../shared/env.js";
import { fetchAndEnrichLeaderboard, schedulePageRefresh } from "./leaderboardEnrichment.js";
import { getCachedPage, setCachedPage } from "./leaderboardCaches.js";
import { fetchRankCandidates } from "./leaderboardCandidates.js";
import { scanLeaderboardForRune } from "./runeScanner.js";
import { getOrFetchPlayerEnrichment } from "./enrichmentCache.js";
import { runeRegistry } from "./runeCatalog.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";
import { getCurrentEraForConfiguredSeason } from "../../eraResolver.js";

const router = express.Router();

// Sky Mavis calls an era's numeric selector `milestone`. Keep that name only
// at the HTTP/API boundary; internal callers use `eraMilestone`.
function resolveEraMilestone(request) {
  // Explicit API values support viewing a deliberate past era; otherwise use
  // the era currently calculated from the configured season.
  return request.query.milestone
    ? String(request.query.milestone)
    : String(getCurrentEraForConfiguredSeason().milestone);
}

router.get("/api/season/current", (request, response) => {
  response.json(getCurrentEraForConfiguredSeason());
});

router.get("/api/leaderboard/rune/:runeId", async (request, response) => {
  try {
    const runeId = String(request.params.runeId || "").trim();
    if (!runeId) {
      return response.status(400).json({ error: "runeId is required." });
    }
    const eraMilestone = resolveEraMilestone(request);

    if (DEBUG_ON) console.log(`[/api/leaderboard/rune] Scanning ranks 1-${LEADERBOARD_MAX_RANK} for rune=${runeId} eraMilestone=${eraMilestone}`);

    const players = await scanLeaderboardForRune(runeId, eraMilestone);

    response.json({
      players,
      runeId,
      milestone: eraMilestone,
      scannedRanks: LEADERBOARD_MAX_RANK
    });
  } catch (error) {
    console.error("[/api/leaderboard/rune] Error:", error.message);
    response.status(500).json({ error: "Failed to scan leaderboard for rune." });
  }
});

// ========== RUNE CATALOG (for the filter picker UI) ==========
// Runes are pre-generated in src/data/runes.json via scripts/update-runes.mjs
// To update runes when a new season starts, run: node .\scripts\update-runes.mjs
router.get("/api/runes", (request, response) => {
  // Convert registry object into array for API response
  const runes = Object.values(runeRegistry);
  response.json({ runes });
});

// ========== LEADERBOARD POOL (Phase 1: cheap-field candidate pool) ==========
//
// Returns rank/name/mmr/winRate for a rank range up to LEADERBOARD_MAX_RANK,
// with NO team/battle-log enrichment attached -- that's fetched separately,
// on demand, per player, via GET /api/leaderboard/team/:userID below. This
// lets the client paginate instantly over a large rank range (up to 1000)
// without waiting on expensive per-player battle-log fetches for players it
// may never actually scroll to.
//
// Reuses fetchRankCandidates() (originally built for the rune scanner) --
// that function was already rank-range-general, just previously only ever
// called with the full leaderboard rank ceiling. Note: because fetchRankCandidates() caches
// by exact `${eraMilestone}_${maxRank}` key, a pool request for 250 and a rune
// scan for 200 currently populate two separate cache entries with
// overlapping rank data (1-200 fetched twice, under different keys) rather
// than sharing one. Left as-is for Phase 1 -- worth collapsing onto a single
// cache key later if it turns out to matter in practice.
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
        winRate: player.win_rate !== null && player.win_rate !== undefined ? player.win_rate * 100 : null,
        dailyChange: player.daily_change || "-",
        recentForm: Array.isArray(player.recent_form) ? player.recent_form : [],
        userID: player.userID,
        // Seeded, not fetched -- see the PlayerEnrichment status model in
        // leaderboard-pagination-plan.md ยง4. The frontend is responsible
        // for moving a player through queued/loading as it requests
        // GET /api/leaderboard/team/:userID for whichever page is visible.
        enrichment: { status: "not_requested" }
      }));

    response.json({
      players,
      rankMin,
      rankMax,
      milestone: eraMilestone,
      poolMaxRank: LEADERBOARD_MAX_RANK
    });
  } catch (error) {
    console.error("[/api/leaderboard/pool] Error:", error.message);
    response.status(500).json({ error: "Failed to fetch leaderboard pool." });
  }
});

// ========== ON-DEMAND TEAM ENRICHMENT (Phase 1) ==========
//
// Returns a settled PlayerEnrichment object for one player:
//   { status: "ready" | "stale" | "failed", team, fetchedAt, error, attempts }
// ("queued"/"loading"/"not_requested" describe an in-flight request from the
// FRONTEND's point of view -- this endpoint itself always awaits a result
// before responding, so it never returns those three.)
//
// ?priority=low marks a call as background/prefetch work (e.g. warming the
// next page while the user is still looking at the current one), so it
// queues behind any concurrently in-flight "high" priority (visible-page)
// requests sharing the BATTLELOG_FETCH_CONCURRENCY budget. Defaults to "high".
router.get("/api/leaderboard/team/:userID", async (request, response) => {
  try {
    const userID = String(request.params.userID || "").trim();
    if (!userID) {
      return response.status(400).json({ error: "userID is required." });
    }
    const priority = request.query.priority === "low" ? "low" : "high";

    const enrichment = await getOrFetchPlayerEnrichment(userID, priority);
    response.json(enrichment);
  } catch (error) {
    console.error("[/api/leaderboard/team] Error:", error.message);
    response.status(500).json({ error: "Failed to fetch player team." });
  }
});

// LEGACY -- kept exactly as-is so the current frontend keeps working
// unmodified. This does synchronous full enrichment (rank data + team data
// for every player in one blocking response), which is the eager-enrichment
// approach Phase 1 is moving away from. Phase 3 will cut main.js over to
// /api/leaderboard/pool + /api/leaderboard/team/:userID above and this
// route (plus fetchAndEnrichLeaderboard, its page cache, and its background
// refresh scheduling) can be retired.
//
// LIVE MODE (updated 2026-08-19 -- see leaderboardEnrichment.js's live-mode
// branch for the authoritative logic): ?liveMode=true always bypasses the
// PAGE cache below, and lastRankedBattleTime always comes from a fresh
// fetch this cycle. It does NOT bypass everything, though -- profile/address
// resolution and team COMPOSITION are still served from their own long-TTL
// caches (profileCache, teamCompositionCache) even in live mode, since
// live mode's freshness requirement is specifically about the battle
// timestamp, not identity or roster data. See leaderboardEnrichment.js for
// the full rationale.
router.get("/api/leaderboard", async (request, response) => {
  try {
    // The upstream season-leaderboards endpoint caps a single request at 100 rows,
    // but the app is allowed to request larger page sizes by merging multiple
    // upstream pages behind the scenes. Keep the client-facing limit as-is while
    // honoring the requested page size across the merged results.
    const limit = Math.max(1, Number(request.query.limit) || 20);
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const eraMilestone = resolveEraMilestone(request);
    const liveMode = (request.query.liveMode || "false").toLowerCase() === "true";

    const cacheKey = `leaderboard_${eraMilestone}_${limit}_${offset}`;

    // LIVE MODE: skip the PAGE cache and go straight to fetchAndEnrichLeaderboard.
    // NOTE: this does not mean every underlying data source is refetched --
    // see the comment above this route and leaderboardEnrichment.js for what
    // actually stays cached (profile, team composition) vs. what's always
    // fresh (lastRankedBattleTime) inside that call.
    if (liveMode) {
      if (DEBUG_ON) console.log(`[/api/leaderboard] LIVE MODE: bypassing page cache for ${cacheKey}`);
      const payload = await fetchAndEnrichLeaderboard(limit, offset, eraMilestone, true);
      // Still populate cache for background use, but don't serve from it in live mode
      setCachedPage(cacheKey, payload);
      return response.json(payload);
    }

    // Normal mode: Serve cached page if available (stale-while-revalidate)
    const cached = getCachedPage(cacheKey);
    if (cached) {
      // schedule background refresh and return cached payload immediately
      schedulePageRefresh(cacheKey, limit, offset, eraMilestone);
      return response.json(cached);
    }

    // No cached page: fetch and enrich synchronously
    const payload = await fetchAndEnrichLeaderboard(limit, offset, eraMilestone);
    setCachedPage(cacheKey, payload);
    return response.json(payload);
  } catch (error) {
    console.error("[/api/leaderboard] Error:", error.message);
    response.status(500).json({
      error: "Failed to fetch enriched leaderboard"
    });
  }
});

export default router;
