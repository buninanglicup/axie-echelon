# Historical snapshot archival

Snapshots are durable local archives, not live caches. Numeric eras use a
scope key such as `season:19:milestone:4`; Offseason is never a snapshot
scope. The MVP archives ranks 1-1000 and must describe that range explicitly.

Candidate freezing is the first upstream-facing phase. It requests only
`/origins/v2/season-leaderboards` with a numeric milestone and 100-row pages.
It does not use the volatile candidate cache, fetch battle logs, or change the
UI. Each successful page updates the manifest, so cancellation or restart can
resume at the next page without refetching frozen pages.

Candidate freezing and the archival battle-log client/worker are implemented
as separate phases. The worker remains separate from live enrichment: it
requests one recent `limit=20` page, matching the established live-client
request shape after the initial `limit=100` archival attempt received upstream
`400` responses. This is a deliberately best-effort Season 18 recovery
strategy, not a claim of full history; the client preserves raw data and
classifies coverage conservatively. The historical team UI reads only an
explicitly accepted snapshot for a manually selected numeric era. It never
falls back to live enrichment: unavailable or unverified archival evidence is
shown as unavailable instead. Verified archival pagination and scheduled
end-of-era capture remain pending.

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

The documented endpoint is paginated, but archival pagination has not yet been
implemented or verified. The current one-page recovery capture therefore uses
`limit=20`; delayed Season 18 records are expected to be `partial` or
`unknown` and must be labelled “best-effort currently available battle logs.”

## Immutability and recovery

Candidate pages and successful player records are write-once. Failure attempts
are independent immutable files. A partial or cancelled capture may resume
pending/retryable players; a completed capture never changes or refreshes.
A later recovery creates a new capture ID and revision, preserving the earlier
evidence.

### Correcting a capture without refetching

Snapshots made before an era window was recorded are not suitable for a
historical team view: the stored ranked-battle count could include battles
outside that era. `reclassify` creates a new, linked revision from the source
capture's immutable local raw files and normalizes it against the configured
era window. It makes no upstream request and leaves the source unchanged:

```text
npm run snapshot:capture -- reclassify --season 19 --milestone 4 --capture <source-capture-id>
```

Review the resulting status and explicitly accept the derived capture before
the historical UI can use it. Its `eraCoverage` remains conservative; a
bounded count is not proof that the one-page API response contains the entire
era.

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

## Local operator workflow

Install dependencies, then run the capture command from the repository root:

```text
npm run snapshot:capture -- start --season 19 --milestone 4 --dry-run
npm run snapshot:capture -- start --season 19 --milestone 4
npm run snapshot:capture -- status --season 19 --milestone 4 --capture <capture-id>
npm run snapshot:capture -- resume --season 19 --milestone 4 --capture <capture-id>
npm run snapshot:capture -- accept --season 19 --milestone 4 --capture <capture-id>
npm run snapshot:capture -- reclassify --season 19 --milestone 4 --capture <source-capture-id>
```

The MVP always captures ranks 1-1000. `--dry-run` checks the ignored,
writable snapshot boundary, probes the first seasonal leaderboard page, and
makes one non-persisted archival battle-log request at `limit=20`. It prints
only aggregate probe metadata, not a user ID or raw payload. This catches an
upstream battle-log request failure before a 1,000-player capture begins. It
creates no capture and stores no battle logs. `start` freezes candidates
and then archives battle logs. `Ctrl+C` records a cancelled, resumable
capture; `resume` retries only unfinished players. Final output reports the
capture ID, candidate scope, successful/failed/pending players, and coverage
totals. Season 18 results must be labelled “best-effort currently available
battle logs” unless coverage metadata proves otherwise.

`accept` is a local, credential-free operator action. It can mark only a
completed capture as the explicitly accepted revision in its era scope index.
This is a review decision: accepting a capture does not alter its immutable
raw or normalized files, and a later recovery capture may supersede it.

`reclassify` is also local and credential-free. It requires a completed source
capture in the same configured season and milestone, copies its raw evidence
into a new revision, and recalculates normalized ranked battles using the
shared `src/eraResolver.js` boundary source.
