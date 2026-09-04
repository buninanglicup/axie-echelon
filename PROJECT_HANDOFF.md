# Axie Echelon: Current Project Handoff

**Last verified:** 2026-09-04

This is the canonical current-status document. `PHASE1_SPLIT_SUMMARY.md` records the historical refactor, while `HANDOFF.md` and `PROJECT_STATUS.md` are older overlapping notes.

## Purpose and Current State

Axie Echelon is a local Axie Infinity leaderboard monitoring and battle-activity analysis application. It displays ranked players, recent ranked-battle activity, current teams, rune metadata, and morphed Axie previews. It also supports Axie ID and Ronin-address lookup.

The activity display is heuristic-based. It observes completed ranked battles and estimates likely next activity from historical session timing; it does not directly confirm that a player is currently in a live match.

The project is an MVP with the Phase 1 server/frontend split implemented and build-verified. The main unresolved product issue is live-mode page reload behavior; the application has not yet had a complete browser smoke test after the split.

### Era terminology

An Origins season contains four eras. Sky Mavis names the numeric era selector `milestone` in its API. This project uses `eraMilestone` internally. The external query parameter and response field remain `milestone` for API compatibility; they all represent the same numeric era selector, where `1` = Rare, `2` = Epic, `3` = Mystic, and `4` = Final.

### Runtime terminology

- **Application**: Axie Echelon, the leaderboard monitoring dashboard.
- **Tracker instance**: One running copy of the application.
- **Tracker profile**: The configuration selected by one tracker instance.
- **Leaderboard window**: The rank range displayed by a profile.
- **Activity estimate**: A heuristic prediction based on recent completed battles.

## Technology and Architecture

- Frontend: vanilla JavaScript, Vite 6.x, plain CSS, PIXI.js 7, Spine runtime.
- Backend: Node.js ES modules and Express 4.
- Data source: Sky Mavis REST and GraphQL APIs.
- Persistence: none; backend caches are in-memory, browser leaderboard data uses `sessionStorage`.
- Communication: frontend calls backend REST endpoints through the Vite `/api` proxy.
- Entry points: `src/main.js` and `server.js`.
- Feature boundaries:
  - `src/leaderboard/`: leaderboard state, rendering, live polling, activity/rank filters, rune filter.
  - `src/axieLookup/`: Axie ID/address lookup, collectible filters, pagination, cards.
  - `src/shared/`: formatting and shared morph-render queue/cache.
  - `src/server/`: backend routes, services, API clients, caches, concurrency, and configuration.

## Implemented Features

- Leaderboard display with rank, player name, MMR, win rate, daily change, recent form, team previews, rune badges, profile links, and last ranked-battle time.
- Live mode polling with configurable interval and activity windows from 0 seconds through 20 minutes.
- Season/era resolution from `src/data/season.json`; the backend exposes `/api/season/current`. Internally, the numeric value is called `eraMilestone`; at the Sky Mavis API boundary it is sent as `milestone` and explicit `?milestone=` overrides remain supported. The frontend checks immediately at startup and once every 24 hours afterward.
- Live-mode freshness model:
  - profile/address data is cached for a long TTL;
  - team composition is cached separately;
  - `lastRankedBattleTime` is read from the current live battle-log fetch and is never reused from an older timestamp when that fetch fails;
  - failed live fetches return `battleTimeFetchFailed: true` and may retain the last-known team composition.
- Compact leaderboard mode for substantially denser rows.
- Rune catalog and rune scanning across ranks 1-200.
- Axie ID lookup and Ronin-address lookup with client/server pagination.
- Collectible classification for Origin, MEO, Agamogenesis, Nightmare, Mystic, Shiny, Summer, Japan, and Xmas.
- Ronin address lookup prefers marketplace GraphQL ownership results and falls back to the Origins user-fighters API when GraphQL returns no Axies.
- Collectible detection uses the actual Axie `title`, marketplace `parts[].specialGenes`, compact Origins `part_skin` values, and supported gene decoding. Axie names are not used as titles, and `Morphed` alone does not make an Axie collectible.
- Address results are deduplicated by Axie ID and filtered before client-side pagination, so filtered pages contain only matching Axies.
- Bounded morph-render concurrency and per-gene render caching.
- Backward-compatible single instance:
  - `npm run dev`
  - frontend `127.0.0.1:5173`
  - backend `127.0.0.1:8787`
