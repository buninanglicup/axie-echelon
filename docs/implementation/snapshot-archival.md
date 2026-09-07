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
classifies coverage conservatively. A manually selected historical UI reads
only an explicitly accepted snapshot for its frozen leaderboard rows and team
evidence. It never falls back to upstream candidates or live enrichment:
unavailable or unverified archival evidence is shown as unavailable instead.
Live mode is disabled while viewing an archive. Verified archival pagination
remains pending; compact scans and end-of-era capture are deliberately
best-effort rather than claims of exhaustive era history.

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

## Historical leaderboard reads

`GET /api/leaderboard/pool?milestone=N&historical=1` is an internal UI path
for a manually selected numeric era. It reads the accepted snapshot's frozen
candidate pages and returns the captured rank/name/MMR records. It does not
call the upstream candidate client. If an accepted, era-bounded snapshot is
absent, it returns `HISTORICAL_SNAPSHOT_UNAVAILABLE`; the UI renders a
snapshot-unavailable state rather than a later seasonal leaderboard.

Historical team rows and filters use the same accepted capture. A manual
historical rune/body-part request uses the normal asynchronous job lifecycle
with `historical=1`, but its scanner reads only local frozen candidates and
normalized captured teams; it never calls the candidate, enrichment, or
battle-log clients. Its deduplication source is distinct from an upstream scan
even when both requests have the same numeric era scope.

Historical team previews show only normalized provenance: the selected battle
timestamp, the time that player's evidence was captured, and the capture's
coverage classification. `partial` and `unknown` explicitly say that the
archive is not exhaustive era history. Raw battle payloads, checksums, request
headers, and credentials are never sent to the browser.

Historical filter semantics remain unchanged: multiple runes are OR, multiple
body parts are OR, and the frontend intersects rune and body-part result sets
with AND. A player without accepted archived team evidence is an unknown
non-match, not proof that the player did not use a rune or body part. Results
therefore mean “matches in captured historical teams,” not complete era usage.

## Compact future-capture snapshots

Future archival captures intentionally do not store the full recent battle-log page for each player. Instead, for each candidate in ranks 1-1000, the worker keeps the frozen candidate page and selects at most one ranked battle observed for that tracked player within the era window. The saved record is described as:

> “Captured team from the latest observed ranked battle in this era.”

This wording is intentionally limited: it records the latest observed ranked battle in the era for that player, not the player's final team or the complete era history. The capture is evidence-based, compact, and immutable.

The compact record contains two separate persisted values:

- the raw selected battle object (if one is observed), stored as a single immutable raw record;
- a normalized selected-team record used by the UI/filtering and by historical evidence readers.

If no valid in-era ranked battle can be selected, the system writes an immutable `unavailable` evidence record instead of substituting live data.

### Compact player-evidence metadata

Every player evidence record includes:

- player ID and frozen candidate identity;
- era scope/capture/revision identity;
- era start/end used;
- selection algorithm version and normalizer/schema version;
- selected battle ID if present;
- selected battle timestamp;
- source endpoint identifier only;
- capture timestamp;
- requested limit, fetched-log count, ranked-log count;
- oldest/newest returned timestamps;
- response checksum;
- whether the request reached the limit;
- `teamEvidence`: `observed | unavailable | invalid | error`;
- explicit reason code when not observed;
- `eraCoverage`: `complete | partial | unknown`.

The compact record remains local-only under `data/snapshots/`; it never stores API keys, credentials, authorization headers, full sensitive request metadata, or raw query strings.

### Selection algorithm

For each candidate rank, the archival client may fetch one recent page up to the existing safe request limit. It then selects at most one battle per player using:

1. battle is ranked;
2. the tracked player owns one of the teams;
3. battle timestamp is within `[eraStartedAt, eraEndedAt)`;
4. newest timestamp wins;
5. if timestamps tie, use a stable secondary key such as battle ID; if absent, use the stable source-order tie-breaker.

This does not imply the player never had a different team earlier in the era. It is only the latest observed ranked battle evidence captured for that player in this era.

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

## Metadata-only verification

The project includes a read-only verifier for local snapshot metadata:

```text
npm run snapshot:verify
npm run snapshot:verify -- --root /path/to/alternate-snapshot-root
```

This command is intentionally metadata-only. It reads only `index.json` and
`manifest.json` files, checks scope names, accepted capture references, revision
and status consistency, and reports warnings/errors without reading raw battle-log
payloads, raw candidate-page files, `.env` files, credentials, or request headers.
It does not validate raw payload contents or raw checksums, and it does not
repair, prune, or accept snapshots.

## Candidates-only snapshots

When the upstream seasonal endpoint becomes unavailable, a focused candidates-only capture can freeze the top-1000 leaderboard ranks without performing team-enrichment battle-log capture. This mode preserves leaderboard history while deferring or skipping team evidence collection.

### CLI usage

To start a candidates-only capture:

```text
node scripts/snapshot-capture.mjs start --season 19 --milestone 4 --candidates-only
```

The `--candidates-only` flag:
- Freezes the seasonal top-1000 candidate pages using the standard pool endpoint.
- Skips the archival battle-log client/worker entirely.
- Publishes the snapshot as `completed` directly after candidate freezing.
- Requires explicit manual acceptance; never auto-accepts.
- Rejects if an accepted capture already exists for this scope (no replacement yet).

### Manifest metadata

