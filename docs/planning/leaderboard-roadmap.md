# Leaderboard Pagination & Live-Filter Fix — Shared Understanding

Status: Planning / implementation tracking. This document records the diagnosis,
settled decisions, implementation progress, and remaining work.

## Revision note (2026-09-03)

This revision supersedes the "250-player preload" scope from the previous draft.
Confirmed decision: the candidate pool ceiling is **1000 players**, matching what
comparable leaderboard tools support and what `LEADERBOARD_MAX_RANK` already
declared on the frontend (`src/leaderboard/leaderboardState.js`) before this
revision — the backend copy of that same-named constant was still hardcoded to
`35` in `src/server/leaderboard/leaderboardConstants.js`, a stale
development/testing value. This revision also resolves several open questions
from that draft (page-size ambiguity, filter composition, fetch strategy) that
were previously either unclear or marked "double check."

Everything in Sections 1–7 below is unchanged from the prior draft except where
marked **[UPDATED]** or **[NEW]**.

## Current implementation status

- Phase 1 backend split: complete.
- Phase 1 frontend split: complete; the former large view module now delegates
  rendering, filtering, and rune filtering to focused modules.
- Shared leaderboard constants and rank ceiling: **in progress — see "Rank
  ceiling fix" below.**
- Tracker retirement and unified single-process startup: complete.
- Frontend pool/team pagination pipeline: planned; the UI still uses the legacy
  eager leaderboard endpoint.

Current frontend module boundaries:

- `leaderboardView.js`: coordinator, initialization, hydration, and live-mode wiring.
- `leaderboardRenderer.js`: leaderboard rows, team previews, and relative-time refresh.
- `leaderboardFilters.js`: rank and activity predicates.
- `leaderboardRuneFilter.js`: rune catalog, suggestions, scan results, and reset behavior.

### Body-part filtering status

Body-part mapping, local predicate, scanner, asynchronous job, and HTTP route
integration are implemented. The remaining work is the leaderboard UI. The
agreed direction remains local gene decoding from
battle-log fighter data, followed by canonical variant matching (`Yen` matches
base part `Sleepless`, for example). The existing GraphQL Axie detail `parts`
response is a verification/fallback path only; per-Axie detail requests must
not be added to a top-1000 scan without a separate rate-limit design. The cards
catalog is a separate battle-card reference, not a confirmed body-part mapping.
See `docs/implementation/body-part-filtering.md`.

## Rank ceiling fix **[NEW]**

`LEADERBOARD_MAX_RANK` is declared in two places and had drifted apart:

- Frontend (`leaderboardState.js`): `1000` — correct, matches the product decision.
- Backend (`leaderboardConstants.js`): `35` — stale; this value is what actually
  clamps `/api/leaderboard/pool`'s `rankMax`, so the pool endpoint currently
  refuses to return anyone past rank 35 regardless of what the frontend asks for.

**Fix:** set the backend `LEADERBOARD_MAX_RANK` to `1000` to match the frontend.
No other code change is required for the candidate-fetch machinery — see "Why no
chunking/windowing changes are needed" below.

This also has a side benefit: `leaderboardRuneRoutes.js` already scans
`1..LEADERBOARD_MAX_RANK` for rune matches, using this same constant. Once both
the pool route and the rune scanner consistently request `maxRank = 1000`, they
land on the exact same `rankCandidateCache` entry (`${milestone}_1000`) instead
of populating separate, overlapping cache entries. This resolves the "pool cache
and rune-scan cache currently contain overlapping data rather than sharing one
entry" gap noted in an earlier draft — as a side effect of the ceiling fix, not
as separate work.

## Sky Mavis endpoint clarification **[NEW]**

Two upstream endpoints exist and are easy to confuse:

| Endpoint | Query params | Scope | Used by this app |
|---|---|---|---|
| `GET /origins/v2/season-leaderboards` | `limit`, `offset`, `milestone` | Era-scoped ("current leaderboard players by Era") | **Yes** — this is what `fetchRankCandidates()` calls today, and what the pool/rune/legacy routes all rely on. |
| `GET /origins/v2/leaderboards` | `limit`, `offset` (no milestone) | Includes offseason (the gap between one era ending and the next starting) | No — not called anywhere in this codebase. Would be a separate feature (an "all-time/current ladder including offseason" view), out of scope for this pagination fix. |

