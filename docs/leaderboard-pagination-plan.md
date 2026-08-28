Leaderboard Pagination & Live-Filter Fix — Shared Understanding
Status: Planning / implementation tracking. This document records the diagnosis, settled decisions, implementation progress, and remaining work.

Note: This version consolidates the first draft and the subsequent implementation updates. The change log in Section 1 explains what was added after the first draft.

1. What changed since the first draft
The first draft primarily documented the live-tracking bug, pagination requirements, settled design decisions, and the enrichment status model. This version retains those sections and adds the following updates:

Added implementation progress for the backend candidate-pool and enrichment foundation.

Recorded that fetchRankCandidates() is reused for the new pool endpoint rather than generalized into a separate helper.

Added the new GET /api/leaderboard/pool endpoint for cheap candidate data.

Added the new GET /api/leaderboard/team/:userID endpoint for on-demand single-player enrichment.

Documented the separate six-state enrichmentCache, including negative-result caching and its 30-second failure TTL.

Documented two-lane high/low priority handling for battle-log work.

Recorded local smoke-test validation for the backend routes and syntax checking.

Recorded that the live-tracking initial-enable bug was fixed in main.js, including restore-on-enable behavior for first enable and disable/re-enable flows.

Expanded the implementation plan into explicit frontend, prefetch, live-mode integration, and polish phases.

Clarified that the legacy /api/leaderboard and rune-scanner behavior remain untouched by the new backend additions.

Added known implementation gaps and intentionally deferred scale features, such as distributed queues, SSE/WebSockets, and distributed locks.

The original diagnosis and design decisions remain below. Items marked ✅ represent work recorded as completed in the later implementation update; unmarked items remain planned.

2. Live Tracking initial-enable bug — root cause found
Symptom: Turning "Live tracking" ON for the first time doesn't apply the "Battle ended within" filter. Nudging the slider to any other value and back to the default fixes it for the rest of the session.

Trace through main.js:

The lastBattleFilter init block runs first and sets the real default:

js
lastBattleFilter.value = "5";
activeBattleWindowMinutes = 5;
updateBattleWindowFromSlider();
A few lines later, updateLiveModeControls() is called unconditionally at startup, while liveModeEnabled is still false (its default value). Since it's false, the function's else branch runs:

js
activeBattleWindowMinutes = null;
if (lastBattleFilter) lastBattleFilter.value = "";
This wipes the "5m" default that was just set before the user has interacted with anything.

When the person flips "Live tracking" ON for the first time, the enabled branch starts polling but does not restore activeBattleWindowMinutes, which is still null.

applyLeaderboardActivityFilter() short-circuits when the active window is null, so every player is returned unfiltered on first enable.

Once the slider is touched, updateBattleWindowFromSlider() sets activeBattleWindowMinutes back to a real number and filtering works.

Resolution recorded in the later update: updateLiveModeControls() now restores DEFAULT_BATTLE_WINDOW_MINUTES when enabling live mode and the active window is null. This covers both first enable and disable→re-enable flows.

3. Pagination requirements
Add a sticky pagination bar below the leaderboard table, using the existing .pagination-bar / renderPagination() visual pattern in main.js.

Use a separate DOM instance because the current pagination element belongs to the Morph Viewer results section.

Use a page size of 50, matching GET_SEASON_LEADERBOARD_API_LIMIT . //double check what is page size mean here

When the displayed row count exceeds 50, split it into pages.

Worked examples
Case A — Live tracking OFF, rank range 1–50: 50 rows, one page, no pager.

Case B — Live tracking OFF, rank range 25–120: 96 candidate ranks, two pages of at most 50 rows.

Case C — Live tracking ON, rank range 1–50, battle-ended-within 3m: display players ranked 1–50 whose last ranked battle ended within three minutes; polling refreshes this set.

4. Settled design decisions
Preload scope — 250 players, cheap fields only. season-leaderboards caps limit at 100 per request, so 250 requires three calls using increasing offsets. No per-player battle-log fetch occurs during preload.

Rank range is the scan boundary. The candidate pool is limited to rankMin–rankMax, capped at 250. Non-live mode paginates over that local pool. Live mode applies the activity filter within the same rank range and does not silently scan deeper.

Live mode is single-page. Multi-page pagination applies only when live tracking is off.

