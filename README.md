# Axie Echelon

Axie Echelon is an Axie leaderboard monitoring and battle-activity analysis
tool. It combines leaderboard data, recent ranked-battle history, team and
rune metadata, and heuristic activity estimates in a local dashboard.

The application does not track individual accounts or directly confirm live
matches. Its activity states are inferred from completed ranked battles and
their historical timing patterns.

## Runtime terminology

- **Application**: Axie Echelon, the leaderboard monitoring dashboard.
- **Tracker instance**: One running copy of the application.
- **Tracker profile**: The configuration selected by one tracker instance.
- **Leaderboard window**: The rank range displayed by a profile.
- **Activity estimate**: A heuristic prediction based on recent completed battles.

## Key Features

- Axie Origins leaderboard with live team previews and rune badges
- Rank, activity, and rune filtering with live polling controls
- Axie ID and Ronin address lookup with morph previews

The reusable marketplace ownership function is `fetchAxiesOwnedByAddress(ownerAddress)` in `src/server/shared/marketplaceAxieClient.js`. Use it when a feature needs to retrieve Axies belonging to a Ronin address; do not create another owner lookup.

## Roadmap

- Meta Analytics
- Team Builder

## Project documentation

- [Current project handoff and status](PROJECT_HANDOFF.md) - canonical architecture, features, known issues, verification, and next steps
- [Security notes](SECURITY.md) - API-key exposure response, local secret handling, and GitHub publication checklist
- [Recovery review](docs/history/recovery-review.md) - component-by-component recovery findings, repairs, validation, and remaining limitations
- [Phase 1 split summary](PHASE1_SPLIT_SUMMARY.md) - historical refactor notes and rationale
- [Leaderboard enrichment](docs/implementation/leaderboard_enrichment.md) - battle-log enrichment and cache behavior
- [Cache and polling strategy](docs/planning/cache-and-polling-strategy.md) - cache and live-tracking design notes
- [Axie lookup and collectible classification](docs/implementation/axie-lookup-collectibles.md) - marketplace GraphQL fallback, collectible signals, deduplication, and filtered pagination

## Local development

- Run both the backend and frontend together with:
  - `npm run dev`
- Copy `.env.example` to `.env` and add your local `AXIE_ECHELON_API_KEY` before starting.
- The Vite frontend runs on `http://127.0.0.1:5173`.
- The backend API runs on `http://127.0.0.1:8787`.
- Open `http://127.0.0.1:5173` in your browser for the working dev app.
- If you want a different backend port, set `PORT` before starting:
  - `PORT=3000 npm run dev`

### Single tracker profile

The app supports a single active profile through the environment variable `TRACKER_PROFILE`.

Examples:

- PowerShell: `$env:TRACKER_PROFILE = "2"; npm run dev`
- cmd.exe: `set TRACKER_PROFILE=2 && npm run dev`
- POSIX shell: `TRACKER_PROFILE=2 npm run dev`

### Multi-tracker local testing

For local multi-instance testing, use the launcher script in the project root:

- `.\start-all-trackers.ps1`

If PowerShell blocks the script because of its execution policy, run the same
launcher with a temporary process-level bypass:

- `powershell -ExecutionPolicy Bypass -File .\start-all-trackers.ps1`

The bypass applies only to that PowerShell process; it does not permanently
change the computer's execution-policy settings.

This script starts the five predefined tracker terminals in Windows Terminal tabs and launches each one with its own profile-scoped environment. The per-tracker launch scripts set the matching `TRACKER_PROFILE` before running `npm run dev`.

The profile system itself is not limited to five trackers. Add contiguous indexed settings such as `TRACKER_PROFILE_6_...` and start profile 6 manually, or add a corresponding `start-tracker6.ps1` script. Profile resolution stops at the first missing number.

For profile-based tuning, keep the values in `.env` as profile-scoped overrides such as `TRACKER_PROFILE_2_...` and `TRACKER_PROFILE_3_...`.

## Troubleshooting

- If the app is blank on `http://127.0.0.1:8787`, that is expected in development mode because the raw source files use bare ESM imports and require Vite's module resolution.
- For development, use `http://127.0.0.1:5173` instead.
- Check the terminal for backend startup logs:
  - `Starting server on port 8787 (default port 8787)`
  - `API server running at http://127.0.0.1:8787`
- If the backend fails because `8787` is already taken, you will see:
  - `Port 8787 is already in use. Stop the process using it or set PORT to a free port.`
- If the leaderboard is blank after startup, verify the backend API directly:
  - `http://127.0.0.1:8787/api/leaderboard?limit=3&offset=0&milestone=3`
- If the page loads but the API is unreachable, the backend process is not running or is exiting early.

The app now runs as one unified process. Until the planned Phase 2 pagination pipeline is integrated, `VITE_LEADERBOARD_LIMIT` and `VITE_LEADERBOARD_OFFSET` select one fixed leaderboard window; ranks outside that window are not available in the UI. See [the leaderboard roadmap](docs/planning/leaderboard-roadmap.md) for the next implementation priority.

The current multi-tracker workflow is intentionally profile-based instead of hard-coded process duplication. It keeps each local tracker isolated by `TRACKER_PROFILE`, preserves clean dev-time testing across multiple rank windows, and avoids the stale identity assumptions that were previously causing profile collisions.

## Notes
- This project runs a local Node backend and serves frontend assets from the same process.
- Keep TODOs centralized here for quick future review.

## Leaderboard & Cache Tuning

See the documentation for details on the caching strategy and polling configuration:

- [Cache and Polling Strategy](docs/planning/cache-and-polling-strategy.md) — three-layer cache architecture, polling optimization, and tuning for live battle tracking
- [Leaderboard Enrichment](docs/implementation/leaderboard_enrichment.md) — team extraction, retry logic, and cache behavior

The current leaderboard era is resolved from `src/data/season.json`. Sky Mavis calls the numeric era selector `milestone`; this project uses `eraMilestone` internally and preserves `?milestone=` at the API boundary.
Run `node .\scripts\list-seasons.mjs` when a new season starts, then update
the season configuration and verify the era durations/names.

Leaderboard rune IDs are resolved server-side using the generated registry at:

```text
src/data/runes.json
```

The registry contains rune metadata and externally hosted Sky Mavis image URLs; image files are not stored in this repository.

To refresh the registry:

```powershell
node .\scripts\update-runes.mjs
```

The command requires `AXIE_ECHELON_API_KEY` in the project-root `.env` file.

See [Rune Registry documentation](docs/implementation/rune-registry.md) for the data flow, maintenance instructions, and security notes.

For handoff and current known issues, use [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) as the source of truth.