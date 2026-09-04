# Cache and Polling Strategy — Leaderboard Feature

## Revision note (2026-09-03)

This is a rewrite, not a patch, of the previous draft. The previous draft
referenced `server.js - line 1683+` and `server.js - line 1070+` — those line
numbers predate the Phase 1 backend split and no longer correspond to
anything; the code now lives in `src/server/leaderboard/leaderboardCaches.js`
and related files. This revision also adds the candidate-pool cache layer,
which the previous draft didn't cover at all, and documents live-mode's
actual cache behavior as confirmed from the current code rather than assumed.

## Overview

This document explains the cache architecture and polling behavior for the
leaderboard feature, covering both live-tracking (polling) use and non-live
(paginated browsing) use. The goal is to balance data freshness against
Skymavis API rate-limit constraints.

## Important: cache *settings* are shared between live and non-live mode

There is a common misconception worth stating plainly: live mode and non-live
mode do **not** have separate cache configurations. Every TTL constant below
(`TEAM_CACHE_TTL_MS`, `LEADERBOARD_PAGE_CACHE_TTL_MS`, `RANK_CANDIDATE_CACHE_TTL_MS`,
etc.) is a single global value used by both modes. What actually differs is a
**behavioral branch**, confirmed in `leaderboardLegacyRoutes.js`:

```js
if (liveMode) {
  // Bypasses getCachedPage() — always fetches fresh from Skymavis.
  const payload = await fetchAndEnrichLeaderboard(limit, offset, eraMilestone, true);
  setCachedPage(cacheKey, payload); // still WRITES into the same shared cache
  return response.json(payload);
}
// non-live: reads from cache first, stale-while-revalidate via schedulePageRefresh()
```

Live mode skips the page-cache *read* (it always wants fresh data) but still
*writes* its fresh result into the same `pageCache` map that non-live mode
reads from, under the same key format (`leaderboard_${milestone}_${limit}_${offset}`).
If live and non-live requests ever land on the same limit/offset within the
same TTL window, one can serve the other's cached payload. This is existing
behavior, not something introduced by the pagination work below.

## Four-layer cache architecture **[layer 4 is new]**

### Layer 1: Browser cache (sessionStorage)

- **TTL:** `LEADERBOARD_STORAGE_TTL_MS`, 30s default.
- **Key:** `leaderboard_cache_${milestone}_${limit}_${offset}` (`getLeaderboardStorageKey()` in `src/leaderboard/leaderboardState.js`).
- **Scope:** the legacy eager leaderboard view only.
- **Use case:** avoid re-hitting the backend within a browser session for the
  legacy route. Not used by the pool/team endpoints.

### Layer 2: Server page cache (in-memory)

- **TTL:** `LEADERBOARD_PAGE_CACHE_TTL_MS`, 30s default.
- **Key:** `leaderboard_${milestone}_${limit}_${offset}`.
- **Location:** `pageCache` Map in `leaderboardCaches.js`; read/write logic in
  `leaderboardLegacyRoutes.js`.
- **Scope:** the legacy `/api/leaderboard` route only (live mode included, per
  the write-but-not-read behavior above).
- **Pattern:** stale-while-revalidate via `schedulePageRefresh()` — serve
  cached data immediately, refresh in background, for non-live requests.

### Layer 3: Team cache (in-memory)

- **TTL:** `TEAM_CACHE_TTL_MS`, 10 min default. Refresh threshold:
  `TEAM_CACHE_REFRESH_THRESHOLD`, 50% of TTL — marks the entry "stale" but
  still usable while a background refresh runs.
- **Key:** per-player (`clientId`/`userID`).
- **Location:** `teamCache` Map in `leaderboardCaches.js`.
- **Scope:** shared across the legacy route, the pool/team endpoints, and rune
  scanning — a player's team data is reused everywhere it's needed, regardless
  of which feature triggered the fetch.
- **Use case:** teams rarely change mid-session; this is the single biggest
  saver of battle-log API calls.

### Layer 4: Rank candidate pool cache (in-memory) **[NEW]**

- **TTL:** `RANK_CANDIDATE_CACHE_TTL_MS`, 3 min default for non-live pool and
  rune scanning.
- **Key:** `${eraMilestone}_${maxRank}` (e.g. `"4_1000"`).
- **Content:** the raw, unenriched rank/name/MMR list for ranks `1..maxRank` —
  cheap fields only, no team/battle-log data.
- **Location:** `rankCandidateCache` Map in `leaderboardCandidates.js`,
  populated by `fetchRankCandidates()`; read by both
  `leaderboardPoolRoutes.js` (`/api/leaderboard/pool`) and
  `leaderboardRuneRoutes.js` (rune scanning).
