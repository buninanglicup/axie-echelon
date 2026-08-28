// PHASE 1 FILE SPLIT (2026-08-19) -- state moved verbatim from the old
// main.js, no logic changes. See leaderboardState.js for why cross-cutting
// mutable state is grouped into one exported object rather than several
// exported `let`s (ES modules make imported bindings read-only).

export const AXIES_PER_PAGE = 30;

// Configurable external links (dead code carried over from the original
// file -- see the correction note in leaderboard/leaderboardState.js for
// PROFILE_BASE, which is the one of these three actually used anywhere,
// and belongs to the leaderboard feature instead).
export const MARKETPLACE_BASE = "https://app.axieinfinity.com/marketplace/axies";
export const BATTLE_LOG_BASE = "https://axie.top/profile"; // change this if you prefer another explorer

export const ALL_TAGS = [
  "Nightmare",
  "Shiny",
  "Summer",
  "Japan",
  "Xmas",
  "MEO",
  "Origin",
  "Agamogenesis"
];

export const axieLookupState = {
  mode: "id",
  currentPage: 1,
  currentResults: [],
  currentMode: "id",
  lastServerResponse: null,
  activeTags: new Set(),
  showOnlyCollectibles: true, // default per user request
  minEvolvedParts: 0 // UI present but slider disabled for now
};

// ===== Axie-lookup-only DOM refs (queried once at module load, same timing
// as the original file) =====
export const form = document.querySelector("#lookup-form");
export const input = document.querySelector("#lookup-input");
export const label = document.querySelector("#input-label");
export const status = document.querySelector("#status");
export const results = document.querySelector("#results");
export const pagination = document.createElement("nav");
pagination.className = "pagination";
pagination.setAttribute("aria-label", "Pagination");

// Filter panel elements (may be null until DOM ready)
export const filterButton = document.querySelector("#filter-button");
export const clearButton = document.querySelector("#clear-button");
export const filterPanel = document.querySelector("#filter-panel");
export const collectibleFilters = document.querySelector("#collectible-filters");
export const evolvedRange = document.querySelector("#evolved-range");
export const evolvedValue = document.querySelector("#evolved-value");
export const filterApply = document.querySelector("#filter-apply");
export const filterReset = document.querySelector("#filter-reset");
export const filterClose = document.querySelector("#filter-close");
export const showOnlyCollectiblesInput = document.querySelector("#show-only-collectibles");
