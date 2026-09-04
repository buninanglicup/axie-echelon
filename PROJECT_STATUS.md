# Axie Morph Viewer - Project Status & Documentation

**Last Updated:** 2026-09-04
**Version:** Live Tracking Beta

> Current architecture: one unified development app started with `npm run dev`.
> The former three-process tracker setup was retired after Phase 1. Non-live
> leaderboard browsing now uses a cached top-1000 candidate pool with client-side
> filtering, pagination, progressive team enrichment, and rune narrowing.

---

## 1. Project Overview

A real-time leaderboard tracking system for monitoring top Axie Infinity players in one unified app. Non-live browsing covers the cached top-1000 candidate pool; live mode continues to use its legacy polling route.

---

## 2. Current Features

### âœ… Completed Features

#### A. Core Leaderboard Display
- Displays ranked player list with MMR, win rate, recent form, and daily rank change
- Player team rendering with morphed Axie preview (PIXI.js + Spine)
- Rune badge display on equipped runes
- Last-played battle timestamp

#### B. Compact Mode (UI Optimization)
- Toggles between Normal â†” Compact view
- Compact mode reduces row height by ~60% (fits 3-4Ã— more rows per screen)
- CSS optimizations:
  - Padding: 1px 3px (vs 8px 12px normal)
  - Font size: 9px (vs 12px normal)
  - Axie preview: 16Ã—16px (vs 32Ã—32px normal)
  - Rune badge: 30Ã—30px (dominant visual element, unchanged)
- State persists per session (does NOT persist across page reloads)

#### C. Live Mode Tracking
- **Purpose:** Real-time monitoring of ranked battle activity within a time window
- **Activation:** Toggle "Live Mode" checkbox
- **Polling:** Fetches fresh leaderboard data every N seconds (configurable in the shared `.env`)
- **Activity Filter:** "Battle Activity Window" (0s, 1m, 2m, 3m, 4m, 5m, 10m, 15m, 20m)
  - Only displays players whose last ranked battle ended within selected window
  - Example: "5m" shows only players who battled in the last 5 minutes
- **Controls:**
  - Live Mode toggle
  - Polling interval selector (configurable via the shared `.env`)
  - Activity window preset buttons

#### D. Configurable Polling Interval
- Shared configuration in `.env`, documented by `.env.example`
- Environment variable: `VITE_POLLING_INTERVAL`
- Default: 30 seconds
- Loaded via `src/main.js` line 11: `import.meta.env.VITE_POLLING_INTERVAL`
- Default polling interval: 30 seconds, configured in the shared `.env`

#### E. Rune Filter Scanning (Track B)
- Searchable rune catalog picker
- Scans ranks 1-1000 for players matching selected rune
- Returns all matching players with team data
- Dedupes API calls with internal fetch deduping

#### F. Unified Local Development
- `npm run dev` starts the backend and frontend together
- `.env.example` documents the shared local configuration
- The retired tracker launchers and per-tracker environment files are no longer part of the app

#### G. Axie Collectible Classification
- Detects and tags: Origin, MEO, Agamogenesis, Nightmare, Mystic, Shiny, Summer, Japan, Xmas
- Uses heuristic classifier on title, parts, and geneDecoder

---

## 3. Current Milestone: Session-Based Ranked Activity Prediction

### Live activity estimate feature
- Added a live-only next-activity estimate for each player using their recent ranked battle cadence.
- The estimate is based on a same-session pause heuristic: it trims stale battles older than a 20-minute gap, ignores sub-60s surrender/early-exit matches, and weights the most recent pause more heavily than older pauses.
- The backend exposes a median global match duration for the current poll so the UI can tell whether a player is likely in a match or simply overdue.
- Output states are intentionally honest: unknown when there is not enough evidence, before_due while the next activity is still in the future, likely_in_match during a typical match window, and overdue when the expected start time has already passed.

### Validation status
- The feature is implemented in the backend, shared formatting utilities, and frontend rendering pipeline.
- The live app is available to test manually against the current leaderboard data and polling logic.
- Validation artifacts created during the debug pass are intentionally local-only and are ignored by Git to keep the repo clean.

---

## 4. Live Mode Specifics

### Caching Strategy (Live Mode)

**Page Cache:** BYPASSED
- Normally: 30s TTL, serves cached leaderboard
- Live Mode: Always fetches fresh rank/name/mmr from Skymavis
- Parameter: `?liveMode=true`

**Team Cache:** BYPASSED (Option A Implementation)
- Normally: 30s TTL, serves cached 3-axie team + lastRankedBattleTime
- Live Mode: Always fetches fresh battle logs for each player
- Ensures `lastRankedBattleTime` stays fresh for activity filtering

**API Load (Live Mode):**
- Up to ~50-player enrichment per poll in the unified app; live-mode API pressure remains high because caches are bypassed
- Acceptable when rate limits not enforced

