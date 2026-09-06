export function requireSnapshotApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("AXIE_ECHELON_API_KEY is required. Add it to the ignored .env file or set it locally before capturing.");
  }
  return apiKey;
}
