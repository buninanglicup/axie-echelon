# Leaderboard Pagination & Live-Filter Fix — Shared Understanding

Status: Current engineering roadmap. This document records the diagnosis,
settled decisions, shipped implementation, and remaining work.

## Review note (2026-09-11)

This revision supersedes the "250-player preload" scope from the previous draft.
Confirmed decision: the candidate pool ceiling is **1000 players**, matching what
comparable leaderboard tools support and what `LEADERBOARD_MAX_RANK` already
declared on the frontend (`src/leaderboard/leaderboardState.js`) before this
revision — the backend copy of that same-named constant was still hardcoded to
`35` in `src/server/leaderboard/leaderboardConstants.js`, a stale
development/testing value. This revision also resolves several open questions
from that draft (page-size ambiguity, filter composition, fetch strategy) that
were previously either unclear or marked "double check."

The original pagination proposal has been implemented for non-live browsing.
The remaining deferred work is live-mode migration, scan resumability, and
follow-up polish.

## Current implementation status

- Phase 1 backend split: complete.
- Phase 1 frontend split: complete; the former large view module now delegates
  rendering, filtering, and rune filtering to focused modules.
- Shared leaderboard constants and rank ceiling: complete.
- Tracker retirement and unified single-process startup: complete.
- Frontend pool/team pagination pipeline: complete for non-live browsing;
  live mode intentionally remains on the legacy eager route.

Current frontend module boundaries:

- `leaderboardView.js`: coordinator, initialization, hydration, and live-mode wiring.
- `leaderboardRenderer.js`: leaderboard rows, team previews, and relative-time refresh.
- `leaderboardFilters.js`: rank and activity predicates.
- `leaderboardRuneFilter.js`: rune catalog, suggestions, scan results, and reset behavior.

### Body-part filtering status

Body-part mapping, local predicate, scanner, asynchronous job, HTTP route, and
leaderboard UI integration are implemented. Remaining work is continued
coverage review for newly encountered variants and starter records. The agreed
direction remains local gene decoding from
battle-log fighter data, followed by canonical variant matching (`Yen` matches
base part `Sleepless`, for example). The existing GraphQL Axie detail `parts`
response is a verification/fallback path only; per-Axie detail requests must
not be added to a top-1000 scan without a separate rate-limit design. The cards
catalog is a separate battle-card reference, not a confirmed body-part mapping.
See `docs/engineering/body-part-filtering.md`.

## Rank ceiling decision

`LEADERBOARD_MAX_RANK` is declared in the frontend and backend and is now
aligned at 1000:

- Frontend (`leaderboardState.js`): `1000`.
- Backend (`leaderboardConstants.js`): `1000`.

The candidate-fetch machinery uses this product ceiling and makes no additional
per-rank-window request.

The pool and scan paths now share the same scope-aware candidate chunks rather
than maintaining separate overlapping pools.

## Sky Mavis endpoint clarification **[NEW]**

Two upstream endpoints exist and are easy to confuse:

| Endpoint | Query params | Scope | Used by this app |
|---|---|---|---|
| `GET /origins/v2/season-leaderboards` | `limit`, `offset`, `milestone` | Era-scoped ("current leaderboard players by Era") | **Yes** — this is what `fetchRankCandidates()` calls today, and what the pool/rune/legacy routes all rely on. |
| `GET /origins/v2/leaderboards` | `limit`, `offset` (no milestone) | Includes offseason (the gap between one era ending and the next starting) | Yes — automatic current offseason view. |

**Decision:** active-era and historical tab views use `season-leaderboards`,
while automatic offseason uses `leaderboards`. Scope-aware cache keys keep the
two endpoint populations separate.

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
  and a second cache-key shape alongside the existing scope-aware chunks
  alongside the existing full-pool one — real added complexity.
- It doesn't actually save calls in aggregate: the full-pool cache is shared
  through scope-aware candidate chunks. The first request of any kind (rank
  browse, name search, rune filter, or body-part filter) pays the cold-fetch
  cost for the chunks it needs; later requests for the same scope and chunks
  can reuse them during the TTL window. Windowed per-range fetches would not
  share those entries, so a session that starts with rank browsing and then
  applies a scan filter could pay for both paths.

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