- **Why this cache matters more than it looks:** it's keyed by **era only**,
  not by any per-user filter state. Once one request (of any kind — a plain
  rank browse, a name search, a rune scan) populates this cache for an era,
  every other request for that era during the TTL window is a free hit,
  regardless of what filters that later request has active. This is the
  cache that makes "always fetch the full 1000-player pool, filter
  client-side" cheap in aggregate — see `leaderboard-roadmap.md`, "Fetch
  strategy" section, for the full reasoning.
- **Cost on a miss:** upstream's `season-leaderboards` endpoint caps at 100
  players per request, so a cold fetch for `maxRank=1000` costs **10
  sequential upstream calls**. This is the direct cost of raising
  `LEADERBOARD_MAX_RANK` from 35 to 1000.
### TTL rationale

The 3-minute default reduces how often the 10-call cost is paid when rebuilding
the 1000-player pool. This constant is not read by any live-mode code path
(live mode uses the Layer 2 page cache, not this one), so it has no effect on
live-tracking freshness. A deployment can override it when a different
non-live freshness/cost tradeoff is needed.

## Live mode: does not use this document's optimizations

To be explicit, since it's a common point of confusion: live mode's polling
loop calls the legacy `/api/leaderboard?liveMode=true` route, which only
touches Layer 2 (page cache, bypassed on read) and Layer 3 (team cache, used
normally). It never calls `/api/leaderboard/pool` and never touches Layer 4.
The 1000-player pool cache and its recommended longer TTL are entirely a
non-live-mode concern.

## Polling strategy (live mode only)

*(unchanged from prior draft — applies only to live-tracking polling, not to
the non-live pagination work)*

### Recommended: 20s polling + 30s cache

```
t=0s    → Fetch from Skymavis (cache miss)
t=20s   → Serve from cache (hit!) — data is 20s old
t=30s   → Cache expires
t=40s   → Fetch again — captures matches finished between t=20-40s
```

| Interval | Cache Hit Rate | Battle Update Window | API Calls/Hour | Risk |
|---|---|---|---|---|
| 10s | ~40% | 10s | 180-200 | High (rate limits) |
| **20s** | ~50% | 20-40s | 120-140 | Optimal |
| 30s | 40-50% | 30-60s | 80-100 | Good |
| 60s | 70%+ | 60s | 40-50 | Safe but stale |

## Data freshness guide

### Must be fresh (short cache, live mode):
- `lastRankedBattleTime` — 30s TTL via page-cache miss.
- `rank` / `mmr` / `winRate` — 30s cache acceptable.

### Can be stale (long cache):
- `team` (fighters, runes, genes) — 10 min, rarely changes.
- `name` — effectively static for a session.
- Rank-order data for the non-live 1000-player pool — 3–5 min acceptable, see
  Layer 4 above.

## Environment variable tuning

```
# Browser cache TTL (ms) — legacy route only
LEADERBOARD_STORAGE_TTL_MS=30000

# Server page cache TTL (ms) — legacy route only, both live and non-live
LEADERBOARD_PAGE_CACHE_TTL_MS=30000

# Team cache TTL (ms) — shared across all features
TEAM_CACHE_TTL_MS=600000
TEAM_CACHE_REFRESH_THRESHOLD=0.5

# Rank candidate pool cache TTL (ms) — non-live pool + rune scanning only
# Recommended: raise from the 30000 default for non-live pagination use.
RANK_CANDIDATE_CACHE_TTL_MS=180000   # example: 3 minutes

# Concurrency limit for battle-log fetches (shared globally)
BATTLELOG_FETCH_CONCURRENCY=4
```

## Monitoring cache health

With `DEBUG_ON=true`, watch for:

```
[fetchRankCandidates] cache HIT for 4_1000
[fetchRankCandidates] fetched 1000 candidates for 4_1000
[getCachedPage] HIT: leaderboard_4_50_0
[getCachedTeam] HIT: returning cached team for <userID>
```

## Scaling for multiple concurrent users

*(unchanged from prior draft — applies to Layers 1–3; Layer 4's era-only
keying already scales well across concurrent users by design, since all
users browsing the same era share one cache entry regardless of their
individual filter state)*

## Summary

- **Browser cache (30s):** legacy route only, instant local responses.
- **Server page cache (30s):** legacy route only, shared across clients,
  stale-while-revalidate. Live mode writes but doesn't read.
- **Team cache (10 min):** shared across every feature that needs per-player
  team data.
- **Rank candidate pool cache (recommend 3–5 min):** non-live pagination and
  rune scanning only, keyed by era, shared across all users and all filter
  types for that era. Never touched by live mode.
- **Polling (20s, live mode only):** ~50% cache hit rate on the page cache,
  catches battles within 20–40s.
