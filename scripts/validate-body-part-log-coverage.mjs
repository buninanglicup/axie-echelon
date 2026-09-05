import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGenes } from "../src/geneDecoder.js";
import { getBodyPartMapping } from "../src/bodyPartMapper.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(scriptDirectory, "../api-responses/battle-logs-by-user-id.json");
const fixtureText = fs.readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText.slice(fixtureText.indexOf("{")));
const fighters = [];

function visit(value) {
  if (!value || typeof value !== "object") return;
  if (value.axieID != null && (value.genes_metamorph || value.genes)) fighters.push(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item);
  } else {
    for (const child of Object.values(value)) visit(child);
  }
}

visit(fixture);
const geneSamples = new Map();
for (const fighter of fighters) {
  const genes = fighter.genes_metamorph || fighter.genes;
  if (genes && !geneSamples.has(genes)) geneSamples.set(genes, fighter.axieID);
}
const uniqueGenes = new Set(geneSamples.keys());
const missingKeys = new Set();
const missingSamples = new Map();
let decodedGenes = 0;
let mappedParts = 0;
let unmappedParts = 0;

for (const genes of uniqueGenes) {
  const decoded = decodeGenes(genes);
  if (!decoded) continue;
  decodedGenes += 1;
  for (const [slot, part] of Object.entries(decoded.parts || {})) {
    const mapping = getBodyPartMapping({ ...part.dominant, slot });
    if (mapping) mappedParts += 1;
    else {
      unmappedParts += 1;
      const missingKey = `${part.dominant.class}:${slot}:${part.dominant.id}`;
      missingKeys.add(missingKey);
      if (!missingSamples.has(missingKey)) missingSamples.set(missingKey, []);
      if (missingSamples.get(missingKey).length < 3) {
        missingSamples.get(missingKey).push({
          axieId: geneSamples.get(genes),
          slot,
          class: part.dominant.class,
          partValue: part.dominant.id
        });
      }
    }
  }
}

console.log(JSON.stringify({
  fixture: path.relative(process.cwd(), fixturePath),
  fighterRecords: fighters.length,
  uniqueGeneStrings: uniqueGenes.size,
  decodedUniqueGenes: decodedGenes,
  mappedDominantParts: mappedParts,
  unmappedDominantParts: unmappedParts,
  missingClassAndIdKeys: [...missingKeys].sort(),
  missingSamples: Object.fromEntries([...missingSamples.entries()].sort(([left], [right]) => left.localeCompare(right)))
}, null, 2));