**Decision:** the top-1000 pool continues to use `season-leaderboards`, since it
matches the existing era-tab UI (`eraTabs`, `DEFAULT_ERA_MILESTONE`). Adding a
second, non-era-scoped leaderboard view using `leaderboards` is a distinct
future feature, not part of this work.

## Cheap-field payload shape, confirmed **[NEW]**

A real `season-leaderboards` response item looks like:

```json
{
  "userID": "1ec9eb7e-5322-6e60-a60c-e2d1e25a8497",
  "name": "AXP|Miztah TV",
  "rank": "Tiger",
  "tier": 4,
  "topRank": 1,
  "vstar": 1240,
  "avatar": "s5_top20k;nightmare",
  "_etag": "d853028040468f10e0ebd84fb6854673"
}
```

Confirmed fields available for free, in bulk, at pool-fetch time:
`topRank` (→ rank), `name`, `vstar` (→ MMR). Rank-range and name-substring
filtering can both be satisfied entirely from this payload — see "Filter
composition model" below.

**`winRate` / `dailyChange` / `recentForm` in `leaderboardPoolRoutes.js` are
dead fields.** They read `player.win_rate`, `player.daily_change`,
`player.recent_form` off this response, but those keys were never present
upstream — confirmed: this was never implemented, and has always rendered as
`null` / `"-"` / `[]`. Left in place with an explicit comment marking them as
unimplemented (see implementation section) rather than removed, since this is
a real feature on other leaderboard sites and worth adding later — it just
needs a real data source first (unclear whether that's a per-player call or
a different upstream field; not investigated yet).

## Why no chunking/windowing changes are needed **[UPDATED]**

`fetchRankCandidates(eraMilestone, maxRank)` already loops on `offset` in
`SEASON_LEADERBOARD_API_MAX_LIMIT` (100)-sized steps to build up to `maxRank`
candidates, merging results and stopping early if upstream runs dry. Raising
`maxRank` to 1000 means a cold cache miss does **10 sequential upstream calls**
instead of 3 — no code change needed in this function, only in the ceiling
constant that gets passed into it.

## Fetch strategy: single full-pool fetch, not per-filter windowed requests **[NEW]**

Two designs were considered for how the frontend requests candidate data.

**Rejected: windowed direct fetch for "rank filter only, no name/rune filter"
active.** The idea: if only a rank range is active, request exactly that
range from `season-leaderboards` directly (cheap — one upstream call per
50-player page) rather than pulling the full 1000-player pool. Rejected
because:

- It only helps the narrow case where *no* other filter is active. Real usage
  combines filters (rank range + name search + rune filter together), and the
  moment any name or rune filter is active, a windowed fetch can't work at
  all — a match could be anywhere in the range, so the full range has to be
  scanned regardless.
- It would require a second fetch function (windowed, arbitrary start offset)
  and a second cache-key shape (`pool_${milestone}_${rankMin}_${rankMax}`)
  alongside the existing full-pool one — real added complexity.
- It doesn't actually save calls in aggregate: the full-pool cache is keyed
  by **era only** (`${milestone}_1000`), so it's shared across every request
  for that era regardless of which filters triggered it. The first request of
  any kind (rank browse, name search, rune filter) pays the 10-call cost and
  populates the cache; every other request during that cache's TTL window,
  from any user, using any filter combination, is a free hit off the same
  cached pool. Windowed per-range fetches don't share cache entries with each
  other or with the full-pool cache, so a session that starts with plain rank
  browsing and then applies a rune filter would pay for both the windowed
  calls *and* the full-pool fetch — worse than just doing the full-pool fetch
  once, up front.

**Adopted: always fetch the full pool, `rankMax = 1000`, regardless of which
filters are active.** One fetch strategy, one cache key, one function
(`fetchRankCandidates`, unchanged). Filtering happens entirely client-side
against the cached pool. See "Filter composition model" below.

## Filter composition model **[NEW]**

All active filters apply together, not independently — confirmed use case:
rank range top 1–150, name contains "ABC", and rune = Regenerator should
narrow to the intersection of all three, not any one alone.

