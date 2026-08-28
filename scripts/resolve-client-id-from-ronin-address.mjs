// Resolve the Axie client/account ID used by the API from a Ronin address.
//
// Usage:
//   node scripts/resolve-client-id-from-ronin-address.mjs <ronin-address>
//
// Example:
//   node scripts/resolve-client-id-from-ronin-address.mjs 0x93144b2cf85af14f50ba9875c3608fce81fb1805
//
// The returned Account ID is the client ID used by the leaderboard and
// fighters APIs.
import { getProfileByRoninAddress } from "../src/server/shared/profileClient.js";

const address = process.argv[2]?.trim();

if (!address) {
  console.error("Usage: node scripts/resolve-client-id-from-ronin-address.mjs <ronin-address>");
  process.exit(1);
}

try {
  const profile = await getProfileByRoninAddress(address);
  console.log(`Name: ${profile.name || "(unnamed)"}`);
  console.log(`Account ID: ${profile.accountId}`);
} catch (error) {
  console.error(`Profile lookup failed: ${error.message}`);
  process.exit(1);
}