Live-mode page size is 50, with 30 retained as a documented fallback if battle-log volume makes 50 noticeably slow in practice. This should be measured rather than assumed.

Progressive enrichment, not eager enrichment. Cheap fields load for the whole candidate pool. Team/battle-log enrichment is requested for the visible page and rendered progressively. Current-page requests receive priority over lower-priority prefetch requests.

Reset to page 1 when filters change. Rank range, live-mode state, and battle-window changes reset pagination.

Keep the implementation local and single-process for now. BullMQ, distributed queues, SSE/WebSockets, and distributed locks are intentionally deferred because the application is currently local-development/single-process software.

5. Per-player enrichment status model
ts
type EnrichmentStatus =
  | "not_requested"
  | "queued"
  | "loading"
  | "ready"
  | "stale"
  | "failed";

type PlayerEnrichment = {
  status: EnrichmentStatus;
  team?: TeamComposition;
  fetchedAt?: string;
  error?: string;
  retryAt?: string;
  attempts?: number;
};
Legal transitions:

text
not_requested → queued
queued        → loading
loading       → ready
loading       → failed
ready         → stale
stale         → loading   (preserve old team art)
stale         → ready
stale         → failed
failed        → queued
UI mapping is scoped per row:

not_requested / queued: neutral placeholder, no spinner.

loading: skeleton with stable image dimensions.

ready: render team art.

stale: preserve existing team art and refresh quietly.

failed: fallback text and a row-level retry action.

isLoading remains a derived convenience:

ts
const isLoading = status === "queued" || status === "loading";
Additional rate-limit, retry, and failure details belong in metadata rather than new top-level states.

6. Implementation progress
Phase 1 — Backend: candidate pool and enrichment foundation ✅ DONE
Shipped in server.js, additively. The legacy /api/leaderboard remains unchanged.

✅ Reused fetchRankCandidates() for the new pool endpoint. Known gap: the pool cache and rune-scan cache currently contain overlapping data rather than sharing one entry.

✅ Added GET /api/leaderboard/pool?rankMin=&rankMax=&milestone= for cheap fields: rank, name, MMR, win rate, daily change, and recent form. Results are capped at LEADERBOARD_POOL_MAX_RANK (250) and seeded with enrichment.status = "not_requested".

✅ Added GET /api/leaderboard/team/:userID?priority=high|low for on-demand single-player enrichment. The endpoint returns settled ready, stale, or failed states; frontend-only queued and loading states are not returned by this endpoint.

✅ Added a separate six-state enrichmentCache, including negative-result caching with FAILED_ENRICHMENT_CACHE_TTL_MS = 30s.

✅ Added high/low priority lanes to the battle-log concurrency semaphore. Visible-page work has priority over background refresh and prefetch work.

✅ Local smoke testing recorded: the server boots cleanly, pool, team/:userID, legacy leaderboard, and runes routes respond without crashing, and node --check passes.

Phase 2 — Live-tracking initial-enable fix ✅ DONE
updateLiveModeControls() was updated in main.js to restore DEFAULT_BATTLE_WINDOW_MINUTES when live mode is enabled and activeBattleWindowMinutes is null. This covers first enable and disable→re-enable.

Phase 3 — Frontend candidate pool and client-side pagination
Fetch the full candidate pool on load and filter changes, capped at 250.

Add a separate sticky leaderboard pagination bar and slice the local pool at 50 rows per page.

Reset the page to 1 when rank range, live mode, or battle-window filters change.

Phase 4 — Progressive enrichment and status-driven rendering
Request team enrichment for visible-page players and render according to the status model.

Add a page/filter staleness token so late responses from an old page cannot update the current page.

Add row-level retry handling for failed → queued.

Phase 5 — Prefetch behavior
After visible-page enrichment requests are mostly dispatched or settled, prefetch the next page using lower priority.

Phase 6 — Live-mode integration
Apply the selected rank range to the live candidate pool, keep the 250-player ceiling, and use a single page.

Hide or disable the pagination bar while live mode is enabled.

Phase 7 — Polish
Add stale indicators, stable skeleton dimensions, and verify that stale → loading → ready does not blank existing team art.

7. Recommended next step
Commit this consolidated version as the canonical planning document, then delete or archive the duplicate leaderboard-pagination-plan-2.md. Use future commits to update the implementation status rather than creating another numbered copy.