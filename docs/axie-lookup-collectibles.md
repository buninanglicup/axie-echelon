# Axie Lookup and Collectible Classification

## Address data sources

The Ronin-address route uses the marketplace GraphQL API first. Its query uses
the same `delegationFilters` pattern as the Marketplace profile Axies tab, so it
includes both directly owned Axies and Axies delegated to the address:

```graphql
axies(
	owner: null
	delegationFilters: [
		{ delegationStatus: Delegated, delegationAssignee: $address }
		{ delegator: $address, delegationStatus: Delegated }
		{ delegationStatus: Expired, delegator: $address }
		{ delegator: $address, delegationStatus: NotDelegated }
	]
	size: $size
	from: $from
)
```

The reusable implementation is exported as `fetchAxiesOwnedByAddress(ownerAddress)` from `src/server/shared/marketplaceAxieClient.js`. This is the project-wide function for getting Axies given a Ronin address. Other backend features that need marketplace ownership, genes, or part metadata should reuse it rather than creating another address lookup.

The response provides the complete address inventory, genes, and
`parts[].specialGenes`. The route then fetches the resolved profile account from
the Origins community fighters endpoint and merges matching records by Axie ID.
This enrichment supplies `genesMetamorph` and the full morph part payload while
preserving GraphQL's inventory and total count. The fighters endpoint is used as
a list fallback only when the marketplace query returns no Axies.

This address flow is separate from direct Axie-ID lookup. Direct lookup resolves
ownership/delegation with GraphQL, searches the Fighters API delegatee account
first, then owner-account fallbacks, and uses GraphQL detail only as the final
fallback.

The GraphQL owner query is requested in one large page and deduplicated by Axie ID.
The route retains every GraphQL Axie even when the Fighters API returns fewer
records, avoiding inventory loss while still enabling morph previews for matched
records.

## Collectible signals

The classifier uses these fields:

- `title` for title collectibles such as `Origin`, `MEO`, and `MEO II`.
- `collection` when supplied by an API response.
- `parts[].specialGenes` for special collections, including Nightmare parts.
- Origins compact `parts[].part_skin` values: `12` means Nightmare and `13` means Nightmare Shiny.
- Supported gene decoding as a fallback.

The Axie `name` is not used to infer a title. The internal `Morphed` tag indicates Meta Morph data but does not count as a collectible by itself.

## Filtering and pagination

Address results are normalized, classified, and deduplicated on the server. The frontend then applies `Show only collectibles` and any selected collection filters to the complete result set before paginating it. This keeps non-collectible Axies out of filtered pages and prevents collectible Axies from being scattered across raw API pages.