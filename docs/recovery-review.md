# Current Workspace Recovery Review

This document records the recovery review completed after the local Git
workspace was damaged during an attempted history cleanup. It is intended as
a study guide for understanding what was recovered, what was reconstructed,
and how each boundary was checked.

## Recovery scope

The current workspace is:

```text
C:\Users\Cej\Desktop\axie morph viewer using perplexity
```

The separate public repository was not used for recovery. Local `.env*` files
were preserved on disk but were never copied into the clean public tree.

## Review order

The files were reviewed in dependency order, from configuration to routes and
then up through the frontend:

1. `src/server/shared/env.js` loads `.env` and optional tracker overrides.
2. `src/server/shared/validators.js` normalizes Axie IDs and Ronin addresses.
3. `src/server/shared/concurrency.js` limits battle-log work and prioritizes
   visible requests over background refreshes.
4. `src/server/leaderboard/leaderboardConstants.js` centralizes API limits,
   cache TTLs, and rank ceilings.
5. `src/server/leaderboard/leaderboardCaches.js` stores teams, compositions,
   pages, profiles, enrichment results, and candidate pools.
6. `src/server/leaderboard/enrichmentCache.js` exposes ready, stale, and failed
   on-demand team states.
7. `src/server/leaderboard/runeCatalog.js` maps rune IDs to display metadata.
8. `src/shared/morphRenderer.js` shares cached snapshot rendering.
9. `src/axieLookup/` handles Axie ID/address search, filters, pagination, and
   cards.
10. `src/leaderboard/` handles leaderboard hydration, filters, live mode,
    polling, rune search, and row rendering.
11. `src/server/shared/marketplaceAxieClient.js` resolves direct and delegated
    marketplace ownership.
12. `src/server/axieService.js` performs Axie lookup fallback and
    classification.
13. `src/server/*Routes.js` mounts the preserved REST API surface.
14. `src/main.js`, `index.html`, and `vite.config.js` bootstrap the application.

## Findings and repairs

### Configuration and validation

- Environment configuration is loaded from the shared `.env` file with
  `dotenv`; the former per-tracker override chain was retired during
  consolidation.
- API keys remain environment-only. They must never be placed in source,
  documentation, fixtures, or generated JSON.
- Axie IDs are numeric strings. Ronin addresses accept both `0x...` and
  `ronin:...`, then normalize to lowercase `0x...`.

### API pressure and caches

- The original documented concurrency design requires a shared battle-log
  semaphore. The recovered implementation was missing that enforcement, so a
  priority queue and bounded slot counter were restored.
- High-priority requests are used for visible/current work. Low-priority
  requests are used for background refresh and prefetch work.
- Cache reads enforce their TTLs. A periodic sweep now removes expired team,
  composition, page, profile, enrichment, and candidate-cache entries.
- Background refreshes now catch failures so a temporary upstream error does
  not become an unhandled rejection.
- On-demand enrichment preserves a previous team as `stale` when refresh
  returns no team. A player with no previous team becomes `failed`.
- Concurrent enrichment requests for the same player share one in-flight
  promise.

### Runes

- `src/data/runes.json` was regenerated through the documented API pagination:
  100 records per request, increasing `offset`, stopping at `hasNext=false`.
- The final file contains 876 unique records.
- `runeCatalog.js` converts the raw API `_items` envelope into an ID-keyed map
  with `id`, `name`, `imageUrl`, and `class`.
- Every recovered rune has a name and image URL.
- Refresh instructions are in `docs/rune-registry.md` and the generator is
  `scripts/update-runes.mjs`.

### Lookup and leaderboard behavior

- Axie ID lookup keeps its existing fighter-first behavior and uses GraphQL
  detail only as a final fallback.
- Delegated Axies search the delegatee account before the owner account.
- Address lookup uses the Marketplace GraphQL delegation filters, merges
  fighter metadata, deduplicates by Axie ID, and applies filters before
  frontend pagination.
- The current leaderboard still uses the legacy eager `/api/leaderboard`
  route. The pool and on-demand team routes exist for the planned migration.
- The leaderboard currently supports live polling, rank/activity filters, rune
  search, and session storage caching.
- The player-name search control is wired for clearing but is not yet applied
  as a leaderboard filter. This is an existing product gap, not a recovery
  failure.

### Pagination UI

- Axie lookup pagination uses one shared semantic `<nav aria-label="Pagination">`.
- Client and server lookup modes share condensed page-number rendering.
- Seven or fewer pages show every page. Larger sets show the first, last,
  current, and nearby pages with noninteractive ellipses.
- Native buttons expose `aria-current`, accessible labels, disabled boundaries,
  live status text, and visible keyboard focus.
- The dock is fixed on desktop and safe-area aware on mobile.
- `#results-header` is the smooth-scroll target after page changes, rather than
  scrolling the user back to the search form.

## Validation performed

The following checks were run against the current workspace:

```powershell
node --check server.js
node --check src/main.js
node --check src/server/shared/env.js
node --check src/server/shared/validators.js
node --check src/server/shared/concurrency.js
node --check src/server/leaderboard/leaderboardCaches.js
node --check src/server/leaderboard/enrichmentCache.js
node --check src/server/leaderboard/runeCatalog.js
node --check scripts/update-runes.mjs
npm run build
```

Additional focused checks confirmed:

- Battle-log concurrency never exceeded the configured limit.
- High-priority work was selected before queued low-priority work.
- Cache set/get and expiry behavior worked.
- All 876 rune IDs mapped successfully.
- No relative JavaScript imports were missing.
- No exposed key values remained outside local `.env*` files.

## Known recovery limitations

- The original Git history and detailed commit messages were lost from the
  damaged local repository.
- Several unchanged support modules had to be reconstructed because they were
  not present in the available VS Code snapshots. They are now documented and
  validated, but their byte-for-byte original implementations are unavailable.
- The original rune generator and registry were not recoverable; the generator
  was recreated from the official API contract and the registry was regenerated
  manually with the user’s API command.
- The restored workspace has no historical commits. Do not push it directly.
  Use the separate clean public repository after reviewing this workspace and
  rotating previously exposed Skymavis keys.

## Recovery checklist

- [x] Restore application source files.
- [x] Restore complete rune registry.
- [x] Restore rune generation script and instructions.
- [x] Restore missing backend module contracts.
- [x] Restore cache expiry and concurrency behavior.
- [x] Correct tracker documentation ports.
- [x] Add security documentation and ignore rules.
- [x] Run syntax and production-build checks.
- [ ] Rotate/revoke all previously exposed Skymavis keys.
- [ ] Review the recovered current workspace manually.
- [ ] Copy only the approved clean state into the public repository.
- [ ] Add a GitHub remote and push only after key rotation.