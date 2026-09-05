import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { decodeGenes } from "./geneDecoder.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../ListUserFighters.json", import.meta.url), "utf8"));
const slots = {
  Eyes: "eyes",
  Mouth: "mouth",
  Ears: "ears",
  Horn: "horn",
  Back: "back",
  Tail: "tail"
};

test("decodes captured dominant body-part IDs and classes", () => {
  let checkedParts = 0;

  for (const fighter of fixture._items) {
    const decoded = decodeGenes(fighter.genesMetamorph || fighter.genes);
    assert.ok(decoded, `fixture fighter ${fighter.id} should decode`);

    for (const referencePart of fighter.parts) {
      const slot = slots[referencePart.part_type];
      const actual = decoded.parts[slot].dominant;
      assert.equal(actual.id, referencePart.part_value, `${fighter.id} ${slot} ID`);
      assert.equal(actual.class, referencePart.part_class.toLowerCase(), `${fighter.id} ${slot} class`);
      checkedParts += 1;
    }
  }

  assert.equal(checkedParts, 120);
});

test("returns null for malformed genes", () => {
  assert.equal(decodeGenes("not-a-gene"), null);
  assert.equal(decodeGenes("0x"), null);
});
