import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGenes } from "../src/geneDecoder.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(scriptDirectory, "../api-responses/body-part-profile-validation.json");
const outputPath = path.resolve(scriptDirectory, "../src/data/body-part-mapping-candidate.json");
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

for (const profile of fixture.profiles || []) {
  for (const axie of profile.axies || []) {
    const decoded = decodeGenes(axie.genes);
    for (const part of axie.parts || []) {
      const slot = slots[part.type];
      const decodedPart = slot ? decoded?.parts?.[slot]?.dominant : null;
      if (!decodedPart || decodedPart.class !== String(part.class || "").toLowerCase()) continue;
      const key = [decodedPart.class, slot, decodedPart.id].join(":");
      if (!records.has(key)) {
        records.set(key, {
          class: decodedPart.class,
          slot,
          partValue: decodedPart.id,
          names: new Map(),
          sampleAxieIds: new Set()
        });
      }
      const record = records.get(key);
      if (!record.names.has(part.name)) {
        record.names.set(part.name, {
          specialGenes: new Set(),
          sampleCount: 0
        });
      }
      const nameRecord = record.names.get(part.name);
      nameRecord.sampleCount += 1;
      const specialGenes = Array.isArray(part.specialGenes)
        ? part.specialGenes
        : part.specialGenes
          ? [part.specialGenes]
          : [];
      for (const specialGene of specialGenes) nameRecord.specialGenes.add(String(specialGene));
      record.sampleAxieIds.add(String(axie.id));
    }
  }
}

const mappings = [...records.values()]
  .sort((left, right) => `${left.class}:${left.slot}:${left.partValue}`.localeCompare(`${right.class}:${right.slot}:${right.partValue}`))
  .map((record) => {
    const names = [...record.names.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, data]) => ({
        name,
        specialGenes: [...data.specialGenes].sort(),
        sampleCount: data.sampleCount
      }));
    const baseNames = names.filter((entry) => entry.specialGenes.length === 0);
    const canonicalName = baseNames.length === 1 ? baseNames[0].name : null;
    return {
      class: record.class,
      slot: record.slot,
      partValue: record.partValue,
      canonicalName,
      variants: names.filter((entry) => entry.name !== canonicalName),
      aliases: names.map((entry) => entry.name),
      status: canonicalName ? "candidate" : "review",
      sampleCount: record.sampleAxieIds.size
    };
  });

const output = {
  status: "candidate-only",
  source: "Sky Mavis GraphQL marketplace profile inventory",
  sourceFixture: "api-responses/body-part-profile-validation.json",
  notes: [
    "Names are captured independently from GraphQL parts responses.",
    "Keys are verified against local decoded dominant class, slot, and partValue.",
    "canonicalName is selected only when exactly one untagged base name is observed.",
    "This file is not runtime filtering data until review resolves aliases and variants."
  ],
  mappings
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${mappings.length} candidate mappings to ${path.relative(process.cwd(), outputPath)}`);
