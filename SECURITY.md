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

## Reverse-proxy and rate-limit safety

IP-based throttling depends on the application seeing the true client IP. If the
backend sits behind NGINX, Cloudflare, a load balancer, or another proxy, set
Express `trust proxy` explicitly and only trust forwarded IP headers from the
expected upstreams. Without this configuration, multiple users behind the same
proxy can share the same limiter bucket and the quota becomes both less accurate
and easier to bypass.

The app uses generic `429` responses with a `Retry-After` header when the rate
limit triggers. These responses should not include stack traces, file paths,
internal service URLs, or sensitive config values. Keep the public response body
and headers minimal and consistent.

## Dependency risk tracking

Track production dependency advisories in the normal release checklist.

- The direct `express` / `qs` advisory path has been addressed through the current dependency override/fix path in `package.json`.
- The remaining `bn.js` advisory is still upstream-blocked through `@axieinfinity/mixer`, which is actively used by the renderer in `src/renderer.js`. This is not an in-app code issue; it requires upstream package remediation before it can be fully resolved.
- Do not set `trust proxy` until the production topology is known. For local-only runs, leaving it unset is the correct default.

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