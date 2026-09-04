# Leaderboard enrichment — design, fixes, and testing

This document records the current leaderboard enrichment behavior, the changes made to stabilize top-player team previews, and the test configuration used during debugging. Its rendering rules apply only to the leaderboard's team-preview column; the separate Morph Viewer is not affected.

The leaderboard rune control is a searchable multi-select. Typing searches the
existing rune catalog but does not filter results until a suggestion is
selected. Selected runes appear as removable image/name chips, duplicate IDs
are ignored, and multiple selected runes use OR semantics: a player matches if
their team has any selected rune. This control is leaderboard-only; the
separate Morph Viewer is unchanged.

Current status: the multi-select UI, repeated-rune route contract, and OR
matching are working. Manual testing confirmed successful results for top-30
and top-100 scans, including multiple selected runes. A top-1000 scan currently
fails when Sky Mavis returns HTTP 429 while the candidate pool is being fetched
in multiple upstream requests. This is a rate-limit/request-volume limitation,
not a confirmed rune-ID or team-matching failure. Retry/backoff and resilient
candidate-chunk caching remain future work.

**See also:** [Cache and Polling Strategy](../planning/cache-and-polling-strategy.md) — comprehensive guide to the three-layer cache architecture, polling optimization, and tuning recommendations for live battle tracking.

## Current goal
Fetch the Skymavis leaderboard and enrich each row with the player's most recent ranked team so the frontend can render morph previews for top players.

## Desired leaderboard behavior
- The leaderboard `Team` column should display the three fighters used in the player's last ranked battle.
- Each fighter should be shown as an Axie preview thumbnail. Collectible Axies use `genes_metamorph` when available; non-collectible Ronin Axies use `genes`; collectible Axies with an anomalously missing `genes_metamorph` value defensively fall back to `genes`.
- Starter Axies are currently name-only: their `genes` value is not sent to the mixer because the current web mixer cannot render the fixed starter body-part data reliably. Starter rendering is future work.
- This view should present the actual morphed Axie appearance, not just text labels or IDs.
- If the team preview cannot be generated, fallback to a text placeholder.

### Gene field behavior

These rules apply only to leaderboard team previews. Morph Viewer rendering and
its existing Axie lookup data contract remain unchanged.

The leaderboard battle-log payload exposes both `genes` and
`genes_metamorph`. These cases are intentionally distinct:

1. A collectible Axie is expected to have a non-null `genes_metamorph` value;
  that value is preferred because it represents the morphed appearance.
2. A non-collectible Ronin Axie normally has no `genes_metamorph`; its regular
  `genes` value is used for rendering.
3. Some collectible Axies have been observed with an unexpected null
  `genes_metamorph` value in the API response. Their regular `genes` value is
  used as a defensive data-quality fallback.
4. Starter Axies have `axieType: "starter"` and are currently rendered as
  name-only labels. Their `genes` value is reserved for a future
  starter-specific rendering path.

## What changed
### 1. Cache successful team extractions
- Added an in-memory `teamCache` keyed by `clientId`.
- Cache TTL default is now `300000` ms (5 minutes).
- This reduces repeated battle-log fetches for the same player during rapid refreshes.
- Configurable via `TEAM_CACHE_TTL_MS`.

### 2. Resilient battle-log fetching
- Replaced simple `fetch()` with `fetchWithRetry()`.
- Each battle-log request now uses:
  - timeout per attempt: `3000` ms
  - retry attempts: `3`
  - exponential backoff: `500` ms base
- Retries occur on transient upstream failures like `429`, `500`, `502`, and timeouts.

### 3. Deeper ranked-match scan
- Battle-log enrichment now requests up to `20` recent logs (API limit) instead of `10`.
- The code still stops on the first valid ranked match.
- This increases the chance of finding a ranked team when the latest ranked battle is older in the log.
- Note: Skymavis API limits battle-log query to max 20 items per request.

### 4. Debug visibility
- When `DEBUG_ON=true`, the server logs:
  - retry attempt details in `fetchWithRetry`
  - whether a team was attached or loaded from cache
  - if no ranked team could be extracted

## Why these changes help
| Problem | Fix | Result |
|---|---|---|
| Temporary API failures or rate-limits | Retries + timeout | fewer false misses, more consistent team enrichment |
| Rapid repeated refreshes | In-memory cache | repeated requests reuse successful teams, reducing flicker |
| Ranked match not in first 10 logs | Increase battle-log limit to 30 | higher probability of finding the right team |

## Configuration
### Defaults set in `server.js`
- `TEAM_CACHE_TTL_MS` = `600000` (10 minutes) — updated for live battle tracking optimization
- `LEADERBOARD_PAGE_CACHE_TTL_MS` = `30000` (30 seconds) — synced with browser cache
- `LEADERBOARD_STORAGE_TTL_MS` = `30000` (30 seconds, browser-side) — see `src/main.js`
- `BATTLELOG_FETCH_ATTEMPTS` = `3`
- `BATTLELOG_FETCH_TIMEOUT_MS` = `3000`
- `BATTLELOG_FETCH_BACKOFF_MS` = `500`
- `fetchBattleLogsForClient(..., 20)` requests 20 battle logs

### Optional overrides
These env vars may be used for tuning during debugging:
- `TEAM_CACHE_TTL_MS` — longer cache for stability, shorter if you want fresher teams
- `BATTLELOG_FETCH_ATTEMPTS` — more retries for unstable upstreams
- `BATTLELOG_FETCH_TIMEOUT_MS` — longer timeout if your network is slow
- `BATTLELOG_FETCH_BACKOFF_MS` — increase backoff to ease pressure on the API

## Testing procedure
1. Start the server with debugging enabled:
```powershell
$env:DEBUG_ON='true'
node server.js
```

2. Reload the leaderboard repeatedly and record the results:
```powershell
for ($i=1; $i -le 5; $i++) {
  Invoke-RestMethod 'http://127.0.0.1:8787/api/leaderboard?limit=5&offset=0&milestone=3' | ConvertTo-Json -Depth 6 | Out-File leaderboard_$i.json
  Start-Sleep -Seconds 1
}
```

3. Compare `leaderboard_1.json` through `leaderboard_5.json` for missing teams.

4. Check the server console for these markers:
- `team attached for clientId=...`
- `team (from cache) attached for clientId=...`
- `No team extracted for clientId=...`
- `[fetchWithRetry] attempt ...`

## Change log
- `TEAM_CACHE_TTL_MS` increased from `60000` to `300000`
- batch log request limit increased from `10` to `30`
- retry + timeout added to `fetchBattleLogsForClient`
- cache + retry behavior documented in `server.js` and this document

## Notes
- A longer cache TTL is reasonable for testing and repeated refreshes, but may delay updates if a player changes team frequently.
- Scanning 30 logs usually only adds a small local cost because the code exits when the first ranked match is found.
- If the leaderboard still shows occasional misses, the next step is asynchronous enrichment: render rows immediately and update team previews after the server fetches them.

---

File references:
- `server.js` — implementation details for cache, retry, and enrichment logic
- `src/config.js` — leaderboard page size config (`getSeasonLeaderboardLimit`)
