# Rune and Charm Registries

`src/data/runes.json` and `src/data/charms.json` are checked-in, generated
snapshots of the Origins rune and charm catalogs. Runes support leaderboard
metadata lookup; charms support player-profile equipment presentation. Do not
edit either file by hand; rerun the relevant generator when the upstream
catalog changes.

## Refresh the catalogs

Use a rotated Sky Mavis API key through the environment or the ignored project
`.env` file. Never put the key in a script, JSON file, or command committed to
Git.

```powershell
$env:AXIE_ECHELON_API_KEY = "<your-sky-mavis-api-key>"
$env:RUNE_SEASON_ID = "19"
node .\scripts\update-runes.mjs
$env:CHARM_SEASON_ID = "19"
npm run charms:update
```

Both generators request 100 items at a time from their respective community
catalog endpoints, advance by the number of returned items, reject an empty
page when `_metadata.hasNext` is true, and stop only when `hasNext` is false.
They write a normalized complete API envelope to their respective generated
JSON file.

The rune generator uses `RUNE_SEASON_ID` and
`scripts/update-runes.mjs`. The charm generator uses `CHARM_SEASON_ID` and
`scripts/update-charms.mjs`, exposed through `npm run charms:update`.

The checked-in season-19 snapshot currently contains 876 runes. Confirm the
final output count and `_metadata.hasNext=false` after refreshing. The current
season-19 charm snapshot contains 375 charms. The backend normalizes the rune
`_items` at startup in `src/server/leaderboard/runeCatalog.js` and charm
`_items` in `src/server/leaderboard/charmCatalog.js`.

Unknown rune or charm IDs remain available as raw IDs rather than being
silently assigned incorrect metadata.

## Starter Axie equipment coverage

The rune and charm registries provide metadata for known item IDs; they do not
provide the equipment assigned to a particular Axie. Some starter Axie API
responses omit rune and charm fields entirely, so the current profile and team
views cannot identify that equipment from those payloads.

This is an unresolved data-source limitation. The application must show the
equipment as unavailable rather than infer rune or charm assignments from the
Axie type, genes, or catalog contents. A future source or endpoint for starter
Axie equipment needs to be identified and validated before this support can be
expanded.