### Activity Filter Logic
```javascript
// Line 595-605 in src/main.js
if (!liveModeEnabled) return players;

const windowMs = activeBattleWindowMinutes * 60 * 1000;
return players.filter((player) => {
  const timestamp = getLastBattleTimestamp(player);
  if (!timestamp) return false;

  const ageMs = now - ts;
  return ageMs >= 0 && ageMs <= windowMs;  // âœ… Within window
});
```

---

## 4. Known Bugs & Limitations

### ðŸ› Critical Bugs

#### A. Live Mode Page Reload (UNRESOLVED)
**Symptom:** When live mode is toggled ON, the app can switch back to OFF and compact mode can revert to normal
- **Status:** Page reload IS confirmed (sessionStorage + event logging shows `[PAGE RELOAD DETECTED]`)
- **Root Cause:** UNKNOWN â€” investigated:
  - âœ… Cache expiration (ruled out â€” disabled cache, reload persists)
  - â“ Vite HMR reconnection on network hiccup
  - â“ Firefox extension interference
  - â“ Browser tab visibility handling
- **Current Investigation:** Need DevTools console logs to identify trigger
- **Workaround:** None yet

#### B. Activity Filter Flickering (PARTIALLY FIXED)
**Symptom:** Players disappear from activity filter for 1-2 seconds, then reappear
**Root Cause:** Battle log fetch failures return `lastRankedBattleTime: null` â†’ player filtered out â†’ next poll succeeds â†’ player visible again

**Current Fix (Frontend):** Preserve previous `lastRankedBattleTime` when new fetch fails (line 964-973 in src/main.js)
- Masks symptom but doesn't fix root cause
- Root cause: Aggressive cache bypass hammers Skymavis API â†’ rate limiting/connection resets

**Better Fix Needed:** Switch from full cache bypass to short 5-10s cache in live mode

---

### âš ï¸ Limitations

#### A. Compact Mode State Loss
- Does NOT persist across page reloads
- Reverts to Normal mode on page refresh
- **Workaround:** User manually toggles Compact after reload

#### B. Battle Timestamp Freshness
- Depends on `lastRankedBattleTime` from most recent ranked battle log
- If a player hasn't played ranked matches, timestamp is null (player hidden in activity filter)
- Activity filter only shows "current" team (most recent ranked battle), not historical teams

#### C. Team Cache Refresh Lag (Normal Mode)
- Normal mode: 30s team cache with 15s stale threshold
- Players' teams can be up to 30s old
- Acceptable for normal tracking, not ideal for detecting mid-session team swaps

#### D. Rune Filter Scan Range
- Scans only ranks 1-200 (hardcoded `MAX_LEADERBOARD_SCAN_RANK`)
- Honors Skymavis API constraint: 100 rows per request (requires 2 upstream calls to cover 200)
- Does NOT scan beyond rank 200

#### E. Enrichment Cache Failures
- If battle log fetch fails, cached failure persists for 30s (`FAILED_ENRICHMENT_CACHE_TTL_MS`)
- During 30s window, player returns `status: "failed"` with attempts count
- Frontend cannot show team/battle timestamp for that player

#### F. PIXI Rendering Limits
- Max 4 concurrent Axie renders to prevent WebGL context eviction
- Compact mode shows 3-4Ã— more rows, each with 3 Axies â†’ may exceed render budget
- Could cause "ghost" preview slots until render catches up

#### G. Firefox Extension Warning
- `MaxListenersExceededWarning` with orphaned data streams observed
- Likely related to number of open connections/streams to Skymavis
- May be contributing factor to live mode reload bug (TBD)

---

## 5. Configuration Files & Environment Variables

### `.env` (Unified Local Configuration)
```bash
PORT=8787
VITE_PORT=5173
AXIE_ECHELON_API_KEY=<user manually maintains>
DEBUG_ON=false
VITE_LEADERBOARD_LIMIT=50
VITE_LEADERBOARD_OFFSET=0
VITE_POLLING_INTERVAL=30
```

Copy `.env.example` to `.env`; keep the API key local and uncommitted. The limit
and offset are temporary fixed-window controls, not a substitute for the
planned Phase 2 pagination UI.

### Frontend Environment Variables
Loaded via `import.meta.env` in `src/main.js`:
- `VITE_LEADERBOARD_LIMIT`
- `VITE_LEADERBOARD_OFFSET`
- `VITE_POLLING_INTERVAL`

**Important:** Vite reads the shared `.env`, `.env.local`, or shell environment.

---

## 6. Architecture & Performance

### Backend Caching Layers (Normal Mode)
| Layer | TTL | Purpose |
|-------|-----|---------|
| Page Cache | 30s | Caches enriched leaderboard (rank + team for 50 players) |
| Team Cache | 30s | Caches individual 3-axie team + lastRankedBattleTime |
| Enrichment Cache | 30s (failed) / 30s (ready) | Phase 1 migration cache (separate from team cache) |
| Rank Candidate Cache | 30s | Raw rank list for rune filter (no enrichment) |

