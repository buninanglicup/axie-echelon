export function cleanAxieId(value) {
  const axieId = String(value || "").trim();
  if (!/^\d+$/.test(axieId)) {
    throw new Error("Axie ID must contain only numbers.");
  }
  return axieId;
}

export function cleanRoninAddress(value) {
  const address = String(value || "").trim().replace(/^ronin:/i, "0x");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("A valid Ronin address is required.");
  }
  return address.toLowerCase();
}

// Skymavis userIDs observed in production are UUIDv6 (time-ordered): the
// version nibble (3rd group) is "6" and the variant nibble (4th group) is
// 8/9/a/b, per RFC 4122. Verified against 10 real userID samples pulled from
// live leaderboard candidates -- all matched this shape. Enforcing the
// version/variant nibbles (rather than accepting any UUID) rejects garbage
// input faster; loosen to a generic UUID pattern if Skymavis is ever
// confirmed to return non-v6 userIDs for some accounts.
export function cleanUserId(value) {
  const userId = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(userId)) {
    throw new Error("A valid userID is required.");
  }
  return userId;
}