- **Rank range + name substring**: both are available directly on the cheap
  pool payload (`topRank`, `name`). Apply as one combined predicate pass over
  the full cached pool: `players.filter(p => p.rank >= rankMin && p.rank <=
  rankMax && p.name.includes(nameQuery))`.
- **Rune filter and body-part filter**: neither field exists on the cheap pool
  payload — both require each player's actual team/battle-log data, which is
  only available through per-player enrichment (`/api/leaderboard/team/:userID`)
  or the dedicated rune scanner. These compose with the cheap filters by
  **narrowing first, enriching second**: apply rank range + name substring
  against the pool to shrink the candidate set, then only enrich/scan the
  players that survive that narrowing, then keep only the ones whose enriched
  team matches the rune/body-part filter. This avoids enriching all 1000
  players just to check a rune that only matters for a filtered subset.

## Pagination requirements

- Add a sticky pagination bar below the leaderboard table, using the existing
  `.pagination-bar` / `renderPagination()` visual pattern in `main.js`.
- Use a separate DOM instance because the current pagination element belongs
  to the Morph Viewer results section.
- **[UPDATED — resolves prior "double check what page size means" note]**
  There are two distinct, previously-conflated concepts that happen to share
  the value `50`:
  - `MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE` (`leaderboardState.js`) — the
    **client-side page size**: how many rows of the locally-cached pool are
    shown per page. This is the constant Phase 3's pager should actually use.
    Currently declared but unused.
  - `GET_SEASON_LEADERBOARD_API_LIMIT` (`leaderboardState.js`) — the
    **legacy route's per-request size**, used only by the old eager
    `/api/leaderboard?limit=&offset=` path that this pagination work bypasses
    entirely. Unrelated to client-side paging once Phase 3 ships.
- When the displayed row count exceeds the page size, split it into pages
  using the existing `getPageItems(items, page, pageSize)` helper in
  `src/pagination.js` — already generic, already used elsewhere (Axie lookup),
  no changes needed.

### Worked examples **[UPDATED for 1000-player ceiling]**

- Case A — Live tracking OFF, rank range 1–1000 (no other filter): fetch the
  full pool once, 20 pages of 50.
- Case B — Live tracking OFF, rank range 25–120, name contains "ABC": fetch
  the full pool once (same cache entry as Case A if within TTL), filter to
  the rank range + name match client-side, paginate the filtered result.
- Case C — Live tracking ON, rank range 1–50, battle-ended-within 3m: **live
  mode is out of scope for this pass** — untouched, still uses the legacy
  route (see "Live mode: explicitly out of scope" below).

## Settled design decisions **[UPDATED]**

- Preload scope — **1000 players** (was 250), cheap fields only. No per-player
  battle-log fetch occurs during preload.
- Rank range is a client-side filter over the cached pool, not a re-fetch
  parameter — see "Fetch strategy" above.
- Live mode is single-page and **explicitly out of scope for this
  implementation pass** — see below.
- Progressive enrichment, not eager enrichment. Cheap fields load for the
  whole candidate pool. Team/battle-log enrichment is requested only for
  players that survive cheap filtering and are on the visible page, rendered
  progressively.
- Reset to page 1 when filters change. Rank range, name search, and rune
  filter changes reset pagination.
- Keep the implementation local and single-process for now. BullMQ,
  distributed queues, SSE/WebSockets, and distributed locks are intentionally
  deferred.

## Live mode: explicitly out of scope for this pass **[NEW]**

Confirmed: live mode does not use different cache *settings* than non-live
mode — all TTL constants are shared globally. What differs is a behavioral
branch in `leaderboardLegacyRoutes.js`: live mode bypasses the page-cache
*read* (always fetches fresh) but still *writes* its result into the same
`pageCache` map non-live mode reads from. This pagination work uses an
entirely separate code path (`/api/leaderboard/pool`, `rankCandidateCache`,
`enrichmentCache`) that never touches `pageCache` or the `liveMode` branch —
so it can be implemented and shipped without any risk to live mode's current
behavior. Live-mode integration (Phase 6 below) remains a distinct, later
piece of work.

## Per-player enrichment status model

*(unchanged from prior draft — see implementation for the `EnrichmentStatus`
type and legal transitions)*

## Implementation progress

