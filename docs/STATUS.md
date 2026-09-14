# Project Status

_Last reviewed: 2026-09-11_

## Current State

Axie Echelon is a local Axie Origins leaderboard analysis dashboard. It uses a Vite frontend on `127.0.0.1:5173` and an Express API on `127.0.0.1:8787`, with the frontend calling the backend through the Vite `/api` proxy.

The current implementation supports leaderboard browsing, current and historical season scopes, live activity estimates, rune and body-part scans, player profiles, and Axie or Ronin-address lookup. Live activity labels are heuristics derived from completed ranked battles; they do not confirm that a player is currently in a match.

## What's Working

- Current and historical leaderboard scopes with season-era resolution.
- Rank, activity, rune, and body-part filtering.
- Asynchronous rune and body-part scans with progress, cancellation, partial results, and deduplication.
- Progressive team enrichment with cached team previews, rune metadata, profiles, and morphed Axie rendering.
- Player battle-history profiles with team, rune, charm, and provenance data.
- Axie ID and Ronin-address lookup with collectible-aware filtering and pagination.
- API safety rails for expensive routes: shared baseline quota, independent `createExpensiveRouteLimiter()` instances on the wallet-lookup and team-enrichment routes, live-mode hourly budget, and request validation for IDs and Ronin addresses.
- Historical snapshot capture, acceptance, verification, and local-only reading.
- Node test coverage for core filters, scan jobs, caching, profiles, snapshots, and route/input hardening.

## Completed hardening tasks

- Task A: userID validation is implemented and verified.
- Task B: `/api/address/:address` is hardened with a 1..100 clamp and cache reuse for repeated wallet lookups.
- Task C: `baselineLimiter`, independent expensive-route per-route limiters, and `liveModeLimiter` with IPv6-safe key generation are live and in use.
- Task D: confirmed that `profileCache.js` does not cover the address lookup path, which is why the route-level protections were needed.
- Task E: `validators.test.js`, `rateLimiters.test.js`, `axieRoutes.test.js`, and `leaderboardEnrichmentRoutes.test.js` all pass under the repo's real `node:test` + Express + `fetch()` convention.

## Known Issues and Limitations

- Large live scans can reach the watchdog timeout and finish as `partial`; resumable scans are not implemented.
- Historical scans only use accepted captured-team evidence and do not claim complete era history.
- Snapshot capture and retention remain operator-managed and local-only.
- The leaderboard currently keeps the `MMR` column and does not support a `MOVE`/rank-change column. Rank movement is not part of the active data contract, so any such column must be added only when the backend and UI semantics are clearly defined and verified.
- The PIXI/Spine bundle is large, and the production build reports a chunk over 500 KB.
- Automated browser coverage is incomplete. Existing Playwright checks cover
	selected leaderboard flows but are not part of the standard test command or
	CI.

## Roadmap

1. Add maintained Playwright coverage for the Leaderboard, Player Profile, and
	Morph Viewer workflows.
2. Improve resumability for scans that reach the watchdog timeout.
3. Define and add a supported `MOVE`/rank-change column only when the live data
	contract provides reliable deltas and the UI/UX is validated.
4. Evaluate migrating live mode from the legacy eager leaderboard route to the
	pool/team pipeline while preserving fresh activity timestamps.
5. Reduce initial PIXI/Spine bundle cost through further code splitting.
6. Consider a fixture-backed demo mode for portfolio viewing after safe,
   anonymized leaderboard, profile, lookup, and morph fixtures are prepared.

## Verification

Run the local quality checks before publishing changes:

```powershell
node --test src/server/shared/validators.test.js src/server/shared/rateLimiters.test.js src/server/axieRoutes.test.js src/server/leaderboard/leaderboardEnrichmentRoutes.test.js src/server/profile/profileRoutes.test.js
npm test
npm run build
git diff --check
```

For snapshot-related changes, also run `npm run snapshot:verify` and follow the publication rules in [SECURITY.md](../SECURITY.md).

## Further Reading

- [Engineering documentation index](engineering/README.md)
- [Security policy](../SECURITY.md)
- [Project README](../README.md)
