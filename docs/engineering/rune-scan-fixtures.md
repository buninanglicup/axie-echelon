# Leaderboard Scan Fixtures

The committed rune fixture at
`src/server/leaderboard/__fixtures__/season18-rune-scan.fixture.json` is a
small synthetic dataset for deterministic offline leaderboard scan tests. It
covers multiple enrichment batches, matching and non-matching runes, absent
teams, and a simulated battle-log failure.

All IDs and names in the committed fixture are synthetic (`user-fixture-NN`, `Fixture Player NN`) and must stay that way. Never copy real user IDs or names into the committed fixture, even from a trimmed real capture. The offline fetch adapter at `src/server/leaderboard/__fixtures__/runeScanFixtureFetch.js` maps fixture candidates, teams, and errors onto realistic `season-leaderboards` and `battle-logs` responses, so production scanner and job code runs unmodified.

Run the fixture tests with:

```text
npm test
```

The real top-1000 capture script is manual-only and writes to the ignored `api-responses/` directory:

```text
node scripts/capture-rune-scan-fixture.mjs <eraMilestone>
```

The capture contains real response-derived data and must never be committed. It is for local inspection only. For timing the live async job without capturing a file, use:

```text
node scripts/live-rune-scan-benchmark.mjs <eraMilestone> <runeId>
```

The committed fixture tests measure deterministic behavior and job mechanics,
not live Sky Mavis latency or rate limits. Batch size, pause, and concurrency
should be tuned only after comparing fixture results with explicit live
benchmark runs.

## Body-part scan fixtures

Body-part scans do not use a second committed synthetic fixture adapter. The
scanner tests load `api-responses/body-part-name-validation.json` for a
gene/name example, then provide mocked candidate and battle-log responses to
verify canonical and variant matching, rank/name narrowing, cache reuse, and
unknown-fighter counts.

The body-part job lifecycle tests inject a scanner seam instead of mocking the
network. This keeps job-state tests focused on queueing, deduplication,
cancellation, heartbeat cleanup, watchdog behavior, and terminal statuses.
The body-part scanner and job tests therefore complement the shared rune
fixture rather than requiring a duplicate full dataset.

## Current live findings

The opt-in benchmark diagnostics are enabled with:

```powershell
$env:RUNE_SCAN_DIAGNOSTICS="true"; node scripts/live-rune-scan-benchmark.mjs 3 rune_aquatic_40082_s18
```

In the recorded benchmark, the candidate pool was not the bottleneck; it took
about 3.4 seconds for ten requests. Battle-log enrichment reached the
configured concurrency of four, but live retryable responses included
`Retry-After` and requested multi-second delays. Battle-log retries now honor
that header and cap per-request retry delay and cumulative retry sleep. A
concurrency comparison found that four concurrent requests completed more
candidates per minute than two, despite producing more retries, so the default
remains four. These timings are observations from a live run, not guarantees.

Watchdog-limited scans finish as terminal `partial` jobs and preserve their
matches and progress. Partial jobs are not resumable yet; a later request
starts a fresh scan. The ignored real capture remains local-only and must not
be added to the repository.
