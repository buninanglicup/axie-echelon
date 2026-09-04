# Rune Scan Fixtures

The committed fixture at `src/server/leaderboard/__fixtures__/season18-rune-scan.fixture.json` is a small synthetic dataset for deterministic offline tests. It covers multiple enrichment batches, matching and non-matching runes, absent teams, and a simulated battle-log failure.

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

The committed fixture tests measure deterministic behavior and job mechanics, not live Skymavis latency or rate limits. Batch size, pause, and concurrency should be tuned only after comparing fixture results with explicit live benchmark runs.

## Current live findings

The opt-in benchmark diagnostics are enabled with:

```powershell
$env:RUNE_SCAN_DIAGNOSTICS="true"; node scripts/live-rune-scan-benchmark.mjs 3 rune_aquatic_40082_s18
```

The candidate pool is not the current bottleneck; it takes about 3.4 seconds
for ten requests. Battle-log enrichment reaches the configured concurrency of
four, but live retryable responses consistently include `Retry-After` and can
request multi-second delays. Battle-log retries now honor that header and cap
per-request retry delay and cumulative retry sleep. A concurrency comparison
found that four concurrent requests completed more candidates per minute than
two, despite producing more retries, so the default remains four.

Watchdog-limited scans finish as terminal `partial` jobs and preserve their
matches and progress. Partial jobs are not resumable yet; a later request
starts a fresh scan. The ignored real capture remains local-only and must not
be added to the repository.