### Phase 1 — Backend: candidate pool and enrichment foundation ✅ DONE

*(unchanged — see prior implementation notes)*

### Phase 2 — Live-tracking initial-enable fix ✅ DONE

*(unchanged)*

### Phase 3 — Frontend candidate pool and client-side pagination **[UPDATED]**

Phase 3 is the implementation phase for moving non-live browsing to the full
candidate pool. It is broken into the following steps so each change can be
validated and committed independently:

- **3a — Backend constant and response documentation fixes:** raise
  `LEADERBOARD_MAX_RANK` to 1000, use the settled candidate-cache TTL, and mark
  unavailable pool metrics as not yet implemented.
- **3b — Full-pool loading:** request `rankMax=1000` once per era/load, protect
  against duplicate in-flight requests, and keep the pool fetch separate from
  legacy rendering until the consumer path is ready.
- **3c — Client-side filtering:** apply rank range and player-name substring
  as one combined predicate over the loaded pool. Live mode remains on its
  existing `leaderboardData` path.
- **3d — Pagination UI:** use `getPageItems()` and
  `MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE`, with page reset on filter changes.
- **3e — Rune narrowing:** apply cheap rank/name filters first, then enrich
  or scan only the surviving candidates and keep the intersection. Body-part
  filtering remains a separate future feature because no body-part catalog,
  route, or predicate exists yet.

Current progress: **3a complete; 3b complete; 3c complete; 3d complete;
3e rune narrowing complete.**
The non-live table now consumes the loaded pool for rank/name filtering and
pagination. Rune selection narrows rank/name candidates before team
enrichment, rescans are debounced when those cheap filters change, and the
selected rune results are paginated client-side. Non-live visible rows also
progressively request team data so the existing morph renderer can populate
the three Axie previews. The gene fallback and starter name-only behavior are
leaderboard-preview behavior only; the separate Morph Viewer is unaffected.
The rune selector supports multiple selected runes as removable chips; the
selected IDs are scanned together with OR semantics, while typing remains
catalog search only. Removing one chip reruns the composed leaderboard filter.
Manual verification confirms the rune path works for top-30 and top-100 scans,
including multiple selected runes. Top-1000 scans currently hit upstream Sky
Mavis HTTP 429 rate limits during the ten-request candidate-pool fetch. The
current product ceiling remains 1000; retry/backoff and resilient
candidate-chunk caching are now implemented. Candidate data is cached in
canonical 100-row chunks keyed by era and offset, allowing top-30, top-100,
and top-1000 requests to reuse the same upstream responses. Transient 429,
500, 502, and 503 responses use bounded retry/backoff with Retry-After
support; unrecoverable candidate-pool failures return HTTP 503 from the pool
route. Remaining verification also includes morph completeness for real
ranked-battle payloads and live upstream behavior after a backend restart.

### Phase 4 — Progressive enrichment and status-driven rendering

*(unchanged, narrowing behavior updated per "Filter composition model" above)*

### Phase 5 — Prefetch behavior

*(unchanged)*

### Phase 6 — Live-mode integration

*(unchanged — deferred, see "Live mode: explicitly out of scope" above)*

### Phase 7 — Polish

*(unchanged)*

## Open questions **[NEW]**

- An earlier draft plan apparently described a simpler workflow for a
  rank-filter-only case (a direct windowed backend request rather than a
  full-pool fetch). That draft (`leaderboard-pagination-plan-2.md`) no longer
  exists in the repository and predates a local Git history loss recorded in
  `docs/history/recovery-review.md`, so its exact reasoning couldn't be
  recovered. The "windowed fetch" idea was independently re-considered and
  explicitly rejected in this revision (see "Fetch strategy" above) based on
  current usage patterns and cache-sharing behavior — noted here so this
  isn't mistaken for the original (unrecoverable) plan.
- Real data source for `winRate` / `dailyChange` / `recentForm` — not
  investigated. Deferred.
- Whether to eventually add a second, non-era-scoped leaderboard view backed
  by `/origins/v2/leaderboards` (includes offseason) — deferred, separate
  feature.

## Recommended next step

Implement Phase 3 as scoped above. Live mode, enrichment status polish
(Phases 4–7), and the two open feature ideas noted above remain separate,
later work.
