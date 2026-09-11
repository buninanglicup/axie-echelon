# Recovery and Consolidation Postmortem

This document records the technical recovery work that consolidated Axie Echelon
around one unified application and restored the supporting data workflows. It is
historical context, not current setup guidance; use [Project Status](../STATUS.md)
for the current state.

## Scope

The recovery consolidated the backend and frontend around these boundaries:

- shared environment, validation, GraphQL, profile, and concurrency services;
- Axie ID and Ronin-address lookup services and routes;
- leaderboard candidate, enrichment, cache, scan, and route modules;
- focused frontend modules for leaderboard, profile, lookup, rendering, and
  shared formatting.

## Technical findings and repairs

### Configuration and validation

- API credentials remain environment-only through ignored `.env` files or
  deployment secret stores.
- Axie IDs are numeric strings. Ronin addresses accept `0x...` and
  `ronin:...` forms and normalize to lowercase `0x...` values.
- Tracker profiles resolve once at process startup. Switching profiles requires
  restarting the process with a different `TRACKER_PROFILE` value.

### API pressure and caches

- Battle-log requests use a shared priority queue and bounded concurrency so
  visible work can take priority over background scans.
- Cache reads enforce their TTLs, and a periodic sweep removes expired team,
  composition, page, profile, enrichment, candidate, and match-duration entries.
- Background refresh failures are contained so temporary upstream errors do not
  become unhandled rejections.
- On-demand enrichment preserves a previous team as `stale` when refresh returns
  no team; a player without a previous team becomes `failed`.
- Concurrent enrichment requests for the same player share in-flight work.

### Lookup and leaderboard behavior

- Axie ID lookup uses the Fighters API first, with GraphQL ownership and detail
  fallback. Delegated Axies search the delegatee account before owner fallbacks.
- Address lookup uses Marketplace GraphQL delegation filters, merges Origins
  fighter metadata by Axie ID, deduplicates results, and applies filters before
  client-side pagination.
- Non-live leaderboard browsing uses the candidate-pool and progressive team
  pipeline. Live mode remains on the legacy eager route while its migration is
  designed and tested separately.
- Rune and body-part scans use asynchronous jobs with bounded work, progress,
  cancellation, partial results, and scope/source-aware deduplication.

### Registry and rendering recovery

- The rune and charm generators were restored as paginated Sky Mavis catalog
  refresh workflows. Generated registries are checked in; credentials and raw
  captures are not.
- Shared morph rendering uses bounded work and cached static snapshots for
  repeated gene inputs.
- Historical snapshots are local-only, immutable, operator-accepted evidence.
  Historical reads never fall back to live data.

## Verification

Recovery work was checked with focused Node syntax checks, the production Vite
build, deterministic tests, cache/concurrency tests, registry checks, and
snapshot metadata verification. Current validation commands are maintained in
[Project Status](../STATUS.md).

## Remaining lessons

- Run a real bundler build after module moves; syntax checks do not resolve
  relative import paths.
- Keep live freshness fields separate from cached team and profile data.
- Treat incomplete upstream evidence as unknown or partial rather than inventing
  matches or presenting stale values as current.
- Keep generated catalogs and local raw captures distinct: generated metadata may
  be reviewed and committed, while credential-bearing or real-user captures stay
  local and ignored.
