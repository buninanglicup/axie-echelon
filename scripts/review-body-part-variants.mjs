import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGenes } from "../src/geneDecoder.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(scriptDirectory, "../api-responses/body-part-profile-validation.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const slots = {
  Eyes: "eyes",
  Mouth: "mouth",
  Ears: "ears",
  Horn: "horn",
  Back: "back",
  Tail: "tail"
};
const records = new Map();

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return Object.values(value).map(text).filter(Boolean).join(", ");
  return String(value);
}

for (const profile of fixture.profiles || []) {
  for (const axie of profile.axies || []) {
    const decoded = decodeGenes(axie.genes);
    for (const part of axie.parts || []) {
      const slot = slots[part.type];
      const decodedPart = slot ? decoded?.parts?.[slot]?.dominant : null;
      if (!decodedPart || decodedPart.class !== String(part.class || "").toLowerCase()) continue;
      const key = [decodedPart.class, slot, decodedPart.id].join(":");
      if (!records.has(key)) records.set(key, new Map());
      if (!records.get(key).has(part.name)) {
        records.get(key).set(part.name, {
          sampleCount: 0,
          specialGenes: new Set(),
          titles: new Set(),
          bodyShapes: new Set(),
          axieIds: new Set()
        });
      }
      const nameRecord = records.get(key).get(part.name);
      nameRecord.sampleCount += 1;
      nameRecord.axieIds.add(String(axie.id));
      const specialGenes = text(part.specialGenes);
      if (specialGenes) nameRecord.specialGenes.add(specialGenes);
      if (axie.title) nameRecord.titles.add(axie.title);
      if (axie.bodyShape) nameRecord.bodyShapes.add(axie.bodyShape);
    }
  }
}

const review = [...records.entries()]
  .filter(([, names]) => names.size > 1)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, names]) => ({
    key,
    names: [...names.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, data]) => ({
      name,
      sampleCount: data.sampleCount,
      specialGenes: [...data.specialGenes].sort(),
      titles: [...data.titles].sort(),
      bodyShapes: [...data.bodyShapes].sort(),
      sampleAxieIds: [...data.axieIds].slice(0, 10)
    }))
  }));

console.log(JSON.stringify({
  fixture: path.relative(process.cwd(), fixturePath),
  reviewKeys: review.length,
  review,
  notes: [
    "A name is not classified as a variant automatically.",
    "specialGenes and bodyShape are observations from the same Axie record.",
    "Canonical names require explicit review of these grouped records."
  ]
}, null, 2));
