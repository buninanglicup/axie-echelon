// PHASE 1 FILE SPLIT (2026-08-19) -- state moved verbatim from the old
// main.js, no logic changes.
//
// WHY ONE MUTABLE OBJECT INSTEAD OF SEPARATE EXPORTED `let`s:
// ES modules make an imported binding read-only in the importing file --
// `import { rankMin } from './leaderboardState.js'; rankMin = 5;` throws.
// Properties of an imported OBJECT are not read-only, though, so bundling
// all of this feature's cross-cutting mutable state into one exported
// object (`leaderboardState`) lets leaderboardView.js freely read AND write
// `leaderboardState.rankMin = 5` from anywhere that needs to. This preserves
// the original file's behavior (many functions reading and reassigning the
// same variables) without introducing getter/setter boilerplate for a
// pure structural move.

// ===== Constants =====
export const DEFAULT_ERA_MILESTONE = "4"; // Final Era; sent to Sky Mavis as `milestone=4`
export const DEFAULT_BATTLE_WINDOW_MINUTES = 5; // "Battle ended within" default -- also what re-enabling live mode falls back to
export const LEADERBOARD_STORAGE_TTL_MS = 30 * 1000; // 30 seconds -- kept short to catch battle time updates within polling interval
export const GET_SEASON_LEADERBOARD_API_LIMIT = Number(import.meta.env.VITE_LEADERBOARD_LIMIT || 50); // default page size for leaderboard
export const GET_SEASON_LEADERBOARD_API_OFFSET = Number(import.meta.env.VITE_LEADERBOARD_OFFSET || 0); // set to 50 for ranks 51-100, 100 for 101-150, etc.

// Product decisions shared with the backend constants module. The upstream
// request cap remains backend-only because the frontend calls our API.
export const MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE = 50;
export const LEADERBOARD_MAX_RANK = 35;
export const POLLING_INTERVAL_SECONDS = Number(import.meta.env.VITE_POLLING_INTERVAL || 30); // polling cadence in seconds

// Idle-time threshold used to keep the next-ranked-activity estimate
// (see predictNextActivity() in shared/formatting.js) scoped to a single
// play session. 20 minutes is chosen to detect "player took a real break"
// mid-grind, NOT "same day vs. different day" -- a much shorter signal
// than a daily-activity cutoff would give. Prevents stale, unrelated
// battles from polluting the current-session pause average.
export const RANKED_SESSION_GAP_THRESHOLD_MS = 20 * 60 * 1000;

// Mirrors MIN_VALID_MATCH_DURATION_MS in the backend's
// leaderboardConstants.js. Duplicated here (not imported) because this is
// browser code and that file is server-only (reads process.env). Keep
// these two values in sync manually if either changes.
export const MIN_VALID_MATCH_DURATION_MS = 60_000;

// Default expected match duration when the global average is not yet available.
// Used in the prediction state machine to avoid marking games as "overdue"
// immediately when duration data is missing. A reasonable estimate based on
// typical Axie Infinity ranked match duration.
export const DEFAULT_MATCH_DURATION_MS = 5 * 60 * 1000;

// With user-configurable polling (15-45s via pollingIntervalSeconds),
// this multiplier scales the staleness check proportionally: fast polling
// (15s) has a tighter staleness window (37.5s), slow polling (45s) is more
// tolerant (112.5s). A single missed tick can trigger staleness on fast
// polling; slow polling usually needs multiple misses. This asymmetry is
// intentional -- see leaderboardView.js's use of lastSuccessfulPollAt.
export const POLLING_STALE_MULTIPLIER = 2.5;

// CORRECTION (2026-08-19, during the file split): this constant was
// originally declared alongside MARKETPLACE_BASE/BATTLE_LOG_BASE near the
// top of the old monolithic main.js, which reads as "these three are a
// group" -- but PROFILE_BASE is the only one of the three actually used
// anywhere in the codebase, and its one call site is in
// renderLeaderboardRows() (leaderboard feature), not the axie-lookup
// feature. MARKETPLACE_BASE and BATTLE_LOG_BASE are dead code in the
// original file (addAxieCard hardcodes the equivalent URLs as literals
// instead of referencing them) -- see axieLookup/axieLookupState.js, where
// they're kept, unused, for parity with the original file's (dead) code.
export const PROFILE_BASE = "https://app.axieinfinity.com/profile";

