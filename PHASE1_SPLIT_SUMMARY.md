# Phase 1 Refactor: Live-Mode Caching Fix + Monolith Split

> Historical note: this document records the Phase 1 state from 2026-08-19.
> The tracker workaround has since been retired, the API and rank constants
> have been introduced, and the app now runs as one unified process.

**Date:** 2026-08-19
**Scope:** `server.js` and `main.js` (formerly ~1830 and ~1740 lines respectively)

This document explains what changed, why, how it was verified, and what's
still open. It's meant to be read alongside the diff, not instead of it.

---

## 1. Why this happened

Two problems drove this work:

1. **Live mode couldn't distinguish "cache this" from "never cache this."**
   The old code treated live mode as an all-or-nothing cache bypass â€”
   re-fetching a player's team, runes, *and* Ronin address on every single
   poll, when only `lastRankedBattleTime` actually needs to be fresh every
   cycle. This wasted API calls (worsening rate-limit pressure) and, on a
   failed fetch, caused the frontend to paper over gaps by silently reusing
   a stale timestamp â€” defeating the entire point of live mode.
2. **`server.js`/`main.js` had become genuinely two different features
   glued into one file each.** The leaderboard-tracking feature and the
   Axie-ID/Ronin-address lookup feature shared no real logic, but working
   on either required reading through the other's code. This made the
   codebase harder to review and was actively blocking the next round of
   planned work (pagination up to rank 1000 with proper filter support).

---

## 2. Change 1: Live-mode caching correctness

### What changed
- **New: `profileCache`** (`src/server/shared/profileCache.js`) â€” long-TTL
  (default 6h) cache for a player's resolved Ronin address / profile URL.
  Never bypassed by live mode, since address data has nothing to do with
  live mode's freshness requirement.
- **New: `teamCompositionCache`** (`src/server/leaderboard/leaderboardCaches.js`)
  â€” long-TTL (default 15 min) cache for a player's team composition
  (axie IDs, names, runes) *only*. Never stores a battle timestamp.
- **`lastRankedBattleTime` is now never cached in live mode.** It's read
  only from that poll cycle's fresh fetch. On a failed fetch it's returned
  as `null` â€” explicitly "unknown this cycle" â€” plus a new
  `battleTimeFetchFailed: true` flag, rather than being backfilled from a
  previous cycle's value.
- **`main.js`'s `oldTimestamps` backfill logic was removed.** It existed to
  mask the *old* backend's flickering (a failed fetch used to null out the
  whole team) and directly conflicted with the new honest-null guarantee â€”
  it would have silently made a stale timestamp look fresh again.
- **Sweep coverage added** for both new caches. They're otherwise only
  lazily evicted on next read, so a player who falls out of the tracked
  rank range would previously have sat in memory forever.

### Why this is safe for non-live-mode
Outside live mode, the activity filter (the only feature that cares about
timestamp freshness) is already disabled by design, so reusing a
slightly-old `lastRankedBattleTime` there was, and remains, fine â€” this
change only affects the live-mode code path.

### Known trade-off, not fixed here
The battle-log fetch itself (the expensive call) still happens once per
player per poll cycle in live mode â€” that part is not reducible without
losing the ability to detect a new battle. This change reduces *wasted*
calls (profile, and composition on a cache hit) and fixes *correctness*
(honest timestamps), not the irreducible core cost of live polling.

---

## 3. Change 2: File split

### Server (`server.js` â†’ 17 files)

| File | Contents |
|---|---|
| `server.js` | Express app setup, route mounting, process lifecycle only |
| `src/server/shared/env.js` | All env-derived config + shared dotenv loading |
| `src/server/shared/validators.js` | `cleanAxieId`, `cleanRoninAddress` |
| `src/server/shared/graphqlClient.js` | Low-level GraphQL request + all GraphQL-backed lookups |
| `src/server/shared/concurrency.js` | `mapWithConcurrency`, the global battle-log semaphore |
| `src/server/shared/profileCache.js` | The new long-TTL profile cache (see Change 1) |
| `src/server/axieService.js` | Axie-lookup business logic (resolve by ID, fighters, classifier) |
| `src/server/axieRoutes.js` | `/api/axie/:id`, `/api/axie-detail/:id`, `/api/address/:address` |
| `src/server/leaderboard/leaderboardConstants.js` | All sizing/TTL constants for the leaderboard feature |
| `src/server/leaderboard/runeCatalog.js` | Rune metadata lookup |
| `src/server/leaderboard/battleLogClient.js` | Retry/backoff wrapper + the only code that calls `/battle-logs` |
| `src/server/leaderboard/leaderboardCaches.js` | Team cache, team-composition cache, page cache, periodic sweep |
| `src/server/leaderboard/enrichmentCache.js` | Phase-1 `PlayerEnrichment` status-model cache (currently unused by frontend) |
| `src/server/leaderboard/leaderboardCandidates.js` | Raw candidate-pool fetcher (rank/name/mmr, no enrichment) |
| `src/server/leaderboard/leaderboardEnrichment.js` | `fetchAndEnrichLeaderboard` â€” the core per-player enrichment logic |
| `src/server/leaderboard/runeScanner.js` | Rune filter: scans full candidate window, then filters |
| `src/server/leaderboard/leaderboardRoutes.js` | All `/api/leaderboard*` and `/api/runes` routes |

