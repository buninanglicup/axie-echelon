# Security Notes

Last reviewed: 2026-09-05

## Skymavis API key handling

The current audit found no literal Skymavis API key in the tracked tree,
reachable Git history, or readable local dangling Git blobs. The previously
used local keys have been rotated and remain stored only in the ignored `.env`
file. Confirm `.env*` files and raw API captures remain ignored before future
publishes.

Keep credentials only in ignored `.env*` files, shell environment variables, or
a deployment secret manager. Never commit keys in documentation, scripts,
fixtures, screenshots, or commit messages.

## Local historical snapshot exception

Raw historical leaderboard and battle-log payloads may be archived locally
under the gitignored `data/snapshots/` directory for normalization and recovery.
This is an intentional local-data exception, not permission to publish the
payloads. Snapshot files must never contain request headers, API keys, or
credentials, and must never be committed, uploaded, copied into fixtures,
written to logs, or included in documentation. Tests use synthetic,
anonymized fixtures only. Run `npm run check:snapshots` before publishing
changes.