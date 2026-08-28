// Download the complete Origins rune catalog into src/data/runes.json.
//
// Usage:
//   $env:AXIE_ECHELON_API_KEY = "<your-skymavis-api-key>"
//   node scripts/update-runes.mjs
//
// Optional season override:
//   $env:RUNE_SEASON_ID = "19"
//   node scripts/update-runes.mjs
//
// The API accepts at most 100 items per request. This script follows offset
// pages until the response metadata reports hasNext=false.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";

const apiKey = process.env.AXIE_ECHELON_API_KEY;
const seasonId = Number(process.env.RUNE_SEASON_ID || 19);
const limit = 100;
const endpoint = "https://api-gateway.skymavis.com/origins/v2/community/runes";
const outputPath = new URL("../src/data/runes.json", import.meta.url);

if (!apiKey) {
  console.error("AXIE_ECHELON_API_KEY is required in the environment.");
  process.exit(1);
}

if (!Number.isInteger(seasonId) || seasonId < 1 || seasonId > 999) {
  console.error("RUNE_SEASON_ID must be an integer between 1 and 999.");
  process.exit(1);
}

const items = [];
let offset = 0;
let etag = null;

while (true) {
  const url = new URL(endpoint);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("seasonId", String(seasonId));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Rune catalog request failed: HTTP ${response.status}`);
  }

  const body = await response.json();
  const pageItems = Array.isArray(body._items) ? body._items : [];
  const metadata = body._metadata || {};
  etag = body._etag || etag;

  if (pageItems.length === 0 && metadata.hasNext) {
    throw new Error(`Rune catalog returned an empty page at offset ${offset} while hasNext=true.`);
  }

  items.push(...pageItems);
  console.log(`Fetched ${pageItems.length} runes at offset ${offset} (${items.length}/${metadata.total ?? "?"}).`);

  if (!metadata.hasNext) break;

  const nextOffset = offset + pageItems.length;
  if (nextOffset <= offset) {
    throw new Error(`Rune catalog pagination made no progress at offset ${offset}.`);
  }
  offset = nextOffset;
}

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({
    _etag: etag,
    _items: items,
    _metadata: {
      limit,
      offset: 0,
      total: items.length,
      hasNext: false,
      seasonId
    }
  }, null, 2)}\n`,
  "utf8"
);

console.log(`Saved ${items.length} runes to src/data/runes.json.`);