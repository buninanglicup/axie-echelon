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

## Current dependency status

Last checked: 2026-09-14.

- qs / Express advisory path (GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g): RESOLVED.
  The repo pins `qs` to `^6.16.0` via the `overrides` entry in `package.json`. This was confirmed by `npm audit --omit=dev` and a full test-suite pass.
- bn.js advisory (GHSA-378v-28hj-76wf, infinite loop): NOT YET FIXABLE.
  The installed `@axieinfinity/mixer` version is `1.4.9`, which is the newest published release and still depends on the vulnerable `bn.js` range `5.0.0 - 5.2.2`. This is a wait-for-upstream item; recheck periodically for a new mixer release that bumps its bn.js dependency past `5.2.2`.

## Reverse-proxy and rate-limit safety

IP-based throttling depends on the application seeing the true client IP. This app is currently local-only and not yet deployed to production, so `trust proxy` is intentionally left unset until the real proxy topology is known.

Before deployment behind a reverse proxy, load balancer, or CDN, confirm the actual topology and set Express `app.set("trust proxy", ...)` to match it (for example: `1` for a single hop, or a specific count/CIDR list for multiple hops). Never use a blanket `true`.

The app uses generic `429` responses with a `Retry-After` header when the rate limit triggers. These responses should not include stack traces, file paths, internal service URLs, or sensitive config values.

## Known deferred items

- Trust proxy configuration: deferred until production deployment; see the comment in `server.js`.
- `addressLookupCache.js` only purges stale entries on read access, not via a background sweep; accepted as low-risk for current scale.

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