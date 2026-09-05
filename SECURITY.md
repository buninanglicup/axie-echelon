# Security Notes

Last reviewed: 2026-09-05

## Skymavis API key handling

The current audit found no literal Skymavis API key in the tracked tree,
reachable Git history, or readable local dangling Git blobs. The local keys are
stored in the ignored `.env` file. This result does not rule out exposure
through external copies, old remotes, chat messages, terminal logs, or
screenshots.

Before any GitHub publication:

1. If a key was ever shared outside the ignored local environment, rotate it
	in the Skymavis dashboard and confirm the old key is revoked.
2. Search the clean tree and history for key-shaped values.
3. Confirm `.env*` files and raw API captures remain ignored.
4. Publish only the cleaned tree; use fresh history if an external exposure is
	confirmed.

Keep credentials only in ignored `.env*` files, shell environment variables, or
a deployment secret manager. Never commit keys in documentation, scripts,
fixtures, screenshots, or commit messages.