### Backend Concurrency
- `BATTLELOG_FETCH_CONCURRENCY`: 2 concurrent battle log fetches
- High/Low priority queue: Visible-page requests prioritized over background prefetch

### Frontend Storage
- `sessionStorage`: Browser cache of last leaderboard response (cleared on reload)
- Fingerprint comparison: Detects changes before re-rendering

---

## 7. Data Flow (Live Mode)

```
Timer (30s interval)
  â†“
Frontend: hydrateLeaderboard()
  â†“
GET /api/leaderboard?limit=50&offset=0&liveMode=true
  â†“
Backend: fetchAndEnrichLeaderboard(50, 0, "3", true)
  â”œâ”€ Fetch raw ranks 1-50 from Skymavis
  â””â”€ For each player (liveMode=true):
      â”œâ”€ Skip getCachedTeam() [BYPASSED in Option A]
      â””â”€ Fetch fresh battle logs (50 API calls)
  â†“
Return enriched players with fresh lastRankedBattleTime
  â†“
Frontend: Preserve old timestamps if fetch failed
  â”œâ”€ Merge with previous leaderboardData
  â””â”€ Apply activity filter
  â†“
Render filtered players in DOM
```

---

## 8. API Endpoints

### Leaderboard
- **GET /api/leaderboard**
  - Params: `limit`, `offset`, `milestone`, `liveMode` (optional)
  - Returns: Enriched leaderboard with team data and lastRankedBattleTime

### Team Enrichment (On-Demand)
- **GET /api/leaderboard/team/:userID**
  - Returns: PlayerEnrichment object (status: ready/stale/failed)

### Rune Filter
- **GET /api/leaderboard/rune/:runeId**
  - Params: `milestone` (optional)
  - Returns: All matching players in ranks 1-200

### Rune Catalog
- **GET /api/runes**
  - Returns: All available runes with metadata

---

## 9. Known Technical Debt

1. **Dual Cache Paths:** teamCache and enrichmentCache both exist during Phase 1 migration
   - Should unify once Phase 3 retires legacy eager-enrichment

2. **Overlapping Rank Candidate Caches:** Rune scan (rank 1-200) and leaderboard pool (rank 1-250) have separate cache keys
   - Ranks 1-200 fetched twice under different keys (redundant)

3. **Compact Mode State:** Not persisted across reloads
   - Could use localStorage to preserve user preference

4. **Fingerprinting Logic:** Simple hash comparison, could be optimized with record versioning

5. **Firefox Extension Conflict:** Unknown â€” needs investigation

---

## 10. Testing Checklist

### Live Mode
- [ ] Toggle live mode ON â†’ leaderboard refreshes every N seconds
- [ ] Activity filter works (players appear/disappear within window)
- [ ] Players don't flicker in/out incorrectly
- [ ] Compact mode display works with live polling
- [ ] Check browser console for `[LIVE MODE]` logs
- [ ] Verify no reload occurs during 5-10 min live tracking
- [ ] Verify one unified app remains stable during extended live tracking

### Normal Mode
- [ ] Leaderboard loads once without live polling
- [ ] Manual refresh works
- [ ] Rune filter scan completes and displays results
- [ ] Compact mode toggle works
- [ ] Team previews render correctly

### Configuration
- [ ] Verify the unified app loads the shared `.env` file
- [ ] Polling interval reads from VITE_POLLING_INTERVAL
- [ ] Fixed limit/offset display the configured rank window until pagination lands

---

## 11. Next Steps

### Priority 1 (Critical)
1. **Identify live mode reload root cause**
   - Capture DevTools console logs when reload happens
   - Check Network tab for failed requests
   - Test with Firefox extensions disabled
   - Investigate Vite HMR reconnection behavior

2. **Fix activity filter flickering**
   - Switch from full cache bypass to 5-10s team cache in live mode
   - Reduces API hammering while keeping timestamps fresh

### Priority 2 (Enhancement)
1. Persist compact mode state via localStorage
2. Unify dual-cache Phase 1 migration
3. Investigate Firefox extension interference

### Priority 3 (Nice-to-Have)
1. Extend rune filter beyond rank 200
2. Historical team tracking (not just current team)
3. Player comparison tool
4. Export tracking data to CSV

---

## 12. Quick Start

### Launch the Unified App
```powershell
npm run dev
```

Open `http://127.0.0.1:5173`.

---

**For detailed implementation notes, see:**
- Server: [server.js](server.js) (lines 755-1100 for caching, 1737+ for live mode)
- Frontend: [src/main.js](src/main.js) (lines 1-35 for page reload detection, 435-530 for live mode controls, 949-1010 for hydration)
