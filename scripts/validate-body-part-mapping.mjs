import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGenes } from "../src/geneDecoder.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(scriptDirectory, "../ListUserFighters.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const slotNames = {
  Eyes: "eyes",
  Mouth: "mouth",
  Ears: "ears",
  Horn: "horn",
  Back: "back",
  Tail: "tail"
};

function normalizeClass(value) {
  return String(value || "").trim().toLowerCase();
}

function compareFighter(fighter) {
  const genes = fighter.genesMetamorph || fighter.genes_metamorph || fighter.genes;
  const decoded = decodeGenes(genes);
  const result = {
    fighterId: fighter.id ?? fighter.axieID ?? null,
    hexType: decoded?.hexType ?? null,
    status: decoded ? "matched" : "unknown",
    parts: []
  };

  for (const referencePart of Array.isArray(fighter.parts) ? fighter.parts : []) {
    const slot = slotNames[referencePart.part_type];
    const decodedPart = slot ? decoded?.parts?.[slot]?.dominant : null;
    const expectedClass = normalizeClass(referencePart.part_class);
    const expectedId = Number(referencePart.part_value);
    const actualId = decodedPart?.id ?? null;
    const actualClass = decodedPart?.class ?? null;
    const partResult = {
      slot: slot || String(referencePart.part_type || "").toLowerCase(),
      expected: { id: expectedId, class: expectedClass },
      actual: { id: actualId, class: actualClass },
      status: !decodedPart
        ? "unknown"
        : actualId === expectedId && actualClass === expectedClass
          ? "matched"
          : "mismatch"
    };
    result.parts.push(partResult);
    if (partResult.status !== "matched") result.status = partResult.status;
  }

  return result;
}

const fighters = Array.isArray(fixture._items) ? fixture._items : [];
const results = fighters.map(compareFighter);
const parts = results.flatMap((result) => result.parts);
const summary = {
  fixture: path.relative(process.cwd(), fixturePath),
  fighters: fighters.length,
  decodedFighters: results.filter((result) => result.hexType !== null).length,
  parts: parts.length,
  matched: parts.filter((part) => part.status === "matched").length,
  mismatched: parts.filter((part) => part.status === "mismatch").length,
  unknown: parts.filter((part) => part.status === "unknown").length,
  mismatchSamples: results
    .flatMap((result) => result.parts.map((part) => ({ fighterId: result.fighterId, ...part })))
    .filter((part) => part.status !== "matched")
    .slice(0, 20)
};

console.log(JSON.stringify(summary, null, 2));
