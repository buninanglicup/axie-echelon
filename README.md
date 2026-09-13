# Axie Echelon

**Beyond the Rank**

Axie Echelon is a local Axie Origins analysis dashboard for studying ranked
players, their battle history, team compositions, rune and charm loadouts, and
Axie collectible data. It combines live Sky Mavis data with accepted local
season snapshots so current and historical views remain distinguishable.

The project is intentionally built around real integration constraints:
upstream rate limits, incomplete data, asynchronous work, stale responses,
and the difference between a current leaderboard and historical season eras.

## Application views

Axie Echelon currently has three main views.

### Leaderboard

The Leaderboard is the main page. It provides:

- Current-season selection with era views for **Rare**, **Epic**, **Mystic**,
  **Final**, and **Offseason**.
- Rank, player-name, body-part, and rune filters that can be combined. Multiple
  values within a filter use **OR** semantics; different filter types intersect
  with **AND** semantics.
- Standard and compact table density modes.
- Optional live tracking with a match-recency window and configurable polling
  interval. Activity labels estimate recent ranked activity from completed
  battles; they do not confirm that a player is currently in a match.
- Team previews, rune metadata, player links, and progressive enrichment.

Only the current season is available today. The season selector is visibly
locked and marked **Previous season access coming soon** because historical
season support depends on the snapshot-archival workflow being completed.

During offseason, the four completed eras are read from accepted local
artifacts while the current offseason leaderboard is the only view that calls
the upstream leaderboard API. When a new season begins, its current era will
use the upstream source; completed eras will become historical snapshot-backed
views after capture and acceptance.

The global player search in the header accepts a Ronin address or client ID and
opens the matching Player Profile view.

### Player Profile

The Player Profile view can be opened from the global search or from leaderboard
player links. With no player selected, it presents a clear prompt to search by
Ronin address or client ID and provides a link back to the Leaderboard.

For a selected player, the profile includes:

- Player identity and current rating context.
- The ranked team currently displayed for the player and other observed teams.
- Axie compositions with their rune and charm configurations.
- Marketplace links from Axie IDs.
- A recent ranked-battle history with result, rating or star movement, match
  duration, elapsed time, opponent, and both team configurations.
- A ranked-history summary with an MMR or star-movement sparkline.
- Battle filters for opponent, result, game mode, and battle date or range.

The profile initially loads 20 battles. Loading more records at the bottom
extends the history and updates the summary visualization and ranked records.

### Morph Viewer

The Morph Viewer searches Axies by individual Axie ID or Ronin address and
renders their metamorphosed parts. It supports collectible-aware filtering and
paginated results.

Metamorph data is not a reliable on-chain GraphQL field for this workflow, so
the viewer enriches results through Sky Mavis Origins APIs rather than relying
on marketplace GraphQL alone. Address lookup also accounts for ownership and
delegation data before applying collectible filters.

## Current and historical leaderboard views

![Automatic offseason leaderboard view](assets/readme/leaderboard-offseason-current.png)

*Automatic offseason mode: `Current: Offseason` identifies the active source
without turning Offseason into a fifth era tab.*

![Historical Final leaderboard view](assets/readme/leaderboard-final-history.png)

*Historical Final view: Final is selected while `Current: Offseason` remains
available for returning to the automatic leaderboard.*

## Cross-cutting capabilities

- Scan the ranked player pool for one or more runes or body parts, with
  progress, partial results, cancellation, and terminal job states.
- Use accepted local captured-team evidence for historical scans; historical
  views never silently fall back to live enrichment.
- Distinguish confirmed results, unavailable data, and partial scan coverage
  instead of silently treating missing data as a match.
- Harden expensive upstream routes with shared Express rate-limiters, input
  validation, and scoped live polling quotas so repeated lookups and polluted
  request params are rejected before they amplify upstream cost.

## Engineering highlights

| Real-world concern | Approach in Axie Echelon |
| --- | --- |
| Current vs. historical data | Explicit leaderboard scopes keep automatic offseason data separate from `Rare`/`Epic`/`Mystic`/`Final` history. |
| API pressure | In-memory candidate, page, team, profile, and enrichment caches reduce repeated upstream work. |
| API guard rails | Shared baseline and route-specific limiters, live polling quotas, and input validation block runaway requests before they amplify upstream cost. |
| Long scans | Rune and body-part filtering use asynchronous jobs with queueing, progress polling, cancellation, partial results, and watchdog timeouts. |
| Race conditions | Scope keys and generation guards prevent old leaderboard or scan responses from overwriting newer UI state. |
| Incomplete upstream data | The UI distinguishes confirmed results, unavailable data, and partial scan coverage instead of silently treating them as matches. |
| Rendering cost | PIXI/Spine morph rendering uses bounded concurrency and per-gene reuse. |

