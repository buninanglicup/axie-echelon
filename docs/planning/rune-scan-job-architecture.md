# Rune Scan Job Architecture

**Status:** implemented 2026-09-04

Rune filtering moved from a blocking top-1000 HTTP request to an in-memory
async job model. The frontend starts a job with `POST
/api/leaderboard/rune-scan`, polls `GET /api/leaderboard/rune-scan/:jobId`,
and requests best-effort cancellation with `DELETE`.

## Decisions

- Full top-1000 coverage remains required; async delivery changes when results
  arrive, not what is scanned.
- Job statuses are the only completeness signal:
  `queued`, `running`, `complete`, `partial`, `failed`, and `cancelled`.
- `complete` means every requested candidate was processed. `partial` means
  the watchdog stopped the job before full coverage; accumulated matches and
  candidate progress remain available, but the result is explicitly
  incomplete.
- Identical active scans deduplicate by milestone, sorted rune IDs, rank range,
  and name filter.
- Progress is candidate-based and reports partial matches while a job runs.
- Consumer presence is renewed by polling heartbeats. Abandoned jobs are
  cancelled by the lifecycle sweep.
- Cancellation is best-effort at batch boundaries. The watchdog produces a
  terminal partial result when a job exceeds its maximum duration, although a
  hung underlying fetch is not physically aborted yet. Partial jobs are
  terminal and are not resumable yet; a later request starts a fresh scan.
- `concurrency.js` remains generic and enforces fairness between high- and
  low-priority battle-log work.

## Testing

The committed synthetic fixture and offline fetch adapter live under
`src/server/leaderboard/__fixtures__/`. The fixture tests cover batching,
progress, matching, absent teams, failed candidates, caching, and job
completion. Real top-1000 captures remain local-only under `api-responses/`;
the capture and live benchmark scripts are manual-only and must not be added
to CI or used as deterministic test inputs.