# Axie Echelon: Current Project Handoff

**Last verified:** 2026-09-04

This is the canonical current-status document. `PHASE1_SPLIT_SUMMARY.md` records the historical refactor. Older snapshots are retained under `docs/history/`; they are not current project instructions.

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
- Rune catalog and asynchronous rune scanning across the configured top-1000
  rank range, with polling, partial results, cancellation, deduplication,
  Retry-After-aware battle-log retries, and client-side result pagination.
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
- Phase 3 candidate-pool implementation: 3a (backend ceiling/cache constants), 3b (full-pool loading), 3c (client-side filtering), 3d (pagination), and 3e rune narrowing are implemented. Non-live visible rows progressively request team data and reuse the existing morph renderer. Body-part mapping, predicate, and local scanner groundwork are implemented; async job, route, and UI work remain. Morph completeness still requires manual verification against real ranked-battle payloads.
- Body-part filtering is the next filter milestone. The current design uses local
  gene decoding from existing battle-log fields, canonicalizes collectible
  variants such as `Yen` under base part `Sleepless`, and reuses the rune-scan
  job model only after decoder/mapping validation. No extra per-fighter API
  lookup is planned for the normal top-1000 path. See
  `docs/implementation/body-part-filtering.md`.
- Body-part mapping validation is complete for the current reviewed evidence. The captured `ListUserFighters.json`
  fixture currently produces 120 exact dominant ID/class matches across 20
  fighters with no unknowns or mismatches using the local decoder. This confirms
  the captured 512-bit layout only; canonical names, variants, and 256-bit
  coverage remain open for newly encountered variants. The validator is `scripts/validate-body-part-mapping.mjs`
  and its structural regression is included in `src/geneDecoder.test.js`.
- A GraphQL name-bearing sample is now captured in
  `api-responses/body-part-name-validation.json`. It covers five 256-bit Axies
  and 30 named parts; 28 match decoder IDs through same-class/same-slot card
  candidates, while `Hazy` and `Yakitori` have no card candidate. These are
  corroborated samples only, not a complete canonical mapping.
- Four collectible-focused marketplace profiles produced a larger offline
  evidence fixture at `api-responses/body-part-profile-validation.json`: 1,596
  Axies, 9,576 named parts, 192 verified structural keys, and zero decoder
  class/slot mismatches. The generated
  `src/data/body-part-mapping-candidate.json` assigns one untagged base name to
  all 192 keys and preserves collectible names with their observed
  `specialGenes` metadata as variants. It remains candidate-only until broader
  captures and canonicalization review are complete.
- `src/bodyPartMapper.js` now provides a canonical/variant lookup over
  that candidate file, with focused tests included in `npm test`. It is not yet
  wired into an HTTP route or the UI.
- `src/bodyPartFilter.js` now provides the local fighter predicate: it prefers
  `genes_metamorph`, falls back to `genes`, matches canonical or verified
  variant names with OR semantics, and exposes whether the gene data was known.
  Starter/legacy records without mapper entries do not produce confirmed
  matches. The predicate is tested but not yet wired into a route or UI.
- `src/server/leaderboard/bodyPartScanner.js` now applies the predicate to
  narrowed leaderboard candidates while reusing team caching, battle-log
  enrichment, bounded batches, and progress callbacks. Its focused tests pass;
  the async job lifecycle is now implemented; HTTP route integration remains
  next.
- `src/server/leaderboard/bodyPartScanJobs.js` provides queued/running/complete/
  partial/failed/cancelled lifecycle state, selection deduplication, heartbeat
  cleanup, cancellation, watchdog timeouts, partial results, and progress
  polling. Its focused lifecycle suite is included in `npm test`.
- `src/server/leaderboard/leaderboardBodyPartScanRoutes.js` now exposes
  asynchronous start/status/cancel endpoints with body-part validation, era
  resolution, rank clamping, and public job snapshots. The filter UI remains
  future work.
