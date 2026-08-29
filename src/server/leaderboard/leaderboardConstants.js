// Upstream Skymavis hard limit. Requests above this value fail.
export const SEASON_LEADERBOARD_API_MAX_LIMIT = 100;
// Product decision: deepest rank the app will ever inspect.
export const LEADERBOARD_MAX_RANK = 35;
export const BATTLE_LOGS_MIN_LIMIT = 1;
export const BATTLE_LOGS_MAX_LIMIT = 20;
export const RANK_CANDIDATE_CACHE_TTL_MS = Number(process.env.RANK_CANDIDATE_CACHE_TTL_MS || 30000);
export const TEAM_CACHE_TTL_MS = Number(process.env.TEAM_CACHE_TTL_MS || 600000);
export const TEAM_COMPOSITION_CACHE_TTL_MS = Number(process.env.TEAM_COMPOSITION_CACHE_TTL_MS || 900000);
export const TEAM_CACHE_REFRESH_THRESHOLD = Number(process.env.TEAM_CACHE_REFRESH_THRESHOLD || 0.5);
export const LEADERBOARD_PAGE_CACHE_TTL_MS = Number(process.env.LEADERBOARD_PAGE_CACHE_TTL_MS || 30000);
export const CACHE_SWEEP_INTERVAL_MS = Number(process.env.CACHE_SWEEP_INTERVAL_MS || 60000);