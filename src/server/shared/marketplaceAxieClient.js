import { executeGraphQLQuery } from "./graphqlClient.js";

const DEFAULT_PAGE_SIZE = 500;

const OWNED_AXIES_QUERY = `
  query FetchAxiesOwnedByAddress(
    $owner: String
    $size: Int!
    $from: Int!
    $delegationFilters: [TokenDelegationFilter!]
  ) {
    axies(
      owner: $owner
      delegationFilters: $delegationFilters
      size: $size
      from: $from
    ) {
      total
      results {
        id
        name
        title
        class
        genes
        owner
        parts {
          id
          name
          class
          type
          specialGenes
        }
      }
    }
  }
`;

export async function getAxieOwnershipDetails(axieId) {
  const query = `
    query GetAxieOwnershipDetails($axieId: ID!) {
      axie(axieId: $axieId) {
        id
        owner
        ownerProfile {
          accountId
          addresses { ronin }
        }
        delegationState {
          delegatedAt
          delegatee
          delegateeProfile { accountId name }
        }
      }
    }
  `;
  const data = await executeGraphQLQuery("GetAxieOwnershipDetails", query, { axieId });
  if (!data?.axie) throw new Error("Axie was not found.");
  return data.axie;
}

export async function getAxieMarketplaceDetails(axieId) {
  const query = `
    query GetAxieMarketplaceDetails($axieId: ID!) {
      axie(axieId: $axieId) {
        id
        name
        title
        class
        stage
        breedCount
        genes
        bodyShape
        owner
        ownerProfile {
          accountId
          addresses { ronin }
        }
        parts { id name class type specialGenes }
        delegationState {
          delegatedAt
          delegatee
          delegateeProfile { accountId name }
        }
      }
    }
  `;
  const data = await executeGraphQLQuery("GetAxieMarketplaceDetails", query, { axieId });
  if (!data?.axie) throw new Error("Axie was not found.");
  return data.axie;
}

export async function countAxiesOwnedByAddress(ownerAddress) {
  // Match the Marketplace profile Axies tab: count direct ownership and all
  // delegation states relevant to this address. This is count-only; morph data
  // is obtained separately from the Fighters API.
  const query = `
    query CountAxiesOwnedByAddress(
      $from: Int!
      $size: Int!
      $owner: String
      $delegationFilters: [TokenDelegationFilter!]
    ) {
      axies(
        owner: $owner
        delegationFilters: $delegationFilters
        size: $size
        from: $from
      ) {
        total
      }
    }
  `;
  const data = await executeGraphQLQuery("CountAxiesOwnedByAddress", query, {
    size: 1,
    from: 0,
    owner: null,
    delegationFilters: [
      {
        delegationStatus: "Delegated",
        delegationAssignee: ownerAddress
      },
      {
        delegator: ownerAddress,
        delegationStatus: "Delegated"
      },
      {
        delegationStatus: "Expired",
        delegator: ownerAddress
      },
      {
        delegator: ownerAddress,
        delegationStatus: "NotDelegated"
      }
    ]
  });
  const total = Number(data?.axies?.total);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Could not determine the total Axie count.");
  }
  return total;
}

/**
 * Fetch all marketplace Axies owned by a Ronin address.
 * This is the reusable ownership lookup for address-based features.
 */
export async function fetchAxiesOwnedByAddress(ownerAddress, options = {}) {
  // The Marketplace query is the canonical address inventory. delegationFilters
  // includes Axies owned by the address and Axies delegated to the address.
  const pageSize = Math.max(1, Number(options.pageSize) || DEFAULT_PAGE_SIZE);
  const data = await executeGraphQLQuery("FetchAxiesOwnedByAddress", OWNED_AXIES_QUERY, {
    owner: null,
    size: pageSize,
    from: 0,
    delegationFilters: [
      {
        delegationStatus: "Delegated",
        delegationAssignee: ownerAddress
      },
      {
        delegator: ownerAddress,
        delegationStatus: "Delegated"
      },
      {
        delegationStatus: "Expired",
        delegator: ownerAddress
      },
      {
        delegator: ownerAddress,
        delegationStatus: "NotDelegated"
      }
    ]
  });

  const connection = data?.axies;
  const axiesById = new Map();
  for (const axie of Array.isArray(connection?.results) ? connection.results : []) {
    if (axie?.id != null) axiesById.set(String(axie.id), axie);
  }

  return {
    items: [...axiesById.values()],
    total: Number(connection?.total) || axiesById.size
  };
}
