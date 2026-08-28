// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes. This is the shared GraphQL boundary against
// Skymavis/Axie Infinity's marketplace GraphQL API. Used by:
//   - axieService.js (axie-lookup feature: resolveAxieById, etc.)
//   - shared/profileCache.js (leaderboard feature: resolvePlayerProfile,
//     which wraps getProfileByAccountId with a long-lived cache)
import { AXIE_ECHELON_API_KEY, GRAPHQL_UPDATED_URL } from "./env.js";

export async function executeGraphQLQuery(operationName, query, variables) {
  if (!AXIE_ECHELON_API_KEY) {
    throw new Error("AXIE_ECHELON_API_KEY is missing from .env.");
  }

  const response = await fetch(GRAPHQL_UPDATED_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "x-api-key": AXIE_ECHELON_API_KEY
    },
    body: JSON.stringify({
      operationName,
      variables,
      query
    })
  });

  const text = await response.text();

  console.log("GRAPHQL STATUS:", response.status);
  console.log(
    "GRAPHQL CONTENT TYPE:",
    response.headers.get("content-type")
  );
  console.log(
    "GRAPHQL RESPONSE PREVIEW:",
    text.slice(0, 120)
  );

  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "GraphQL returned non-JSON data. It may be a Cloudflare challenge."
    );
  }

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  return json.data;
}
