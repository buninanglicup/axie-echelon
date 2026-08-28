# Cache and Polling Strategy — Live Battle Tracking Optimization

## Overview
This document explains the three-layer caching strategy and polling interval tuning for the leaderboard feature. The goal is to balance **freshness of battle time data** with **API rate-limit constraints**.

## Use Case
**Current (development):** Solo player using live mode to track when top-ranked players finish battles so they can decide who to challenge next. Battle times must be fresh (catch within 20-40 seconds), but repeated polling cannot exceed Skymavis API rate limits.

**⚠️ Important Note for Deployment:** This configuration is optimized for single-user / development scenarios. When deployed for multiple concurrent players, you should reconsider:

- **Server page cache (30s):** Works great with 1-2 users. With 10+ concurrent users polling the same leaderboard page, a 30s cache delivers high reuse, but you may need to **increase TTL to 60-90s** for even better API efficiency while still catching battles within 1-2 polling intervals.
- **Polling interval (20s):** Fine for solo testing but with many users, **consider extending to 30-60s** to reduce total API load, unless your rate-limit budget permits aggressive polling.
- **Team cache (10 min):** Still good—per-player data is reused across requests. Consider **extending to 15-20 min** for multi-user scenarios to reduce battle-log API calls.
- **Concurrency limit:** `BATTLELOG_FETCH_CONCURRENCY=4` is conservative for solo use but may throttle enrichment with many concurrent users. Test with `DEBUG_ON=true` to monitor queue depth.

Recalibrate these values based on:
1. Number of concurrent users
2. Skymavis API rate-limit budget
3. Acceptable stale-data window (currently 20-40s, may need to relax to 1-2 min)
4. Measurement of cache hit rates in production

## Three-Layer Cache Architecture

### Layer 1: Browser Cache (sessionStorage)
- **TTL:** 30 seconds
- **Key:** `leaderboard_cache_${milestone}_${limit}_${offset}`
- **Content:** Entire enriched leaderboard page (200 players + team data)
- **When hit:** ~10-20ms response, no backend call
- **When miss:** Calls backend, page is re-cached for 30s

**Configuration:**
```javascript
// src/main.js
const LEADERBOARD_STORAGE_TTL_MS = 30 * 1000; // 30 seconds
```

**Use case:** Avoid hammering the backend within a browser session. Survives page reload (within same tab + 30s window).

---

### Layer 2: Server Page Cache (in-memory)
- **TTL:** 30 seconds
- **Key:** `leaderboard_${milestone}_${limit}_${offset}`
- **Content:** Entire enriched page (shared across all clients)
- **When hit:** ~50-100ms response + scheduled background refresh
- **When miss:** Calls Skymavis + enriches with battle logs (1-2 sec)

**Configuration:**
```javascript
// server.js
const LEADERBOARD_PAGE_CACHE_TTL_MS = Number(process.env.LEADERBOARD_PAGE_CACHE_TTL_MS || 30000); // 30s
```

**Use case:** Multiple clients can share one cached page. Implements "stale-while-revalidate" pattern: serve cached data immediately while refreshing in background.

---

### Layer 3: Team Cache (in-memory)
- **TTL:** 10 minutes
- **Refresh threshold:** 50% of TTL (5 minutes) — marks cache as "stale" but still usable
- **Key:** Per-player (userID)
- **Content:** Player's current 3-axie team, runes, lastRankedBattleTime
- **When hit:** Instant (~1ms)
- **When stale:** Background refresh, no blocking

**Configuration:**
```javascript
// server.js
const TEAM_CACHE_TTL_MS = Number(process.env.TEAM_CACHE_TTL_MS || 600000); // 10 min
const TEAM_CACHE_REFRESH_THRESHOLD = Number(process.env.TEAM_CACHE_REFRESH_THRESHOLD || 0.5); // 50%
```

**Use case:** Teams are stable (rarely swapped mid-session). Caching 10 min prevents redundant battle-log API calls. Same team data is reused across normal leaderboard views, rune filters, and pagination.

---

## Polling Strategy

### Available Intervals
```html
<!-- index.html -->
<option value="10">10s</option>
<option value="20">20s</option>   <!-- New: sweet spot for battle tracking -->
<option value="30" selected>30s</option>
<option value="60">60s</option>
```

