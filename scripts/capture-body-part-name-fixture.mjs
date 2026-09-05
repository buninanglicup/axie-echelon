import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveActiveProfile } from "../src/server/shared/trackerProfiles.js";

const endpoint = "https://api-gateway.skymavis.com/graphql/axie-marketplace";
const outputPath = path.resolve("api-responses/body-part-name-validation.json");
const axieIds = ["12097341", "2412", "99300", "11929586", "11924408"];
const query = `query GetAxieParts($axieId: ID!) {
  axie(axieId: $axieId) {
    id
    genes
    bodyShape
    parts { id name class type }
  }
}`;
const apiKey = resolveActiveProfile().apiKey;

if (!apiKey) throw new Error("The active tracker profile has no API key.");

const axies = [];
for (const axieId of axieIds) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({ operationName: "GetAxieParts", query, variables: { axieId } })
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length || !body.data?.axie) {
    throw new Error(`Axie ${axieId} failed: ${JSON.stringify(body)}`);
  }
  axies.push(body.data.axie);
}

await fs.writeFile(outputPath, `${JSON.stringify({ source: "Sky Mavis GraphQL Axie detail", axies }, null, 2)}\n`);
console.log(`Wrote ${axies.length} Axies to ${path.relative(process.cwd(), outputPath)}`);
