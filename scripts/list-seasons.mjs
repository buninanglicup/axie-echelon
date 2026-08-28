// scripts/list-seasons.mjs
//
// Offline maintenance helper -- NOT called at runtime by the app. Run this
// by hand when a new season starts, to look up the values that go into
// src/data/season.json.
//
// Usage:
//   node ./scripts/list-seasons.mjs
//
// Requires AXIE_ECHELON_API_KEY in the project-root .env file (same key used by
// scripts/update-runes.mjs and the running server).
//
// Paginates GET /origins/v2/seasons via limit/offset until the response's
// _metadata.hasNext is false, confirming the list is sorted ascending by
// id -- so the last item on the final page is the current/newest season.

import dotenv from "dotenv";

dotenv.config();

const AXIE_ECHELON_API_KEY = process.env.AXIE_ECHELON_API_KEY;
const MAVIS_API_URL = process.env.MAVIS_API_URL || "https://api-gateway.skymavis.com";
const PAGE_LIMIT = 20;

if (!AXIE_ECHELON_API_KEY) {
  console.error("AXIE_ECHELON_API_KEY is missing from .env. Aborting.");
  process.exit(1);
}

function toIso(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString();
}

async function fetchAllSeasons() {
  const seasons = [];
  let offset = 0;

  while (true) {
    const url = `${MAVIS_API_URL}/origins/v2/seasons?limit=${PAGE_LIMIT}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { "x-api-key": AXIE_ECHELON_API_KEY }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Seasons fetch failed at offset ${offset}: HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = await response.json();
    const items = Array.isArray(data._items) ? data._items : [];
    seasons.push(...items);

    const hasNext = Boolean(data._metadata?.hasNext);
    console.error(`Fetched offset=${offset} (${items.length} items, hasNext=${hasNext})`);

    if (!hasNext || items.length === 0) break;
    offset += PAGE_LIMIT;
  }

  return seasons;
}

async function main() {
  const seasons = await fetchAllSeasons();

  if (seasons.length === 0) {
    console.error("No seasons returned.");
    process.exit(1);
  }

  const recent = seasons.slice(-5);
  const current = seasons[seasons.length - 1];

  console.log("\nMost recent seasons:");
  console.log("id".padEnd(5), "name".padEnd(14), "startedAt".padEnd(20), "endedAt".padEnd(20));
  for (const season of recent) {
    console.log(
      String(season.id).padEnd(5),
      String(season.name).padEnd(14),
      `${season.startedAt} (${toIso(season.startedAt)})`.padEnd(20),
      `${season.endedAt} (${toIso(season.endedAt)})`
    );
  }

  console.log(`\nCurrent (newest) season: id=${current.id}, name="${current.name}"`);
  console.log(
    "\nReminder: the API's numeric `id` runs one ahead of the display `name` " +
      "(e.g. id 19 = \"Season 18\"). Copy the numeric id below into seasonId."
  );

  console.log("\nPaste into src/data/season.json (update eraDurationDays/eraNames if the cadence changed):\n");
  console.log(
    JSON.stringify(
      {
        seasonId: current.id,
        seasonName: current.name,
        seasonStartedAt: current.startedAt,
        seasonEndedAt: current.endedAt,
        eraDurationDays: [14, 14, 14, 14],
        eraNames: ["Rare", "Epic", "Mystic", "Final"]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("list-seasons failed:", error.message);
  process.exit(1);
});
