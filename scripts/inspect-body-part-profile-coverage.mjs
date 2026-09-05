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
const observations = new Map();
const failures = [];
let axieCount = 0;
let decodedCount = 0;

for (const profile of fixture.profiles || []) {
  for (const axie of profile.axies || []) {
    axieCount += 1;
    const decoded = decodeGenes(axie.genes);
    if (decoded) decodedCount += 1;
    for (const part of axie.parts || []) {
      const slot = slots[part.type];
      const decodedPart = slot ? decoded?.parts?.[slot]?.dominant : null;
      if (!decodedPart || decodedPart.class !== String(part.class || "").toLowerCase()) {
        failures.push({ axieId: axie.id, name: part.name, class: part.class, type: part.type, decoded: decodedPart || null });
        continue;
      }
      const key = [decodedPart.class, slot, decodedPart.id].join(":");
      if (!observations.has(key)) {
        observations.set(key, {
          class: decodedPart.class,
          slot,
          partValue: decodedPart.id,
          names: new Set(),
          axieIds: new Set()
        });
      }
      const observation = observations.get(key);
      observation.names.add(part.name);
      observation.axieIds.add(String(axie.id));
    }
  }
}

const records = [...observations.values()]
  .sort((left, right) => `${left.class}:${left.slot}:${left.partValue}`.localeCompare(`${right.class}:${right.slot}:${right.partValue}`))
  .map((observation) => ({
    class: observation.class,
    slot: observation.slot,
    partValue: observation.partValue,
    names: [...observation.names].sort(),
    sampleCount: observation.axieIds.size
  }));

console.log(JSON.stringify({
  fixture: path.relative(process.cwd(), fixturePath),
  axies: axieCount,
  decodedAxies: decodedCount,
  uniqueMappings: records.length,
  mismatches: failures.length,
  namesWithMultipleIdsOrVariants: records.filter((record) => record.names.length > 1).length,
  failures: failures.slice(0, 20),
  records
}, null, 2));
