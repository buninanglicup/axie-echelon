# Rune Scan Fixtures

The committed fixture at `src/server/leaderboard/__fixtures__/season18-rune-scan.fixture.json` is a small synthetic dataset for deterministic offline tests. It covers multiple enrichment batches, matching and non-matching runes, absent teams, and a simulated battle-log failure.

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
