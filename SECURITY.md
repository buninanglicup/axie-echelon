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