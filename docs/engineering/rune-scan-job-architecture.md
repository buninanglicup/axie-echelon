# Leaderboard Scan Job Architecture

**Status:** implemented 2026-09-04; shared by rune and body-part scans

Rune and body-part filtering use the same in-memory asynchronous job model.
The frontend starts a job with the feature-specific `POST` route, polls its
status endpoint, and requests best-effort cancellation with `DELETE`.

Rune jobs use `/api/leaderboard/rune-scan` and rune IDs. Body-part jobs use
`/api/leaderboard/body-part-scan` and canonical body-part names. The lifecycle,
heartbeat, watchdog, deduplication, and public status contract are shared in
shape while each feature delegates matching to its own scanner.

## Decisions

- The default scan ceiling is the top 1000 candidates. A requested rank range
  and name filter narrow the candidates processed within that ceiling; async
  delivery changes when results arrive, not how matching is evaluated.
- Job statuses are the only completeness signal:
  `queued`, `running`, `complete`, `partial`, `failed`, and `cancelled`.
- `complete` means every requested candidate was processed. `partial` means
  the watchdog stopped the job before full coverage; accumulated matches and
  candidate progress remain available, but the result is explicitly
  incomplete.
- Identical active scans deduplicate by source, leaderboard scope, sorted
  feature selections (rune IDs or body-part names), rank range, and name
  filter. Historical snapshot scans do not deduplicate with upstream scans.
- Progress is candidate-based and reports partial matches while a job runs.
- Consumer presence is renewed by polling heartbeats. Abandoned jobs are
  cancelled by the lifecycle sweep.
- Cancellation is best-effort at batch boundaries. The watchdog produces a
  terminal partial result when a job exceeds its maximum duration, although a
  hung underlying fetch is not physically aborted yet. Partial jobs are
  terminal and are not resumable yet; a later request starts a fresh scan.
- `concurrency.js` remains generic and enforces fairness between high- and
  low-priority battle-log work.

## Operational defaults

Each feature has the same lifecycle shape and its own job store and scheduler:

| Setting | Default | Purpose |
| --- | ---: | --- |
| Maximum active jobs per feature | 2 | Limits concurrent full scans. |
| Consumer heartbeat timeout | 60s | Abandons queued or running jobs no longer being polled. |
| Finished-job result retention | 300s | Keeps terminal status and partial results available for polling. |
| Lifecycle sweep interval | 30s | Cleans expired results and abandoned jobs. |
| Watchdog duration | 300s | Converts an overlong scan into a terminal `partial` result. |

These job limits are separate from the shared battle-log concurrency limit,
which controls individual upstream requests across leaderboard features.

## Feature-specific behavior

The job layer deliberately does not know how a candidate matches. Rune jobs
delegate to `runeScanner.js`, which checks selected rune IDs. Body-part jobs
delegate to `bodyPartScanner.js`, which decodes genes locally and checks
canonical names and verified variants. Both scanners reuse candidate narrowing,
team caching, bounded enrichment, progress callbacks, and partial-result
semantics.

The body-part implementation is kept in a separate `bodyPartScanJobs.js`
module so its route, public payload names, and test seam remain feature-specific;
it is not a second lifecycle design.

## Testing

The committed synthetic fixture and offline fetch adapter live under
`src/server/leaderboard/__fixtures__/`. The fixture tests cover batching,
progress, matching, absent teams, failed candidates, caching, and job
completion. Real top-1000 captures remain local-only under `api-responses/`;
the capture and live benchmark scripts are manual-only and must not be added
to CI or used as deterministic test inputs.