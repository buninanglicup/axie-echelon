import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchAxiesOwnedByAddress } from "../src/server/shared/marketplaceAxieClient.js";

const profiles = [
  "0xfd2fd5409c742a22d746cfaec7b4012a8ae49299",
  "0x87bacc1e6501fdc050192811bad55954620836de",
  "0x2caa0a493605fa1d81ca3087c9f57bf2e441f1ea",
  "0x75a19af500b397f565c852cb3c58281aa059db70"
];
const outputPath = path.resolve("api-responses/body-part-profile-validation.json");
const profilesData = [];

for (const address of profiles) {
  const result = await fetchAxiesOwnedByAddress(address, { pageSize: 500 });
  profilesData.push({ address, total: result.total, axies: result.items });
  console.log(`${address}: captured ${result.items.length} of ${result.total}`);
}

await fs.writeFile(outputPath, `${JSON.stringify({ source: "Sky Mavis GraphQL marketplace profile inventory", profiles: profilesData }, null, 2)}\n`);
console.log(`Wrote ${profilesData.reduce((count, profile) => count + profile.axies.length, 0)} Axies to ${path.relative(process.cwd(), outputPath)}`);
