# Historical snapshot archival

Snapshots are durable local archives, not live caches. Numeric eras use a
scope key such as `season:19:milestone:4`; Offseason is never a snapshot
scope. The MVP archives ranks 1-1000 and must describe that range explicitly.

```text
data/snapshots/
  season-19-milestone-4/
    index.json
    staging/<capture-id>/
      manifest.json
      candidate-pages/0001.raw.json
      candidate-pages/0001.normalized.json
      battle-logs/<sha256-user-id>.raw.json
      battle-logs/<sha256-user-id>.normalized.json
      failures/<sha256-user-id>-attempt-001.json
    captures/<capture-id>/
```

Raw and normalized records are written independently. A capture is staged
first and published by renaming within the same filesystem only after its
terminal manifest is persisted. `index.json` records capture IDs, revisions,
statuses, and the explicitly accepted capture.

## Manifest contract

The manifest contains schema/version and era identity, `captureId`, `revision`,
optional `parentCaptureId`, candidate-scope metadata, progress counters, and a
`battleLogSummary`. Its coverage values are separate from job status:

- `status: completed` means the capture job reached successful termination.
- `eraCoverage: complete` means endpoint pagination/range semantics prove all
  era battles were retrieved.
- `eraCoverage: partial` means the returned range demonstrably does not reach
  the era start or hit the endpoint limit.
- `eraCoverage: unknown` means timestamps or endpoint semantics cannot prove
  coverage.

The current recent-battle endpoint does not provide known historical pagination,
so delayed Season 18 records are expected to be `partial` or `unknown` and
must be labelled “best-effort currently available battle logs.”

## Immutability and recovery

Candidate pages and successful player records are write-once. Failure attempts
are independent immutable files. A partial or cancelled capture may resume
pending/retryable players; a completed capture never changes or refreshes.
A later recovery creates a new capture ID and revision, preserving the earlier
evidence.

Manifest updates are serialized per capture and protected by an exclusive
filesystem lock. Lock files contain only capture ID, process ID, and start
time. Abandoned staging captures remain available for operator recovery.

The raw battle-log payload preserves source data, fetch time, HTTP status,
requested limit, and checksum. It never stores request headers, credentials,
or sensitive full URLs. `genes_metamorphed` is “captured metamorphed genes,”
not guaranteed match-time genes.

The directory is gitignored intentionally. Raw payloads must never enter Git,
fixtures, logs, documentation, or uploads. Only synthetic anonymized fixtures
may be committed. Run the guardrail with:

```text
npm run check:snapshots
```