### Frontend (`main.js` â†’ 7 files)

| File | Contents |
|---|---|
| `src/main.js` | Page-reload-detection debug scaffolding + wires up the two features |
| `src/leaderboard/leaderboardState.js` | Leaderboard's mutable state object, DOM refs, constants |
| `src/leaderboard/leaderboardView.js` | Leaderboard coordinator, hydration, initialization, and live-mode wiring |
| `src/leaderboard/leaderboardRenderer.js` | Leaderboard rows, team previews, and relative-time refresh |
| `src/leaderboard/leaderboardFilters.js` | Rank and activity filtering |
| `src/leaderboard/leaderboardRuneFilter.js` | Rune catalog, suggestions, scan results, and reset behavior |
| `src/axieLookup/axieLookupState.js` | Axie-lookup's mutable state object, DOM refs, constants |
| `src/axieLookup/axieLookupView.js` | Mode toggle, form submit, pagination (both client & server), card rendering |
| `src/shared/formatting.js` | `formatRelativeTime`, `escapeHtml` |
| `src/shared/morphRenderer.js` | PIXI morph-render queue + cache, used by both features |

### A design note on frontend state
ES modules make an **imported** `let`/`const` binding read-only to the
importer â€” `import { rankMin } from './x.js'; rankMin = 5;` throws at
runtime. The original file's many cross-function mutable variables
(`rankMin`, `liveModeEnabled`, `leaderboardData`, etc.) therefore couldn't
be split into individually-exported bindings without breaking mutation
from other files. Instead, each feature's cross-cutting state is grouped
into **one exported mutable object** (`leaderboardState`, `axieLookupState`)
â€” object *properties* are freely mutable from any importer, which preserves
the original behavior exactly.