## Implemented pagination behavior

- Add a sticky pagination bar below the leaderboard table, using the existing
  `.pagination-bar` / `renderPagination()` visual pattern in `main.js`.
- Use a separate DOM instance because the current pagination element belongs
  to the Morph Viewer results section.
- **Page-size distinction:**
  There are two distinct, previously-conflated concepts that happen to share
  the value `50`:
  - `MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE` (`leaderboardState.js`) — the
    **client-side page size**: how many rows of the locally-cached pool are
    shown per page. This is the constant used by the current pager.
  - `GET_SEASON_LEADERBOARD_API_LIMIT` (`leaderboardState.js`) — the
    **legacy route's per-request size**, used only by the old eager
    `/api/leaderboard?limit=&offset=` path that this pagination work bypasses
    entirely. It remains separate from client-side paging.
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

The backend retains an on-demand enrichment status model for pool/team work.
Visible non-live rows use progressive team requests, while live mode continues
to use the eager legacy route until Phase 6 migration is designed and tested.

## Implementation progress

### Phase 1 — Backend: candidate pool and enrichment foundation ✅ DONE

*(unchanged — see prior implementation notes)*

### Phase 2 — Live-tracking initial-enable fix ✅ DONE

*(unchanged)*

### Phase 3 — Frontend candidate pool and client-side pagination ✅ DONE

Phase 3 moved non-live browsing to the full candidate pool. The completed
steps were:

- **3a — Backend constant and response documentation fixes:** raise
  `LEADERBOARD_MAX_RANK` to 1000, use the settled candidate-cache TTL, and mark
  unavailable pool metrics as not yet implemented.
- **3b — Full-pool loading:** request `rankMax=1000` once per scope/load and
  protect against duplicate in-flight requests.
- **3c — Client-side filtering:** apply rank range and player-name substring
  as one combined predicate over the loaded pool. Live mode remains on its
  existing `leaderboardData` path.
- **3d — Pagination UI:** use `getPageItems()` and
  `MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE`, with page reset on filter changes.
- **3e — Rune/body-part narrowing:** apply cheap rank/name filters first, then
  enrich or scan only the surviving candidates and keep the intersection.
  Multiple runes and body parts use OR semantics within each group; rune and
  body-part groups combine with AND semantics.

Current progress: **3a complete; 3b complete; 3c complete; 3d complete;
3e rune/body-part narrowing complete.**
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

### Phase 4 — Progressive enrichment and status-driven rendering ✅ DONE

Visible non-live rows request team data progressively after cheap pool
filtering. Enrichment status and unavailable team states are rendered without
blocking the initial candidate list.

### Phase 5 — Prefetch behavior

No separate prefetch phase is currently required; visible-page enrichment and
candidate-chunk caching provide the current loading strategy.

### Phase 6 — Live-mode integration

*(unchanged — deferred, see "Live mode: explicitly out of scope" above)*

### Phase 7 — Polish

Ongoing UI polish includes optional display-preference persistence, browser
coverage, and bundle-size work tracked in `docs/STATUS.md`.

### Display preference persistence

The leaderboard's Standard/Compact density toggle is currently held in
frontend state only. A full page reload restores Standard mode because the
preference is not written to `localStorage` or `sessionStorage`. This is a
small UI-polish opportunity rather than a data or workflow limitation; if it
is addressed, `localStorage` is the appropriate scope because the preference
is display-level and should survive browser sessions.

## Open questions

- Real data source for `winRate` / `dailyChange` / `recentForm` — not
  investigated. Deferred.
- Whether to add resumability for terminal partial scans — deferred.
- Whether to migrate live mode from the legacy eager route to the pool/team
  pipeline while preserving fresh activity timestamps — deferred to Phase 6.

## Recommended next step

The non-live candidate-pool, filtering, pagination, and progressive enrichment
work is implemented, including automatic offseason and historical era scopes.
Remaining work is live-mode migration, scan resumability, browser coverage,
bundle-size reduction, and optional demo-mode preparation; see
`docs/STATUS.md` for the prioritized project roadmap.
