// Download the complete Origins card catalog into src/data/cards.json.
//
// Usage:
//   $env:AXIE_ECHELON_API_KEY = "<your-skymavis-api-key>"
//   node scripts/update-cards.mjs
//
// The card endpoint returns the complete catalog in one response. Keep the
// response metadata and item shape unchanged in the local catalog.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";

const apiKey = process.env.AXIE_ECHELON_API_KEY;
const endpoint = "https://api-gateway.skymavis.com/origins/v2/community/cards";
const outputPath = new URL("../src/data/cards.json", import.meta.url);

if (!apiKey) {
  console.error("AXIE_ECHELON_API_KEY is required in the environment.");
  process.exit(1);
}

const response = await fetch(endpoint, {
	headers: {
		Accept: "application/json",
		"X-API-Key": apiKey
	}
});

if (!response.ok) {
  throw new Error(`Card catalog request failed: HTTP ${response.status}`);
}

const body = await response.json();
const items = Array.isArray(body._items) ? body._items : [];
const metadata = body._metadata || {};

if (metadata.hasNext === true) {
  throw new Error("Card catalog response indicates more pages, but the endpoint is expected to return the complete catalog.");
}

console.log(`Fetched ${items.length} cards (${metadata.total ?? "?"} reported).`);

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");

console.log(`Saved ${items.length} cards to src/data/cards.json.`);