## Architecture

```text
Sky Mavis REST + GraphQL APIs
             |
             v
  Express API and service layer
  - scope-aware leaderboard routes
  - cached candidate and enrichment data
  - asynchronous scan jobs
             |
             v
  Vanilla JavaScript + Vite frontend
  - historical/current scope controls
  - polling, filter state, stale-response guards
  - PIXI/Spine team and Axie rendering
```

### Leaderboard scopes

The UI keeps the automatically resolved current state separate from a manual
historical selection:

| View | Data source | Stable scope key |
| ---  | ---         | ---              |
| Current Rare/Epic/Mystic/Final | `/origins/v2/season-leaderboards?milestone=N` | `season:<seasonId>:milestone:<N>` |
| Current Offseason | `/origins/v2/leaderboards` | `offseason:<seasonId>` |
| Manually selected historical era | Accepted local snapshot, or “Snapshot unavailable” | `season:<seasonId>:milestone:<N>` |

This prevents Final-era cache entries, in-flight requests, and scan-job
deduplication from bleeding into offseason data. A manually selected historical
era reads its frozen candidate rows and captured teams from the same accepted
local snapshot; it never substitutes an upstream leaderboard or live team.
Historical rune/body-part filters use that same local evidence, so a missing
captured team is an unknown non-match rather than a live fallback.

## Technology

- **Frontend:** vanilla JavaScript, Vite, plain CSS, PIXI.js, Spine runtime
- **Backend:** Node.js ES modules and Express
- **Data integration:** Sky Mavis REST and GraphQL APIs
- **Testing:** Node's built-in test runner with deterministic fixtures and
  fetch adapters
- **Persistence:** live in-memory caches plus browser `sessionStorage`; optional
  immutable historical snapshots are stored locally under gitignored
  `data/snapshots/`

## Run locally

### Prerequisites

- Node.js 20+
- A Sky Mavis API key for live upstream requests

### Setup

```powershell
npm install
Copy-Item .env.example .env
# Add AXIE_ECHELON_API_KEY to your ignored .env file.
npm run dev
```

Open `http://127.0.0.1:5173`.

The Vite frontend runs on port `5173`; the Express API runs on port `8787`.
Never commit `.env` files, API keys, or raw API captures. See
[SECURITY.md](SECURITY.md) for publication guidance.

### Multiple local profiles

The app also supports profile-driven local testing. Each profile can have its
own API key, leaderboard rank window, polling interval, debug setting, and
automatically derived frontend/backend ports. A profile is selected when the
process starts and remains fixed until that process is restarted.

To run the default profile:

```powershell
npm run dev
```

To run a configured numbered profile in another terminal:

```powershell
$env:TRACKER_PROFILE = "2"
npm run dev
```

Profiles are configured with variables such as
`TRACKER_PROFILE_2_MAVIS_API_KEY`, `TRACKER_PROFILE_2_VITE_LEADERBOARD_LIMIT`,
and `TRACKER_PROFILE_2_VITE_LEADERBOARD_OFFSET`. The repository includes
convenience launch scripts under `scripts/trackers/` for the predefined local
profiles. Keep every API key in the ignored `.env`; never copy credentials into
the scripts or documentation.

## Troubleshooting

- **Blank page at `127.0.0.1:8787`:** Use the Vite frontend at
  `http://127.0.0.1:5173`. The backend port serves API responses, not the
  Vite development experience.
- **Port already in use:** Stop the process using `5173` or `8787`, then start
  the corresponding service again.
- **Leaderboard is blank:** Check the backend terminal for upstream API errors
  and open `http://127.0.0.1:8787/api/leaderboard/pool` directly.
- **API key errors:** Confirm `AXIE_ECHELON_API_KEY` exists in the ignored
  project-root `.env` file and restart the backend after changing it.
- **Stale frontend behavior:** Restart the backend after changing server-side
  modules. Vite reloads frontend modules, but it does not restart Node.