- The larger ignored rune-scan capture contains 2,733 fighter records and 2,727
  unique gene strings; all decode successfully and 16,342 of 16,362 dominant
  parts map to the candidate file. The 20 unmapped low-ID parts belong to
  legacy/starter records, including Axies 1-3 with `genes: "0x0"` and no
  GraphQL parts. They remain unknown by policy. See
  `scripts/validate-body-part-log-coverage.mjs`.
- Leaderboard morph field behavior is documented in `docs/implementation/leaderboard_enrichment.md`: collectible Axies prefer `genes_metamorph`, non-collectible Ronin Axies use `genes`, anomalous collectible nulls fall back to `genes`, and starter Axies are currently name-only pending a starter-specific renderer. These rules apply only to leaderboard team previews; the separate Morph Viewer is unchanged.
- The leaderboard Rune Filter is a searchable multi-select. It stores stable rune IDs, displays removable image/name chips, prevents duplicates, and applies OR semantics across selected runes. Typing only searches the catalog; selecting or removing a chip updates leaderboard results. The Morph Viewer is not affected.

## Backend Routes

- `GET /api/leaderboard`: legacy eager-enrichment leaderboard; `liveMode=true` bypasses the page cache and fetches fresh battle logs.
- `GET /api/leaderboard/pool`: cheap rank/name/MMR candidate pool.
- `GET /api/leaderboard/team/:userID`: on-demand enrichment status endpoint.
- `POST /api/leaderboard/rune-scan`: start or deduplicate an asynchronous rune scan.
- `GET /api/leaderboard/rune-scan/:jobId`: poll scan status and partial results.
- `DELETE /api/leaderboard/rune-scan/:jobId`: request best-effort cancellation.
- `GET /api/runes`: generated rune catalog.
- `src/data/cards.json`: manually refreshed card catalog reference; it is not
  currently used to resolve Axie body-part identities.
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
- Rune multi-select and OR matching are working. Top-30 and top-100 scans return results, including multiple selected runes. Top-1000 scans can become `partial` when the 300-second watchdog expires because live battle-log retries honor upstream `Retry-After` delays. Diagnostics show candidate fetching is fast, battle-log enrichment is the bottleneck, and concurrency four currently outperforms two in candidates per minute.
- Rune-scan output is paginated client-side and scans the configured top-1000 candidate pool. A `complete` job guarantees full requested coverage; a `partial` job explicitly does not. Partial jobs are not resumable yet.
- Frontend and backend each define the rank scan ceiling; they must be kept synchronized manually.
- Several related in-memory caches coexist during migration: legacy team cache, team-composition cache, enrichment cache, profile cache, page cache, and candidate cache.
- Compact-mode preference is not persisted across a full page reload.
- PIXI/Spine makes the production bundle large. `npm run build` succeeds but reports a chunk over 500 KB.
- There are no comprehensive automated browser tests.
- Firefox extension/listener warnings were previously observed and are not yet proven related to the reload bug.

### Technical debt

- `server.js` and `src/main.js` are now thin, but `leaderboardView.js` and several backend modules still contain substantial mixed UI/business-flow logic.
- The legacy eager enrichment route and Phase 1 on-demand route coexist.
- Battle-log retry/concurrency behavior is implemented manually and has been
  measured against live data. Retry-After-aware bounded retries are in place;
  further tuning should compare completed candidates per minute and API retry
  pressure rather than raw request count alone.
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
npm test
npm run build
```

The explicit suite passes 32 tests and the Vite build succeeds. All current
relative JavaScript import targets resolve, and the backend leaderboard module
graph loads with Node. A browser smoke test is still required.

## Recommended Next Steps

1. Validate the independently ported body-part gene mapping and canonical
   variant normalization before adding a body-part scan route. See
   `docs/implementation/body-part-filtering.md`.
2. Design resumability for terminal partial rune-scan jobs if full coverage
  after a timeout is required.
3. Review the ignored real capture locally if actual data-shape inspection is
  needed; never commit it.
4. Reproduce and diagnose the live-mode page reload with browser console and
  network logs.
5. Run a complete browser smoke test for both lookup and leaderboard flows.
6. Decide the intended UI behavior when a live battle-time fetch fails.
7. Add browser/API tests and consider code-splitting PIXI/Spine.
