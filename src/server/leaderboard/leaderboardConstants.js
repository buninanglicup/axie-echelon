// Upstream Skymavis hard limit. Requests above this value fail.
export const SEASON_LEADERBOARD_API_MAX_LIMIT = 100;
// Product decision: deepest rank the app will ever inspect.
export const LEADERBOARD_MAX_RANK = 1000;
export const BATTLE_LOGS_MIN_LIMIT = 1;
export const BATTLE_LOGS_MAX_LIMIT = 20;
export const RANK_CANDIDATE_CACHE_TTL_MS = Number(process.env.RANK_CANDIDATE_CACHE_TTL_MS || 30000);
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