export const battleWindowPresets = [
  { index: 0, label: "0s", minutes: 0 },
  { index: 1, label: "1m", minutes: 1 },
  { index: 2, label: "2m", minutes: 2 },
  { index: 3, label: "3m", minutes: 3 },
  { index: 4, label: "4m", minutes: 4 },
  { index: 5, label: "5m", minutes: 5 },
  { index: 6, label: "10m", minutes: 10 },
  { index: 7, label: "15m", minutes: 15 },
  { index: 8, label: "20m", minutes: 20 }
];

export function getBattleWindowPreset(value) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    const exactMinuteMatch = battleWindowPresets.find((preset) => preset.minutes === numericValue);
    if (exactMinuteMatch) return exactMinuteMatch;

    const index = Math.min(Math.max(Math.round(numericValue), 0), battleWindowPresets.length - 1);
    return battleWindowPresets[index] ?? battleWindowPresets[5];
  }

  return battleWindowPresets[5];
}

export function getLeaderboardStorageKey(limit, offset, milestone) {
  return `leaderboard_cache_${milestone}_${limit}_${offset}`;
}

// ===== Mutable state (see file-level comment on why this is one object) =====
export const leaderboardState = {
  leaderboardData: [],
  currentEraMilestone: DEFAULT_ERA_MILESTONE,
  activeBattleWindowMinutes: null,
  rankMin: null,
  rankMax: null,
  liveModeEnabled: false,
  pollingIntervalSeconds: POLLING_INTERVAL_SECONDS, // initialized from env variable
  leaderboardPollTimer: null,
  compactModeEnabled: false,
  lastSuccessfulPollAt: null, // Tracks live-mode poll health; compare to pollingIntervalSeconds * 2.5 to determine if the estimate should mute to Unknown.
  avgMatchDurationMs: null, // Latest median match duration from the backend; used by predictNextActivity() to estimate whether the player is likely still in a match.

  // Rune filter state (declared here, not near the rest of the rune filter
  // code, because updateLiveModeControls() runs synchronously during init
  // and calls renderFilteredLeaderboard(), which reads runeFilterActive --
  // it must already be initialized by then, same ordering constraint as the
  // original file).
  runeCatalog: [],
  runeCatalogLoaded: false,
  activeRuneId: null,
  runeFilterActive: false
};

// Live-mode only: retain the last successful battle timestamp per player and
// era so a transient fetch failure does not remove an otherwise active row.
// This cache affects filter eligibility only; rendered subtitles still use
// the raw timestamp from the current poll response.
export const lastKnownGoodBattleTime = new Map();

export function battleTimeCacheKey(eraMilestone, userID) {
  return `${eraMilestone}:${userID}`;
}

// ===== Leaderboard-only DOM refs (queried once at module load, same timing
// as the original file) =====
export const lastBattleFilter = document.querySelector("#recent-activity-filter");
export const lastBattleValue = document.querySelector("#recent-activity-value");
export const playerNameSearch = document.querySelector("#player-name-search");
export const playerNameClear = document.querySelector(".search-input-with-clear .icon-button");
export const rankMinInput = document.querySelector("#rank-min");
export const rankMaxInput = document.querySelector("#rank-max");
export const rankFilterValue = document.querySelector("#rank-filter-value");
export const rankTopNButton = document.querySelector("#rank-top-n-button");
export const resetFiltersButton = document.querySelector("#reset-filters");
export const activeFilters = document.querySelector("#active-filters");
export const leaderboardCount = document.querySelector("#leaderboard-count");
export const liveModeToggle = document.querySelector("#live-mode");
export const pollingControls = document.querySelector("#polling-controls");
export const pollingIntervalSelect = document.querySelector("#polling-interval");
export const liveOnlyControls = document.querySelector("#live-only-controls");
export const rankMinError = document.querySelector("#rank-min-error");
export const rankMaxError = document.querySelector("#rank-max-error");
export const seasonSelector = document.querySelector("#season-selector");
export const headerLastUpdated = document.querySelector("#header-last-updated");
export const eraTabs = document.querySelectorAll(".era-tab");
export const compactModeToggle = document.querySelector("#compact-mode-toggle");
export const standardModeToggle = document.querySelector("#standard-mode-toggle");
export const leaderboardTable = document.querySelector("#leaderboard-table");
export const runeSearchInput = document.querySelector("#rune-search-input");
export const runeSuggestions = document.querySelector("#rune-suggestions");
export const runeFilterStatus = document.querySelector("#rune-filter-status");
export const runeFilterClear = document.querySelector("#rune-filter-clear");
