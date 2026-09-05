# Body-Part Filtering

Status: mapping validation, local scanner, and async job complete. The HTTP
route and filter UI do not exist yet.

## Current Decision

Body-part scans should use local gene decoding as the primary path. Battle-log fighter payloads already include `genes`, `genes_metamorph`, `axieID`, and `axieType`, so a top-1000 scan should not make an additional request per fighter when the gene can be decoded locally.

The existing rune scan job architecture is the intended model for a future body-part scan: candidate pool, bounded enrichment, polling, cancellation, deduplication, partial results, and client-side result pagination.

## Canonical Variant Matching

The UI should expose a canonical/base part while matching known collectible variants. For example:

```text
Sleepless -> matches Sleepless, Yen, and other verified variants
```

Variant metadata should retain the slot, class, base name, and variant names. Multiple selected parts should use OR semantics, matching the rune filter's current behavior. Missing or malformed genes are unknown data, not a confirmed non-match.

## Data Sources

Primary runtime data:

- `battleLogClient.js` already receives genes from the battle-log response.
- `src/geneDecoder.js` now exposes class, dominant/recessive raw part IDs, and skins for 256-bit and 512-bit genes.

Reference sources used for verification:

- [agp-npm gene decoder](https://github.com/ShaneMaglangit/agp-npm)
- [agp-npm traits mapping](https://github.com/ShaneMaglangit/agp-npm/blob/main/src/assets/traits.json)
- [agp-npm part metadata](https://github.com/ShaneMaglangit/agp-npm/blob/main/src/assets/parts.json)
- [agp-npm documentation](https://shanemaglangit.github.io/agp-npm/classes/axie_gene.AxieGene.html)

`agp-npm` is archived and GPL-3.0 licensed. Its source and JSON assets are references and validation oracles; they are not copied into this project. A future compact mapping must be independently created or sourced from a compatible official source.

The Sky Mavis cards catalog at `/origins/v2/community/cards` is stored separately in `src/data/cards.json`. It describes battle cards and associated slots, not a confirmed gene-to-body-part mapping. It must not be assumed to resolve body-part names.

The existing GraphQL Axie detail path can return `parts` for individual Axies and is useful for verification or fallback. It is not the primary top-1000 scan path because per-Axie lookups would create excessive request fan-out.

## Validation checkpoint

`ListUserFighters.json` currently provides an independent reference for 20
fighters and 120 reported parts. `scripts/validate-body-part-mapping.mjs`
compares each reference part with the local decoder's dominant slot ID and
class. The current captured fixture produces 120 exact matches, with zero
mismatches and zero unknowns. `src/geneDecoder.test.js` keeps this structural
check and malformed-gene behavior in the regular test suite.

`scripts/inspect-body-part-evidence.mjs` inventories the observed
`class/slot/value` keys and joins them to matching `cards.json` records for
review. The resulting card names are labeled candidate-only evidence because
card names and gene body-part names are not independently proven equivalent.

This validates the captured 512-bit decoder layout only. It does not establish
canonical body-part names, variant relationships such as `Yen` -> `Sleepless`,
or complete 256-bit coverage. Those still require independently prepared
mapping evidence before a production filter can be built.

The existing GraphQL parts probe (`tmp-axie-parts-query.js`) was also checked,
but the current local environment returned `Invalid authentication credentials`
for all five sample Axies. No name-bearing response was captured, so no
canonical mapping was authored from the unavailable query.

That probe was then aligned with the active tracker profile and succeeded. The
responses are captured in `api-responses/body-part-name-validation.json`.
Across five Axies and 30 named parts, 28 names matched the decoder's dominant
ID through a same-class, same-slot card candidate, with no ID mismatches. Two
parts (`Hazy` and `Yakitori`) had no card candidate. These are corroborated
samples, not a complete mapping or proof that every card name is a body-part
name.

Four collectible-focused marketplace profiles were then captured through the
shared authenticated GraphQL client in
`api-responses/body-part-profile-validation.json`. The capture contains 1,596
Axies and 9,576 named parts. All 1,596 genes decoded and all observed parts
matched the decoded class and slot. It produced 192 verified structural keys:
every key has one untagged base name, while 83 also have collectible names.

`src/data/body-part-mapping-candidate.json` preserves those 192 keys. It is a
candidate artifact, not runtime data. All 192 records are marked `candidate`
because exactly one untagged base name was observed. Names carrying
`specialGenes` are retained as variants. For example, Aquatic/Eyes/2 resolves
to `Sleepless` with `Insomnia` (Mystic) and `Yen` (Japan), while Plant/Back/4
resolves to `Shiitake` with `Yakitori` (Japan). The classification still needs
broader capture review before this file can power filtering.

`src/bodyPartMapper.js` provides an isolated lookup over this candidate file,
with regression tests for canonical and variant matching. It is not connected
to a route or UI yet; the local predicate and scanner use it directly.

`src/bodyPartFilter.js` now provides the local fighter predicate. It reads
`genes_metamorph` first and falls back to `genes`, decodes dominant parts,
matches canonical names and verified variants with OR semantics, and returns a
`known` flag. Malformed genes are unknown; starter/legacy genes that decode but
have no mapper entry simply cannot produce a confirmed match.

`src/server/leaderboard/bodyPartScanner.js` now applies that predicate to the
existing narrowed leaderboard candidate flow. It reuses the team cache and
battle-log fetch path, applies rank/name narrowing before enrichment, scans in
bounded batches, and reports matched body-part details. Its async job and HTTP
route are intentionally still separate follow-up work.

`src/server/leaderboard/bodyPartScanJobs.js` now owns queued/running/complete/
partial/failed/cancelled lifecycle state, case-insensitive selection
deduplication, heartbeat cleanup, cancellation, watchdog timeouts, partial
results, and progress polling. Its focused lifecycle suite uses a scanner seam
so job behavior is tested independently from network fixtures.

The existing battle-log fixture contains only six fighter records, but the
larger rune-scan capture contains 2,733 fighter records and 2,727 unique gene
strings. All unique genes decoded. Of 16,362 dominant parts, 16,342 mapped to
the candidate file; the remaining 20 use low IDs (`1` or `3`) and come from
legacy/starter records. A GraphQL check showed Axies 1, 2, and 3 have
`genes: "0x0"` and no parts, so these must remain unknown rather than receive
invented names. The coverage checker is
`scripts/validate-body-part-log-coverage.mjs`.

The large API captures used for validation remain ignored local evidence, as
described in `api-responses/README.md`. The committed candidate mapping is the
reviewed runtime input; credentials and raw captures are not committed.

The [cc-axie-gtk2d repository](https://github.com/axieinfinity/cc-axie-gtk2d) is a reference for rendering and starter assets. Its `images/starter.png` asset may help with starter previews, but separate production starter URLs and licensing have not been established.

## Next Milestone

1. Add HTTP start/status/cancel routes around the body-part scan job.
2. Add the leaderboard filter UI and client-side result pagination.
3. Continue expanding name-bearing captures when new variants or unsupported
   starter records are encountered.