- Profile-driven multi-tracker development using `.env`; each instance selects a numbered `TRACKER_PROFILE` and receives isolated runtime settings.
- Five predefined PowerShell launch scripts for local multi-window testing; the profile resolver itself supports additional contiguous profile numbers.
- Phase 3 candidate-pool implementation is in progress: 3a (backend ceiling/cache constants) and 3b (full-pool loading) are implemented; 3c (client-side filtering), 3d (pagination), and 3e (narrow-then-enrich rune/body-part filtering) remain.

## Backend Routes

- `GET /api/leaderboard`: legacy eager-enrichment leaderboard; `liveMode=true` bypasses the page cache and fetches fresh battle logs.
- `GET /api/leaderboard/pool`: cheap rank/name/MMR candidate pool.
- `GET /api/leaderboard/team/:userID`: on-demand enrichment status endpoint.
- `GET /api/leaderboard/rune/:runeId`: rune scan through rank 200.
- `GET /api/runes`: generated rune catalog.
- `GET /api/axie/:id`: Axie lookup and normalization.
- `GET /api/axie-detail/:id`: GraphQL Axie detail.
- `GET /api/address/:address`: Ronin-address lookup.

### Ronin address lookup data flow

`GET /api/address/:address` resolves the profile, then calls the reusable `fetchAxiesOwnedByAddress(ownerAddress)` function in `src/server/shared/marketplaceAxieClient.js`. That function queries the marketplace GraphQL `axies(...)` connection with the Marketplace profile's `delegationFilters`, so the inventory includes Axies directly owned by the address and Axies delegated to it. The route preserves that GraphQL inventory and total, then enriches matching Axie IDs with the Origins community fighters endpoint so address results receive `genesMetamorph` and morphable part data. If GraphQL returns no Axies, the route uses the fighters endpoint as a list fallback.

The route normalizes and classifies the complete source result, removes duplicate Axie IDs, and returns the full dataset to the frontend. The Morph Viewer applies collectible/tag filters first and paginates the filtered results afterward.

An Axie is considered collectible when it has at least one verified collectible tag other than the internal `Morphed` marker. Current tags include `Origin`, `MEO`, `Agamogenesis`, `Nightmare`, `Mystic`, `Shiny`, `Summer`, `Japan`, and `Xmas`. Nightmare parts are identified from `specialGenes: "Nightmare"` or compact Origins `part_skin` values `12` (Nightmare) and `13` (Nightmare Shiny).

## Known Issues and Limitations

### Confirmed or unresolved

- Live-mode page reload bug remains unresolved. It resets live mode, compact mode, and other in-memory UI state. Possible areas include browser/Vite HMR behavior, extensions, or runtime/network handling; the root cause is not established.
- Live activity filtering excludes players whose current battle-time fetch fails because their timestamp is intentionally `null`. This is a deliberate accuracy policy but remains a product decision: show them as unavailable versus exclude them.
- The frontend still uses the legacy eager `/api/leaderboard` route. The pool plus on-demand team endpoints exist but are not yet integrated into the main leaderboard UI.
- Rune-scan output is not paginated and is limited to ranks 1-200.
- Frontend and backend each define the rank scan ceiling; they must be kept synchronized manually.
- Several related in-memory caches coexist during migration: legacy team cache, team-composition cache, enrichment cache, profile cache, page cache, and candidate cache.
- Compact-mode preference is not persisted across a full page reload.
- PIXI/Spine makes the production bundle large. `npm run build` succeeds but reports a chunk over 500 KB.
- There are no comprehensive automated browser tests.
- Firefox extension/listener warnings were previously observed and are not yet proven related to the reload bug.

