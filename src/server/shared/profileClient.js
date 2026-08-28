import { executeGraphQLQuery } from "./graphqlClient.js";

export async function getProfileByRoninAddress(address) {
  const query = `
    query GetProfileByRoninAddress($roninAddress: String!) {
      publicProfileWithRoninAddress(address: $roninAddress) {
        name
        accountId
      }
    }
  `;

  const data = await executeGraphQLQuery("GetProfileByRoninAddress", query, {
    roninAddress: address
  });
  const profile = data?.publicProfileWithRoninAddress;

  if (!profile?.accountId) {
    throw new Error("No Axie profile was found for this Ronin address.");
  }

  return profile;
}

export async function getProfileByAccountId(accountId) {
  const query = `
    query GetProfileByID($accountId: UUID!) {
      publicProfile(id: $accountId) {
        accountId
        name
        addresses {
          ronin
        }
      }
    }
  `;

  const data = await executeGraphQLQuery("GetProfileByID", query, { accountId });
  const profile = data?.publicProfile;

  if (!profile?.accountId) {
    throw new Error("No Axie profile was found for this account ID.");
  }

  return profile;
}
