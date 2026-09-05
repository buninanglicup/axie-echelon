import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(scriptDirectory, "../ListUserFighters.json");
const cardsPath = path.resolve(scriptDirectory, "../src/data/cards.json");
const fighters = JSON.parse(fs.readFileSync(fixturePath, "utf8"))._items || [];
const cards = JSON.parse(fs.readFileSync(cardsPath, "utf8"))._items || [];

function key(partClass, partType, partValue) {
  return [String(partClass || "").toLowerCase(), String(partType || "").toLowerCase(), Number(partValue)].join(":");
}

const observed = new Map();
for (const fighter of fighters) {
  for (const part of fighter.parts || []) {
    const entryKey = key(part.part_class, part.part_type, part.part_value);
    if (!observed.has(entryKey)) {
      observed.set(entryKey, {
        class: part.part_class,
        slot: part.part_type,
        value: Number(part.part_value),
        skins: new Set(),
        fighters: new Set()
      });
    }
    const entry = observed.get(entryKey);
    entry.skins.add(Number(part.part_skin));
    entry.fighters.add(String(fighter.id));
  }
}

const cardCandidates = new Map();
for (const card of cards) {
  const entryKey = key(card.partClass, card.partType, card.partValue);
  if (!cardCandidates.has(entryKey)) cardCandidates.set(entryKey, new Set());
  cardCandidates.get(entryKey).add(card.name);
}

const entries = [...observed.values()]
  .sort((left, right) => key(left.class, left.slot, left.value).localeCompare(key(right.class, right.slot, right.value)))
  .map((entry) => {
    const candidateNames = [...(cardCandidates.get(key(entry.class, entry.slot, entry.value)) || [])].sort();
    return {
      class: entry.class,
      slot: entry.slot,
      value: entry.value,
      observedSkins: [...entry.skins].sort((left, right) => left - right),
      fixtureFighters: entry.fighters.size,
      cardNameCandidates: candidateNames,
      cardEvidence: candidateNames.length ? "candidate-only" : "none"
    };
  });

console.log(JSON.stringify({
  fixture: path.relative(process.cwd(), fixturePath),
  observedKeys: entries.length,
  keysWithCardCandidates: entries.filter((entry) => entry.cardNameCandidates.length > 0).length,
  entries
}, null, 2));
