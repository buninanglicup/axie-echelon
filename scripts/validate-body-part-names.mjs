import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGenes } from "../src/geneDecoder.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(scriptDirectory, "../api-responses/body-part-name-validation.json");
const cardsPath = path.resolve(scriptDirectory, "../src/data/cards.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const cards = JSON.parse(fs.readFileSync(cardsPath, "utf8"))._items || [];
const slots = {
  Eyes: "eyes",
  Mouth: "mouth",
  Ears: "ears",
  Horn: "horn",
  Back: "back",
  Tail: "tail"
};

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+(?:alpha|α|\+)$/i, "")
    .trim()
    .toLowerCase();
}

function cardCandidates(part) {
  return cards.filter((card) =>
    String(card.partClass || "").toLowerCase() === String(part.class || "").toLowerCase() &&
    String(card.partType || "").toLowerCase() === String(part.type || "").toLowerCase() &&
    normalizeName(card.name) === normalizeName(part.name)
  );
}

const results = [];
for (const axie of fixture.axies || []) {
  const decoded = decodeGenes(axie.genes);
  for (const part of axie.parts || []) {
    const slot = slots[part.type];
    const decodedPart = slot ? decoded?.parts?.[slot]?.dominant : null;
    const candidates = cardCandidates(part);
    const ids = [...new Set(candidates.map((candidate) => Number(candidate.partValue)))];
    results.push({
      axieId: axie.id,
      name: part.name,
      class: part.class,
      slot: part.type,
      decodedId: decodedPart?.id ?? null,
      cardValueCandidates: ids,
      status: !decodedPart
        ? "unknown"
        : ids.includes(decodedPart.id)
          ? "confirmed"
          : candidates.length
            ? "mismatch"
            : "no-card-candidate"
    });
  }
}

const summary = {
  fixture: path.relative(process.cwd(), fixturePath),
  parts: results.length,
  confirmed: results.filter((result) => result.status === "confirmed").length,
  mismatch: results.filter((result) => result.status === "mismatch").length,
  noCardCandidate: results.filter((result) => result.status === "no-card-candidate").length,
  unknown: results.filter((result) => result.status === "unknown").length,
  results
};
console.log(JSON.stringify(summary, null, 2));
