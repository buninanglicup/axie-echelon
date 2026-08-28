# Rune Registry

`src/data/runes.json` is a checked-in snapshot of the Origins rune catalog used
by the leaderboard metadata lookup.

## Refresh the catalog

Use a rotated Skymavis API key through the environment. Never put the key in a
script, JSON file, or command committed to Git.

```powershell
$env:AXIE_ECHELON_API_KEY = "<your-skymavis-api-key>"
$env:RUNE_SEASON_ID = "19"
node .\scripts\update-runes.mjs
```

The generator requests 100 items at a time from
`/origins/v2/community/runes`, advances by the number of returned items, and
stops only when `_metadata.hasNext` is false. It writes the combined API
envelope to `src/data/runes.json`.

The API currently reports 876 total runes for season 19. Confirm the final
output count and `_metadata.hasNext=false` after refreshing. The backend
normalizes `_items` at startup in `src/server/leaderboard/runeCatalog.js`.