# Security Notes

Last reviewed: 2026-09-11

## Skymavis API key handling

The previously exposed Sky Mavis API keys have been revoked and rotated. The
replacement keys are stored only in the ignored local `.env` file and must not
be copied into tracked files or shared outside the intended deployment
environment.

Keep credentials only in ignored `.env*` files, shell environment variables, or
a deployment secret manager. `.env.example` may document variable names and
placeholder values, but it must never contain a usable key. Never commit keys
in documentation, scripts, fixtures, screenshots, terminal output, or commit
messages.

### If a key is exposed

Treat an exposed key as compromised, even if it was visible only briefly:

1. Revoke the exposed key in the Sky Mavis dashboard.
2. Generate a replacement key and update only the ignored local `.env` file or
	deployment secret store.
3. Search the working tree, Git history, logs, fixtures, screenshots, and
	generated artifacts for the old value.
4. Review `.gitignore` and tracked files before publishing.
5. Do not rely on deleting the current file; exposed Git history remains
	compromised until it is removed or the repository history is replaced.

## Local historical snapshot exception

Raw historical leaderboard and battle-log payloads may be archived locally
under the gitignored `data/snapshots/` directory for normalization and recovery.
This is an intentional local-data exception, not permission to publish the
payloads. Snapshot files must never contain request headers, API keys, or
credentials, and must never be committed, uploaded, copied into fixtures,
written to logs, or included in documentation. Tests use synthetic,
anonymized fixtures only. Run `npm run check:snapshots` before publishing
changes.

## Pre-publication checklist

- [ ] All API keys used during local development have been revoked or rotated
	if they were exposed.
- [ ] `.env*` files containing real credentials are ignored and untracked.
- [ ] No credentials appear in source files, documentation, fixtures,
	screenshots, logs, or commit messages.
- [ ] Local raw snapshots and API captures are excluded from the published
	tree.
- [ ] `npm run check:snapshots` passes for snapshot-related changes.
- [ ] `npm test`, `npm run build`, and `git diff --check` pass.