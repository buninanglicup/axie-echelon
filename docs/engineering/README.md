# Engineering Documentation

These documents explain the system's architecture, data contracts, implementation decisions, and operational workflows. Start with [Project Status](../STATUS.md) for the current state and roadmap.

## Architecture and Data Flow

- [Cache and Polling Strategy](cache-and-polling-strategy.md) - Cross-feature cache layers, live polling behavior, freshness boundaries, and tuning guidance.
- [Leaderboard Enrichment](leaderboard_enrichment.md) - How leaderboard rows acquire team data, morph fields, retry behavior, and validation. Read the cache strategy separately for system-wide cache ownership and TTLs.
- [Live Prediction Heuristic](live-prediction-heuristic.md) - How completed battles become labeled activity estimates and prediction states.
- [Leaderboard Scan Job Architecture](rune-scan-job-architecture.md) - Shared runtime contract for rune and body-part scan jobs: lifecycle, completeness, cancellation, deduplication, and tests.
- [Leaderboard Roadmap](leaderboard-roadmap.md) - Broader leaderboard design history, candidate-pool and pagination decisions, implementation phases, and remaining work.

## Lookup and Filtering

- [Axie Lookup and Collectible Classification](axie-lookup-collectibles.md) - Marketplace ownership, delegation, collectible signals, filtering, and pagination.
- [Body-Part Filtering](body-part-filtering.md) - Gene decoding, canonical names, variants, evidence, and scan behavior.
- [Axie Search Pagination Dock](axie-search-pagination-dock.md) - Lookup pagination semantics, accessibility, and responsive behavior.

## Registries, Fixtures, and Snapshots

- [Rune and Charm Registries](rune-registry.md) - Generated seasonal catalogs, refresh commands, and unknown-ID behavior.
- [Leaderboard Scan Fixtures](rune-scan-fixtures.md) - Synthetic rune fixtures, body-part test evidence, and live benchmark guidance.
- [Historical Snapshot Archival](snapshot-archival.md) - Capture, acceptance, verification, retention, and historical reads.
