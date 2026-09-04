// Upstream Skymavis hard limit. Requests above this value fail.
export const SEASON_LEADERBOARD_API_MAX_LIMIT = 100;
// Product decision: deepest rank the app will ever inspect. Must match the
// frontend copy of this same constant in src/leaderboard/leaderboardState.js
// -- see docs/planning/leaderboard-roadmap.md, "Rank ceiling fix", for why
// these two are declared separately and how they drifted apart before.
export const LEADERBOARD_MAX_RANK = 1000;

// Documented Skymavis battle-logs `limit` range: min 5, max 100
export const BATTLE_LOGS_MIN_LIMIT = 5;
export const BATTLE_LOGS_MAX_LIMIT = 100;

// Self-imposed safety cap on /api/leaderboard's `limit` query param -- not a
// reflection of any real upstream constraint, just a guard against an
// unbounded enrichment fan-out. Also previously present, also lost in the
// same recovery (docs/history/track-a-summary.txt).
export const MAX_LEADERBOARD_REQUEST_SIZE = 100; // not sure what to do with this one yet, but it was in the old codebase and I don't want to lose it. maybe needs to be deleted

// 3 min default. Longer than the other leaderboard TTLs deliberately: this
// cache is never read by live mode (see cache-and-polling-strategy.md,
// "Layer 4"), and rank order below the top handful of players doesn't shift
// meaningfully within a few minutes of non-live browsing. A longer TTL
// directly reduces how often a cache miss pays the 10-upstream-call cost of
// rebuilding a 1000-player pool.
export const RANK_CANDIDATE_CACHE_TTL_MS = Number(process.env.RANK_CANDIDATE_CACHE_TTL_MS || 180000);
export const TEAM_CACHE_TTL_MS = Number(process.env.TEAM_CACHE_TTL_MS || 600000);
export const TEAM_COMPOSITION_CACHE_TTL_MS = Number(process.env.TEAM_COMPOSITION_CACHE_TTL_MS || 900000);
export const TEAM_CACHE_REFRESH_THRESHOLD = Number(process.env.TEAM_CACHE_REFRESH_THRESHOLD || 0.5);
export const LEADERBOARD_PAGE_CACHE_TTL_MS = Number(process.env.LEADERBOARD_PAGE_CACHE_TTL_MS || 30000);
export const CACHE_SWEEP_INTERVAL_MS = Number(process.env.CACHE_SWEEP_INTERVAL_MS || 60000);

// Below this, a ranked battle is treated as a surrender/early-exit and
// excluded from both the global average match duration AND per-player
// pause calculations (see computeGlobalAvgMatchDurationMs() below and
// computeAvgPauseMs() in shared/formatting.js).
export const MIN_VALID_MATCH_DURATION_MS = 60_000;

// Static TTL for the cached global average match duration (see
// computeGlobalAvgMatchDurationMs() in leaderboardEnrichment.js). Not
// derived from the user's configured polling interval (15-45s) --
// deliberately static for simplicity, since pollingIntervalMs x 2 would
// land in the 30-90s range anyway and this value doesn't need to be
// precise. See leaderboardState.js's staleness threshold for where the
// frontend's actual polling interval IS used dynamically.
export const AVG_MATCH_DURATION_CACHE_TTL_MS = 60_000;

export const RUNE_SCAN_ENRICHMENT_BATCH_SIZE = Number(process.env.RUNE_SCAN_ENRICHMENT_BATCH_SIZE || 100);
export const RUNE_SCAN_BATCH_PAUSE_MS = Number(process.env.RUNE_SCAN_BATCH_PAUSE_MS || 250);