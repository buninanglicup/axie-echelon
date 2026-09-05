import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { getAxieMarketplaceDetails } from "../src/server/shared/marketplaceAxieClient.js";

const axieIds = ["1", "2", "3", "18"];
const axies = [];

for (const axieId of axieIds) {
  const axie = await getAxieMarketplaceDetails(axieId);
  axies.push(axie);
  console.log(`${axieId}: ${axie.name || "(unnamed)"}`);
}

const outputPath = path.resolve("api-responses/body-part-starter-validation.json");
await fs.writeFile(outputPath, `${JSON.stringify({ source: "Sky Mavis GraphQL Axie detail", axies }, null, 2)}\n`);
console.log(`Wrote ${axies.length} starter Axies to ${path.relative(process.cwd(), outputPath)}`);
