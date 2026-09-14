# Cache and Polling Strategy — Leaderboard Feature

## Review note (2026-09-11)

This document reflects the current split backend and frontend implementation.
Cache ownership and keys should be reviewed whenever leaderboard scopes,
candidate loading, or live polling behavior changes.

## Overview

This document explains the cache architecture and polling behavior for the
leaderboard feature, covering both live-tracking (polling) use and non-live
(paginated browsing) use. The goal is to balance data freshness against
Sky Mavis API rate-limit constraints.

## Operational guard rails for live polling and expensive reads

The backend now uses shared Express rate-limiters to keep active polling and
expensive upstream reads under control. The baseline limiter covers ordinary API
traffic in general, `expensiveRouteLimiter` is applied to the costliest routes,
and the `liveMode` route gets its own hourly quota keyed by the normalized client
IP with `ipKeyGenerator(request.ip)`. This prevents an unlimited polling loop from
amplifying Sky Mavis requests while still allowing ordinary non-live reads and
cache hits to continue normally.

### Security notes for IP-based throttling

IP-based rate limiting is reliable only when Express sees the true client IP.
When the app is deployed behind a reverse proxy or load balancer, `request.ip`
may collapse many clients behind the same proxy unless the app has an explicit
`trust proxy` configuration and the forwarded headers are trusted. This is not a
code bug in the limiter itself, but it is a deployment requirement: without a
trusted reverse-proxy setup, different users can share the same rate-limit key.

The 429 response contract is deliberately minimal and safe: it reports a generic
"too many requests" error, includes the standard `Retry-After` header when the
rate-limit library emits it, and does not expose stack traces, internal config,
or service details in the payload.

### Canonicalization and cache safety

Address lookups are canonicalized before caching. The cache key is created from
`cleanRoninAddress(address)`, not the raw user input. That means equivalent
inputs such as `ronin:...`, `RONIN:...`, or mixed-case variants map to the same
canonical `0x...` key and do not create divergent cache entries for the same
wallet. This makes the address lookup cache stable and avoids accidental cache
poisoning through input normalization differences.

## Important: cache *settings* are shared between live and non-live mode

There is a common misconception worth stating plainly: live mode and non-live
mode do **not** have separate cache configurations. Every TTL constant below
(`TEAM_CACHE_TTL_MS`, `LEADERBOARD_PAGE_CACHE_TTL_MS`, `RANK_CANDIDATE_CACHE_TTL_MS`,
etc.) is a single global value used by both modes. What actually differs is a
**behavioral branch**, confirmed in `leaderboardLegacyRoutes.js`:

```js
if (liveMode) {
  // Bypasses getCachedPage() — always fetches fresh from Sky Mavis.
  const payload = await fetchAndEnrichLeaderboard(limit, offset, eraMilestone, true);
  setCachedPage(cacheKey, payload); // still WRITES into the same shared cache
  return response.json(payload);
}
// non-live: reads from cache first, stale-while-revalidate via schedulePageRefresh()
```

Live mode skips the page-cache *read* (it always wants fresh data) but still
*writes* its fresh result into the same `pageCache` map that non-live mode
reads from, under the same scope-aware key format (`leaderboard_${scope}_${limit}_${offset}`).
If live and non-live requests ever land on the same limit/offset within the
same TTL window, one can serve the other's cached payload. This is existing
behavior, not something introduced by the pagination work below.

## Four primary cache layers **[layer 4 is new]**

These are the four caches that directly shape leaderboard loading, browsing,
and scanning. The backend also maintains separate profile, team-composition,
enrichment-status, and average-match-duration caches; those specialized caches
are covered where their features require them.

### Layer 1: Browser cache (sessionStorage)

- **TTL:** `LEADERBOARD_STORAGE_TTL_MS`, 30s default.
- **Key:** scope-aware `leaderboard_cache_${scope}_${limit}_${offset}` (`getLeaderboardStorageKey()` in `src/leaderboard/leaderboardState.js`).
- **Scope:** the legacy eager leaderboard view only.
- **Use case:** avoid re-hitting the backend within a browser session for the
  legacy route. Not used by the pool/team endpoints.