### Recommended: 20s Polling + 30s Cache

**Why 20s is optimal:**
```
t=0s    → Fetch from Skymavis (cache miss)
         ├─ Fresh battle times captured
         └─ Stored for 30s

t=20s   → Serve from cache (hit!)
         ├─ Data is 20s old (still relevant)
         └─ ~10ms response

t=30s   → Cache expires

t=40s   → Fetch again (cache miss)
         ├─ NEW battle times caught!
         ├─ Captures matches finished between t=20-40s
         └─ This is your key value: catch battles within ~40s window

Pattern: ~50% cache hit rate
         ~120-140 API calls/hour (vs ~180-200 with 10s polling)
```

### Trade-offs by Interval

| Interval | Cache Hit Rate | Battle Update Window | API Calls/Hour | Risk |
|----------|---|---|---|---|
| 10s | ~40% | 10s | 180-200 | ⚠️ High (rate limits) |
| **20s** | ~50% | 20-40s | 120-140 | ✅ **Optimal** |
| 30s | 40-50% | 30-60s | 80-100 | ✅ Good |
| 60s | 70%+ | 60s | 40-50 | 🟢 Safe but stale |

---

## Data Freshness Guide

### Must be fresh (short cache):
- `lastRankedBattleTime` — **30s cache TTL** via page cache miss
- `rank` / `mmr` — updates after each battle, **30s cache OK**
- `winRate` — updates per battle, **30s cache OK**

### Can be stale (long cache):
- `team` (fighters, runes, genes) — **10 min cache, rarely changes**
- `name` — never changes in session, **very long cache safe**
- `roninAddress` / `profileUrl` — derived once, **never changes**

---

## Implementation Details

### Browser Cache
```javascript
// src/main.js - line 15
const LEADERBOARD_STORAGE_TTL_MS = 30 * 1000;

function loadLeaderboardPageFromStorage(limit, offset, milestone) {
  // Check TTL, return payload if fresh, else null
}

function saveLeaderboardPageToStorage(limit, offset, milestone, payload) {
  // Store with timestamp
}
```

### Server Cache
```javascript
// server.js - line 1683+
const LEADERBOARD_PAGE_CACHE_TTL_MS = 30000; // 30s

const pageCache = new Map();

function getCachedPage(key) {
  // Return cached payload if within TTL, else null
}

function setCachedPage(key, payload) {
  // Store with timestamp
}

// Stale-while-revalidate pattern:
// 1. If cache hit: return immediately, schedule background refresh
// 2. If cache miss: fetch fresh, cache it, return
```

### Team Cache
```javascript
// server.js - line 1070+
const TEAM_CACHE_TTL_MS = 600000; // 10 min
const TEAM_CACHE_REFRESH_THRESHOLD = 0.5; // 50%

function getCachedTeam(clientId) {
  // Return team if within TTL, else null
}

function isTeamCacheStale(clientId) {
  // Return true if past 50% of TTL (5 min)
  // Used to trigger background refresh without blocking
}
```

---

## Environment Variable Tuning

Override defaults in `.env`:

```bash
# Browser cache TTL (ms)
# Too long: miss real-time updates
# Too short: more backend calls
LEADERBOARD_STORAGE_TTL_MS=30000

# Server page cache TTL (ms)
# Too long: share stale pages across clients
# Too short: more upstream Skymavis calls
LEADERBOARD_PAGE_CACHE_TTL_MS=30000

# Team cache TTL (ms)
# Too long: miss team/rune changes
# Too short: more battle-log API calls
TEAM_CACHE_TTL_MS=600000

# When to mark team cache as "stale" (fraction of TTL)
# 0.5 = at 50% (5 min into 10 min), triggers background refresh
TEAM_CACHE_REFRESH_THRESHOLD=0.5

# Concurrency limit for battle-log fetches (shared globally)
# Too high: rate-limit 429 errors
# Too low: slow enrichment
BATTLELOG_FETCH_CONCURRENCY=4

# Polling interval (set in UI dropdown, not env)
# 10s, 20s, 30s, 60s
# Recommended: 20s for live battle tracking
```

---

## Monitoring Cache Health

### With DEBUG_ON enabled:
```powershell
$env:DEBUG_ON='true'
node server.js
```

