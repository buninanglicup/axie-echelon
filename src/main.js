// PHASE 1 FILE SPLIT (2026-08-19).
// This file used to be ~1740 lines containing leaderboard state/rendering/
// filters/live mode/rune filter AND the axie-lookup feature (ID/address
// search, pagination, collectible filters) all mixed together at module
// scope. It's now a thin entry point: the page-reload-detection debug
// scaffolding (unchanged, kept verbatim) plus wiring the two feature
// views. All business logic lives under src/leaderboard/, src/axieLookup/,
// and src/shared/ (code used by both features).
import { initLeaderboardView } from "./leaderboard/leaderboardView.js";
import { initAxieLookupView } from "./axieLookup/axieLookupView.js";

// ===== PAGE RELOAD DETECTION =====
// Track if this is a fresh page load (for debugging live mode resets)
const pageLoadTime = Date.now();
const isPageReload = sessionStorage.getItem("pageLoadTime") !== null;
sessionStorage.setItem("pageLoadTime", String(pageLoadTime));

if (isPageReload) {
  const lastLoadTime = Number(sessionStorage.getItem("pageLoadTime") || 0);
  const timeSinceLastLoad = pageLoadTime - lastLoadTime;
  console.warn(
    `[PAGE RELOAD DETECTED] Page reloaded. Previous load was ${timeSinceLastLoad}ms ago.`
  );
}

window.addEventListener("beforeunload", () => {
  console.warn("[UNLOAD EVENT] Page is about to unload/reload");
});

window.addEventListener("pagehide", () => {
  console.warn("[PAGEHIDE EVENT] Page visibility is being hidden (may be reload or navigation)");
});

// Log any fetch errors that might indicate backend connection issues
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).catch(error => {
    console.error("[FETCH ERROR]", args[0], error);
    throw error;
  });
};

// ===== END PAGE RELOAD DETECTION =====

initAxieLookupView();
initLeaderboardView();