### Layer 2: Server page cache (in-memory)

- **TTL:** `LEADERBOARD_PAGE_CACHE_TTL_MS`, 30s default.
- **Key:** scope-aware `leaderboard_${scope}_${limit}_${offset}`.
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
- **Key:** per-player and leaderboard scope (`clientId`/`userID` plus the era or offseason scope).
- **Location:** `teamCache` Map in `leaderboardCaches.js`.
- **Scope:** shared across the legacy route, the pool/team endpoints, and rune
  scanning — a player's team data is reused everywhere it's needed, regardless
  of which feature triggered the fetch.
- **Use case:** teams rarely change mid-session; this is the single biggest
  saver of battle-log API calls.

### Layer 4: Rank candidate pool cache (in-memory) **[NEW]**

- **TTL:** `RANK_CANDIDATE_CACHE_TTL_MS`, 3 min default for non-live pool and
  rune scanning.
- **Key:** one entry per leaderboard scope and 100-player chunk, such as
  `${scope}:offset:${offset}`.
- **Content:** the raw, unenriched rank/name/MMR list for ranks `1..maxRank` —
  cheap fields only, no team/battle-log data.
- **Location:** `rankCandidateCache` Map in `leaderboardCandidates.js`,
  populated by `fetchRankCandidates()`; read by both
  `leaderboardPoolRoutes.js` (`/api/leaderboard/pool`) and
  `leaderboardRuneRoutes.js` (rune scanning).
- **Why this cache matters more than it looks:** it is keyed by leaderboard
  scope and chunk offset, not by any per-user filter state. Once a request of
  any kind (plain rank browse, name search, or rune/body-part scan) populates a
  chunk, other requests for that same scope and chunk can reuse it during the
  TTL window. This makes fetching the full 1000-player pool and filtering
  client-side cheaper in aggregate — see `leaderboard-roadmap.md`, "Fetch
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

This applies only to live-tracking polling, not to the non-live pagination
work.

### Default: 30s polling + 30s cache

```
t=0s    → Fetch from Sky Mavis (cache miss)
t=30s   → Poll again; the 30s page cache has expired, so fetch fresh data
t=60s   → Poll again and repeat the cycle
```

| Interval | Cache Hit Rate | Battle Update Window | API Calls/Hour | Risk |
|---|---|---|---|---|
| 15s | Low | 15-30s | ~240 | Higher request pressure |
| **30s** | Low | ~30-60s | ~120 | Default balance |
| 60s | Low | ~60-120s | ~60 | Lower pressure, staler results |

## Data freshness guide

### Must be fresh (short cache, live mode):
- `lastRankedBattleTime` — refreshed on each live page-cache miss.
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
# Default: 180000 ms (3 minutes) for non-live pagination and scans.
RANK_CANDIDATE_CACHE_TTL_MS=180000   # example: 3 minutes

# Concurrency limit for battle-log fetches (shared globally)
BATTLELOG_FETCH_CONCURRENCY=4
```

## Monitoring cache health

With `DEBUG_ON=true`, watch for:

```
[fetchCandidateChunk] cache HIT for <scope>:offset:0
[fetchRankCandidates] fetched candidate chunks for <scope>
[getCachedPage] HIT: leaderboard_4_50_0
[getCachedTeam] HIT: returning cached team for <userID>
```

## Scaling for multiple concurrent users

Layer 4 scales across concurrent users because users browsing the same scope
share candidate chunks regardless of their individual filter state.

## Summary

- **Browser cache (30s):** legacy route only, instant local responses.
- **Server page cache (30s):** legacy route only, shared across clients,
  stale-while-revalidate. Live mode writes but doesn't read.
- **Team cache (10 min):** shared across every feature that needs per-player
  team data.
- **Rank candidate pool cache (3 min default):** non-live pagination and rune or
  body-part scanning, keyed by leaderboard scope and chunk offset, shared
  across users and filter types for that scope. Never touched by live mode.
- **Polling (30s by default, live mode only):** live mode bypasses page-cache
  reads, so each poll requests a fresh activity timestamp while team data can
  still come from the shared team cache.