Watch console for:
```
[getCachedPage] HIT: leaderboard_3_200_0
[getCachedPage] MISS: leaderboard_3_200_0
[getCachedPage] EXPIRED: leaderboard_3_200_0
[getCachedTeam] HIT: returning cached team for <userID>
[getCachedTeam] MISS: no cache entry for <userID>
[fetchBattleLogsForClientDeduped] REUSING in-flight fetch for <userID>
```

### Cache hit rate calculation:
```
Hits per hour / Total polls per hour = Hit rate

Example with 20s polling:
- Polls per hour: 3600 / 20 = 180 polls
- Expected hits with 30s cache: ~90 polls (50%)
- Estimated API cost: 90 cache misses = 90 fresh fetches
```

---

## Troubleshooting

### Problem: "Battles feel stale, not seeing updates within 20s"
**Solution:** Ensure polling interval is 20s or less, and cache TTL is 30s.

### Problem: "Rate limit 429 errors"
**Solution:**
1. Increase cache TTL (longer = fewer misses)
2. Decrease polling interval (wait longer between polls)
3. Reduce BATTLELOG_FETCH_CONCURRENCY
4. Consider extending TEAM_CACHE_TTL_MS if teams rarely change

### Problem: "Page cache says hit but data looks stale"
**Solution:** Stale-while-revalidate is working as designed. Cache is hit, but refresh is scheduled in background. Check server logs with DEBUG_ON for background refresh status.

---

## Scaling for Multiple Concurrent Users

**Current tuning is optimized for solo development.** If deploying for multiple players, adjust based on observed metrics:

### Single User (Current)
```
20s polling + 30s cache = ~50% hit rate = 90 API calls/hour
```

### 5 Concurrent Users (Small group)
```
Recommendation:
  - Increase LEADERBOARD_PAGE_CACHE_TTL_MS to 60s
  - Keep polling at 20-30s (users pick different intervals)
  - Server cache gets 4-5 clients sharing same cached page
  - Expected: ~200-250 API calls/hour (vs 450 with no cache)
Rationale: Multiple users benefit from shared page cache.
Longer TTL (60s) reduces Skymavis call frequency while still catching
most battles within 1-2 polling cycles.
```

### 10+ Concurrent Users (Multi-player deployment)
```
Recommendation:
  - Increase LEADERBOARD_PAGE_CACHE_TTL_MS to 90s
  - Recommend polling 30-60s in UI (safer default)
  - Increase TEAM_CACHE_TTL_MS to 15min
  - Increase BATTLELOG_FETCH_CONCURRENCY to 8-10
  - Add Redis or similar for shared server cache (current: in-memory only)
Rationale: More users = better cache hit rates.
90s cache with 10 users = very high reuse. Battle updates may lag
to 1-2 min, but API load becomes manageable. Consider persistent
cache if server restarts are frequent.
```

### Monitoring for Multi-User Deployment

Enable DEBUG_ON and track these metrics hourly:
```
- Cache hit rate: (HIT logs) / (HIT + MISS logs)
- 429 rate-limit errors from Skymavis
- Average response time for cache hit vs miss
- Battle-log fetch queue depth (watch for bottlenecks)
- Total API calls to Skymavis per hour
```

Example log parsing:
```powershell
# Extract cache stats
Select-String '\[getCachedPage\] (HIT|MISS)' server.log | Group-Object { $_.Matches[0].Groups[1].Value } | ForEach-Object { "$($_.Name): $($_.Count)" }

# Count 429 errors
(Select-String '429' server.log).Count

# Monitor concurrency queue
Select-String 'acquireBattleLogSlot|releaseBattleLogSlot' server.log | tail -20
```

---

## Summary

- **Browser cache (30s):** Instant local responses
- **Server cache (30s):** Shared across clients, stale-while-revalidate
- **Team cache (10 min):** Reused across requests, marked stale at 5min for background refresh
- **Polling (20s):** ~50% cache hit rate, catches battles within 20-40s
- **Current scenario:** Solo player, live battle tracking
- **For deployment:** Adjust TTLs, polling, and concurrency based on user count and API budget

This configuration balances freshness with API efficiency for the current use case. For multi-user deployment, extend cache TTLs and reduce polling aggressiveness to maintain API rate-limit compliance.
