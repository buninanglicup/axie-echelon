import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { decodeFighterBodyParts, fighterMatchesBodyParts } from "./bodyPartFilter.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../api-responses/body-part-name-validation.json", import.meta.url), "utf8"));
const firstAxie = fixture.axies[0];

test("decodes dominant body parts from GraphQL genes", () => {
  const parts = decodeFighterBodyParts({ genes: firstAxie.genes });
  assert.equal(parts.length, 6);
  assert.equal(parts.find((part) => part.slot === "eyes").id, 4);
});

test("matches canonical names and verified variants", () => {
  const result = fighterMatchesBodyParts({ genes: firstAxie.genes }, ["Clear"]);
  assert.equal(result.known, true);
  assert.equal(result.matched, true);

  const variantResult = fighterMatchesBodyParts({ genes: firstAxie.genes }, ["Hazy"]);
  assert.equal(variantResult.matched, true);
});

test("uses OR semantics across selected names", () => {
  const result = fighterMatchesBodyParts({ genes: firstAxie.genes }, ["Missing Part", "Silence Whisper"]);
  assert.equal(result.matched, true);
  assert.equal(result.parts[0].slot, "mouth");
});

test("treats malformed starter genes as unknown", () => {
  const result = fighterMatchesBodyParts({ genes: "0x0" }, ["Clear"]);
  assert.equal(result.known, true);
  assert.equal(result.matched, false);
  assert.equal(fighterMatchesBodyParts({ genes: "not-a-gene" }, ["Clear"]).known, false);
});