### A bug caught and fixed during the split
`PROFILE_BASE` was initially placed into the axie-lookup state file by
name-association with the other two "external link" constants declared
next to it in the original file. On review, it turned out `PROFILE_BASE`
is only ever used by the *leaderboard's* row-rendering code â€” the other
two (`MARKETPLACE_BASE`, `BATTLE_LOG_BASE`) are dead code in the original
file (the URLs they'd build are hardcoded as literals elsewhere instead).
Fixed before finalizing: `PROFILE_BASE` now lives in
`src/leaderboard/leaderboardState.js`, correctly imported by
`leaderboardView.js`.

---

## 4. Verification performed

- **Syntax:** all 24 new files pass `node --check`.
- **Backend, end-to-end:** the full module graph was actually loaded with
  real `express`/`cors`/`dotenv` installed (a temporary `package.json` was
  used for this test only, not part of the deliverable) â€” confirmed the
  server starts and every import resolves correctly, not just that each
  file parses in isolation.
- **Frontend, end-to-end (added after external review â€” see à¸¢à¸‡5.1):** a real
  `vite build` was run against a minimal scaffold matching the project's
  actual `src/main.js` entry convention (with stub `renderer.js`/
  `pagination.js`, since those real files weren't available to test
  against). It builds cleanly with all 12 modules resolving. This
  superseded the earlier hand-checked-only verification, which had missed
  real path-depth bugs â€” see à¸¢à¸‡5.1.

## 5. Known risks / before you rely on this

### 5.1 Import-path bugs found by external review and fixed here

An external review (a second pass, treated as an independent validation
of this same deliverable) ran an actual `npm run build` against the first
version of this split and caught three real bugs that the original
hand-checked verification missed, because that verification only checked
that import *names* matched exports, not that the relative *paths*
resolved to the correct depth:

1. **`main.js` was placed at the project root**, but the actual project
   convention (confirmed by the failing build) is `src/main.js`. Its
   imports (`./src/leaderboard/...`) assumed the former location and broke
   once corrected against the latter. Fixed: `main.js` moved to
   `src/main.js`, imports changed to `./leaderboard/...` and
   `./axieLookup/...`.
2. **`axieLookupView.js`'s import of `pagination.js`** was off by one
   directory level (`../../pagination.js` instead of `../pagination.js`),
   based on the same root-vs-`src/` misunderstanding.
3. **`morphRenderer.js`'s import of `renderer.js`** had the same off-by-one
   error (`../../renderer.js` instead of `../renderer.js`).

All three are fixed in this version and verified with a real `vite build`
(see à¸¢à¸‡4). **Lesson for future splits of this kind:** hand-checking
import/export names is necessary but not sufficient â€” relative path depth
needs an actual bundler run to catch, since a wrong `../` count fails
silently under `node --check` (which doesn't resolve imports) and is easy
to miscount by eye across a large split.

### 5.2 Rendering gap found by the same review, fixed here

The row-rendering code (`renderLeaderboardRows` in `leaderboardView.js`)
only created the "last played" subtitle element when
`player.lastRankedBattleTime` was truthy â€” this conditional predates this
refactor (it was already in the original file), but the live-mode caching
change in this same commit (à¸¢à¸‡2) made it visible for the first time: a
failed live-mode fetch now honestly returns `lastRankedBattleTime: null`
instead of a silently-backfilled stale value, which means the subtitle
element was never created at all for that row on a failed poll â€” not the
"can't fetch last battle" message the rest of this document's Change 1
section claimed `formatRelativeTime()` already displayed. That claim was
only true if the element existed in the first place. **Fixed:** the
subtitle element is now always created; only its
`dataset.lastRankedBattleTime` attribute (read by the once-per-second
relative-time refresh) is conditional, so both the initial render and the
periodic refresh correctly fall through to "can't fetch last battle" on a
null timestamp.

### 5.3 Stale comments found by the same review, fixed here

Two comments in `leaderboardRoutes.js` still described live mode as a
blanket "always fetch everything fresh" bypass, predating the à¸¢à¸‡2 caching
split. Updated to describe the actual current behavior (page cache always
bypassed; profile and team-composition still served from their own
long-TTL caches; only the battle timestamp is guaranteed fresh). A related
stale doc-reference (a code comment in `leaderboardEnrichment.js` pointing
at a `leaderboardApi.js` file that was never created â€” the file's
responsibilities ended up folded into `leaderboardView.js` instead) was
also corrected.

### 5.4 Still open â€” not covered by the fixes above

1. **`geneDecoder.js`'s assumed location is still unverified.** Unlike
   `renderer.js`/`pagination.js` (now confirmed via a real `vite build` â€”
   see à¸¢à¸‡5.1) and `main.js` (now confirmed to belong at `src/main.js`),
   `geneDecoder.js` is a *backend*-side file imported by `axieService.js`,
   and its location was never independently confirmed the same way â€” the
   real backend-loading test in à¸¢à¸‡4 only proves that a *stub* file placed at
   the assumed path (`src/geneDecoder.js`, relative to the project root
   where `server.js` lives) satisfies the import; it doesn't prove the real
   file is actually there in your repo. Worth a quick check if `node
   server.js` fails to start with a "Cannot find module" error for it.
2. **A product decision remains open**, flagged by the same external
   review: when the live-mode activity-window filter is active and a
   player's battle-time fetch fails this cycle (`battleTimeFetchFailed:
   true`, timestamp `null`), `applyLeaderboardActivityFilter` currently
   excludes them from the filtered view entirely (their last known
   timestamp is unknown, so they can't be confirmed "within the window").
   That's a defensible behavior, but it was never explicitly decided one
   way or the other â€” the alternative would be to always show them
   (ignoring the filter) with a visible "timestamp unavailable" state
   instead of hiding them. Worth deciding deliberately before this ships,
   since it changes what the activity filter visibly does during a run of
   fetch failures. Not changed in this commit.
2. **`MAX_LEADERBOARD_SCAN_RANK` still exists in two places** â€” the
   backend's `leaderboardConstants.js` and the frontend's
   `leaderboardState.js` â€” with a comment flagging that they must be kept
   in sync manually until Phase 2 unifies the rank-ceiling constants
   across both.
3. **At the time, this commit did not touch:** the then-existing multi-process workaround, the live-mode
   page-reload bug, PIXI render concurrency vs. compact mode, or anything
   related to the planned rank-1000 pagination work. All of that remains
   exactly as documented in `HANDOFF.md`/`PROJECT_STATUS.md`.

---

## 6. Rollback

Since this is a pure move plus one isolated caching fix, reverting is
low-risk: `git revert` this commit restores the previous monolithic
`server.js`/`main.js`. There's no data migration, schema change, or
external dependency involved.

---

## 7. What's next (not in this commit)

Per the ongoing design discussion (not yet implemented):
- Introduce `SEASON_LEADERBOARD_API_MAX_LIMIT` (100, upstream-fixed),
  `MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE`, and `LEADERBOARD_MAX_RANK` (1000),
  replacing the current ad-hoc `MAX_LEADERBOARD_REQUEST_SIZE` /
  `MAX_LEADERBOARD_SCAN_RANK` / `LEADERBOARD_POOL_MAX_RANK` trio.
- Unify rank-range-only pagination ("Case A") and filtered pagination
  ("Case B: filter the full candidate window, then paginate the output")
  into one pipeline, with a cheap fast-path for filters that don't need
  battle-log enrichment (e.g. a future name filter).
- Add pagination to the rune scanner's output (currently returns every
  match unpaginated) and raise its scan ceiling to match
  `LEADERBOARD_MAX_RANK`.
- Wire the frontend to the already-built-but-unused
  `/api/leaderboard/pool` + `/api/leaderboard/team/:userID` endpoints,
  replacing the legacy eager `/api/leaderboard` call.
- Complete the unified pagination and enrichment pipeline; the former tracker setup has since been retired.
