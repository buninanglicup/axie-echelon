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

The response provides one marketplace inventory page, including genes and
`parts[].specialGenes`; the shared client requests up to 500 records by
default. The route then fetches the resolved profile account from the Origins
community fighters endpoint and merges matching records by Axie ID. The
marketplace response includes a total count, but inventory requests larger than
the single fetched page require an explicit pagination enhancement.
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

The Morph Viewer exposes filters for these collectible labels:

- Agamogenesis
- Mystic
- Origin
- MEO
- MEO II
- Shiny
- Xmas
- Japan
- Nightmare
- Summer

Mystic is supported through collection metadata, part metadata, and gene-based
fallback detection. The other labels use the same combination of title,
collection, part, compact skin, and gene signals where those fields are
available. `Morphed` is an internal rendering signal and is deliberately not a
collectible type.

`MEO II` is currently exposed in the filter list for future completeness, but
the classifier and gene decoder normalize the available MEO variants to the
single `MEO` tag. A distinct, reliable MEO-versus-MEO-II filter requires more
authoritative source-field coverage.

The classifier uses these fields:

- `title` for title collectibles such as `Origin`, `MEO`, and `MEO II`.
- `collection` when supplied by an API response.
- `parts[].specialGenes` for special collections, including Nightmare parts.
- Origins compact `parts[].part_skin` values: `12` means Nightmare and `13` means Nightmare Shiny.
- Supported gene decoding as a fallback.

The Axie `name` is not used to infer a title. The internal `Morphed` tag indicates Meta Morph data but does not count as a collectible by itself.

## Morph Viewer rendering

Each result card shows the original Axie image and a separate morphed-parts
preview. When `genesMetamorph` is available, the viewer renders a static
snapshot through the shared morph renderer and reuses cached rendered images
for repeated gene inputs. The snapshot option prevents a list of results from
running independent animation loops.

When morph data is unavailable, the viewer uses a collectible silhouette when
an original image exists. Otherwise it shows an explicit unavailable state
rather than inventing morph data. Rendering failures also fall back to a
visible unavailable state, with additional diagnostic detail available when
debugging is enabled.

Axie IDs link to the marketplace, and address-backed results can link to the
associated player profile. These links remain available independently of
whether the morph preview succeeds.

## Filtering and pagination

Address results are normalized, classified, and deduplicated on the server. In
address mode, the frontend defaults to `Show only collectibles`, then applies
selected collection filters with OR semantics before paginating the filtered
results. Direct Axie-ID mode does not apply address collectible filters. This
keeps non-collectible Axies out of filtered pages and prevents matching Axies
from being scattered across raw client-side pages.