- **Previous seasons are unavailable:** This is intentional while snapshot
  archival and accepted historical artifacts are being completed. The current
  season's completed eras can be available locally even though older seasons
  remain locked.

## Data maintenance

Season and era metadata is resolved from `src/data/season.json`. To inspect
available seasons:

```powershell
node .\scripts\list-seasons.mjs
```

The rune and charm registries are generated from Sky Mavis metadata. Refresh
them intentionally with `node .\scripts\update-runes.mjs` or
`npm run charms:update`. Registry refreshes require `AXIE_ECHELON_API_KEY`
and should be reviewed before committing generated changes.

Historical snapshots are local operator data under the gitignored
`data/snapshots/` directory. Follow [snapshot archival](docs/engineering/snapshot-archival.md)
and [SECURITY.md](SECURITY.md) before capturing, verifying, or publishing
anything related to snapshots.

## Quality checks

```powershell
npm test
npm run build
git diff --check
```

The automated suite covers era boundaries, current/offseason routing,
scope-separated caches and scan-job deduplication, retries, progress and
cancellation lifecycle states, rune/body-part filter semantics, stale-response
protection, and archival snapshot safety. Historical row and team views use
only an explicitly accepted, era-bounded local snapshot; they never silently
fall back to current upstream leaderboard or team data.

## CI and snapshot safety

GitHub Actions validates the project using the repository's synthetic test and
build suite on pushes and pull requests to `main`. The CI workflow does not
read local snapshot artifacts, does not upload ignored `data/snapshots/`
content, and does not expose `.env`, credentials, or API keys. Real local
snapshot storage remains gitignored and operator-managed outside version
control.

## Project structure

```text
src/
  leaderboard/       Current/historical scope UI, filters, renderers, polling
  axieLookup/        Axie and Ronin address lookup experience
  server/            Routes, API clients, caches, scan jobs, concurrency
  data/              Season, rune, card, and mapping metadata
docs/
  STATUS.md          Current state, limitations, verification, and roadmap
  engineering/       Architecture, data-flow, and implementation notes
  history/           Selected technical history and postmortems
server.js             Express entry point
vite.config.js        Frontend dev server and API proxy
```

## Design decisions worth discussing

- **No invented offseason milestone.** Offseason is a different upstream
  leaderboard source, not `milestone=5`.
- **Progressive historical navigation.** The UI only exposes season eras that
  have already been reached; offseason exposes all four as history.
- **Truthful async states.** `complete`, `partial`, `failed`, and `cancelled`
  mean different things and are surfaced rather than collapsed into a generic
  success state.
- **Scoped, not global, cache identity.** Candidate chunks, in-flight work,
  average match estimates, and job deduplication are keyed by leaderboard
  scope; user/team data remains user-scoped where appropriate.
- **Heuristics remain labeled as heuristics.** Battle timing is useful context,
  not a claim of real-time player presence.

## Current limitations and next steps

- Add comprehensive browser-level smoke coverage for the leaderboard and
  lookup flows.
- Enable the documented local end-of-era scheduler only when you are ready to
  capture private snapshot artifacts; it is off by default and still requires
  manual review/acceptance. See
  [snapshot archival](docs/engineering/snapshot-archival.md).
- Consider resumable scan jobs for requests that reach the watchdog timeout.
- Split the PIXI/Spine bundle further to reduce initial load cost.
- Add a public demo or a clearly labeled fixture-backed demo mode for portfolio
  viewing without exposing credentials.
- Decide whether to hide or lock unavailable eras when a season has only partly
  progressed. For example, Rare may be the only selectable era early in a
  season; Offseason should be disabled outside offseason.

## Further reading

- [Project status and roadmap](docs/STATUS.md)
- [Engineering documentation index](docs/engineering/README.md)
- [Rune scan job architecture](docs/engineering/rune-scan-job-architecture.md)
- [Body-part filtering design](docs/engineering/body-part-filtering.md)
- [Historical snapshot archival](docs/engineering/snapshot-archival.md)

## Security

See [SECURITY.md](SECURITY.md) for API-key handling, ignored local data, and
publication checks. Credentials belong only in local environment variables,
ignored `.env` files, or a deployment secret manager.

## License

All rights reserved. This project is not currently licensed for reuse,
modification, or redistribution.