Candidates-only captures set `hasTeamEvidence: false` in the manifest. This field distinguishes:
- `hasTeamEvidence: true` (or absent) — full team-evidence snapshot with battle logs.
- `hasTeamEvidence: false` — leaderboard-only snapshot, no team evidence available.

### Historical reading behavior

When a snapshot has `hasTeamEvidence: false`:
- `GET /api/leaderboard/pool?milestone=N&historical=1` — returns frozen candidates as usual.
- Team enrichment requests fail gracefully with a `unavailable` status and a clear error.
- Rune/body-part scans fail without fallback to live enrichment or upstream battle logs.
- The UI shows unavailable team state instead of attempting fallback.

No network fallback or live enrichment occurs; the snapshot's scope boundary is strict.

## Retention and backup policy

Snapshot artifacts are intentionally local-only under the gitignored
`data/snapshots/` directory. The project does not implement automatic deletion,
pruning, or overwriting of snapshot revisions. A conservative default policy is:

- accepted snapshots and superseded revisions are immutable once finalized;
- retention is manual and operator-controlled; no automated pruning is enabled in
  source or startup configuration;
- backups preserve the entire `data/snapshots/` tree, including scope
  directories, manifest files, capture index entries, and revision metadata;
- restoration must target one original scope tree and must not merge unrelated
  scope directories or snapshots from different seasons/era milestones;
- backup verification must confirm directory shape and revision metadata without
  exposing raw contents, credentials, or request-sensitive values;
- future destructive-pruning tooling must remain a separate, explicitly
  disabled feature from the retention policy described here.

This policy deliberately separates retention and backup from any future
"cleanup" automation. Retention is about durable operator custody; pruning is a
separate feature that must never be enabled implicitly or by default.

Backups should be validated by checking metadata-only indicators such as scope
keys, capture IDs, accepted revision markers, and manifest counts, without
opening or printing raw battle payloads or any local `.env` or credential data.
The backup process should preserve the on-disk directory structure exactly as it
exists locally and should never rewrite or merge unrelated snapshot trees.

## Historical UI smoke checklist

There is no maintained browser automation in this repository: the existing
`verify-browser-leaderboard.js` helper is an ad hoc Playwright script and is not
wired into `package.json` or the project dependency set. The project therefore
uses a concise manual smoke checklist rather than claiming automated browser
coverage.

Run the checklist against a local dev instance after a historical snapshot has
been accepted:

1. Start the app normally and confirm the automatic current/offseason view is
   still live/upstream-driven.
2. Select a historical numeric era from the UI (not current/offseason). Confirm
   the view transitions to historical mode and does not silently start live
   upstream candidate or team enrichment.
3. Confirm an accepted snapshot loads the frozen rank/name/MMR rows and no live
   fallback is used when the historical snapshot is accepted.
4. Open a historical player row and confirm the provenance display shows the
   selected ranked-battle timestamp, the evidence capture time, and the
   coverage explanation (`partial` or `unknown` where appropriate).
5. Confirm the historical Rune and Body-Part scan flows use the accepted local
   snapshot evidence only and keep their async job states, filter semantics, and
   source separation from live scans.
6. Confirm Live Mode is disabled while viewing history and live-only controls
   are hidden; the UI must not silently activate a live leaderboard refresh
   while a snapshot is selected.
7. Return to Current and confirm the current/upstream view resumes without stale
   historical rows or mixed snapshot metadata.
8. Confirm the unavailable snapshot state renders clearly when no accepted
   historical evidence exists for the selected era.

This checklist is intentionally minimal and repeatable; it focuses on the core
contract of historical snapshots while preserving the existing live/current
leaderboard behavior and the local-only archival boundary.

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

## Opt-in end-of-era scheduler

The normal application server never starts a capture by itself. An operator
can opt in on one local tracker instance by setting non-secret environment
variables for that process and then starting the server:

```powershell
$env:SNAPSHOT_CAPTURE_SCHEDULER_ENABLED = "true"
$env:SNAPSHOT_CAPTURE_GRACE_MINUTES = "15"
$env:SNAPSHOT_CAPTURE_CHECK_INTERVAL_MINUTES = "15"
npm run start
```

The scheduler uses `getConfiguredEraWindow` from `src/eraResolver.js`, so its
windows use the same authoritative Rare start, calculated intermediate
boundaries, and exact Final/offseason boundary as the application. It checks
at intervals rather than requiring a process to be running at one exact clock
time. Once an era has ended and its grace period has elapsed, it freezes the
top 1,000 seasonal candidates and captures the compact battle-log evidence.

By default, an instance enabled after downtime considers only the most
recently ended era. This prevents an unexpected four-era recovery run after a
season. To deliberately recover every missing ended era, add:

```powershell
$env:SNAPSHOT_CAPTURE_CATCH_UP = "true"
```

Each scheduler decision is protected by a scope-level filesystem lock, while
manifest writes retain their per-capture lock. Multiple local instances sharing
the same snapshot directory therefore do not create competing revisions for
the same era. A completed revision is **not** accepted automatically: the
scheduler reports it as awaiting review, and the operator must run `accept`
before historical UI reads it. An interrupted run is cancelled/resumable and
the next eligible scheduler check resumes its latest incomplete revision.

Only enable this on a machine with the ignored snapshot directory and local API
key already configured. The scheduler does not change `.env`, does not print
credentials, and does not upload or commit snapshot artifacts.