### Technical debt

- `server.js` and `src/main.js` are now thin, but `leaderboardView.js` and several backend modules still contain substantial mixed UI/business-flow logic.
- The legacy eager enrichment route and Phase 1 on-demand route coexist.
- Battle-log retry/concurrency behavior is implemented manually and needs runtime stress testing.
- API keys must remain outside version control; `.env.example` should be maintained if onboarding is needed.

## Important Files

- `server.js`: backend entry point, middleware, router mounting, shutdown handling.
- `src/main.js`: frontend entry point and page-reload diagnostics.
- `vite.config.js`: frontend port and backend proxy configuration.
- `src/leaderboard/leaderboardView.js`: leaderboard coordinator, hydration, initialization, and live-mode wiring.
- `src/leaderboard/leaderboardRenderer.js`: leaderboard rows, team previews, and relative-time refresh.
- `src/leaderboard/leaderboardFilters.js`: rank and activity filtering.
- `src/leaderboard/leaderboardRuneFilter.js`: rune catalog, suggestions, scan results, and reset behavior.
- `src/leaderboard/leaderboardState.js`: leaderboard state, constants, and DOM references.
- `src/axieLookup/axieLookupView.js`: Axie lookup UI, cards, filters, and pagination.
- `src/axieLookup/axieLookupState.js`: lookup state and DOM references.
- `src/shared/morphRenderer.js`: shared bounded PIXI render queue/cache.
- `src/renderer.js`: actual PIXI/Spine Axie renderer.
- `src/pagination.js`: shared pagination helper.
- `src/server/shared/env.js`: dotenv loading and environment-derived configuration.
- `src/server/shared/graphqlClient.js`: shared GraphQL transport, authentication, response parsing, and error handling.
- `src/server/shared/marketplaceAxieClient.js`: reusable marketplace GraphQL Axie queries and owner result normalization/deduplication.
- `src/server/shared/profileClient.js`: reusable marketplace profile queries.
- `src/server/leaderboard/leaderboardEnrichment.js`: live/non-live enrichment behavior.
- `src/server/leaderboard/leaderboardCaches.js`: cache implementations and sweep.
- `src/server/leaderboard/battleLogClient.js`: battle-log API calls, retry, and deduplication.
- `src/server/leaderboard/leaderboardRoutes.js`: leaderboard endpoint definitions.
- `src/eraResolver.js`: validates the configured season and computes its current era/milestone.
- `src/data/season.json`: manually maintained season start, end, era durations, and era names.
- `scripts/list-seasons.mjs`: maintenance helper for generating the next season configuration.
- `src/server/leaderboard/enrichmentCache.js`: on-demand enrichment state model.
- `src/server/shared/profileCache.js`: cached profile/address resolution.
- `.env.example`: shared local configuration template; copy it to `.env` and never commit secrets.
- `start-all-trackers.ps1`: launches the five predefined local tracker instances.
- `start-tracker1.ps1` through `start-tracker5.ps1`: select one numbered tracker profile and start the development process.
- `stop-all-trackers.ps1`: broad local cleanup helper that stops all Node.js processes; use with care.
- `docs/planning/leaderboard-roadmap.md`: planned pagination and future leaderboard direction.
- `docs/planning/cache-and-polling-strategy.md`: cache/polling design notes.

## Running and Verification

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Current verified checks:

```powershell
npm run build
```

The Vite build succeeds. All current relative JavaScript import targets resolve, and the backend leaderboard module graph loads with Node. A browser smoke test is still required.

## Recommended Next Steps

1. Reproduce and diagnose the live-mode page reload with browser console and network logs.
2. Run a complete browser smoke test for both lookup and leaderboard flows.
3. Decide the intended UI behavior when a live battle-time fetch fails.
4. Integrate `/api/leaderboard/pool` and `/api/leaderboard/team/:userID`, then retire eager enrichment.
5. Consolidate cache ownership and unify the rank ceiling.
6. Add browser/API tests and consider code-splitting PIXI/Spine.
