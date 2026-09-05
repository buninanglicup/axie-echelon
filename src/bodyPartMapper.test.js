import assert from "node:assert/strict";
import { test } from "node:test";
import { getBodyPartMapping, getBodyPartNames, matchBodyPartName } from "./bodyPartMapper.js";

test("resolves a canonical part and its collectible variants", () => {
  const part = { class: "aquatic", slot: "eyes", id: 2 };
  const mapping = getBodyPartMapping(part);

  assert.equal(mapping.canonicalName, "Sleepless");
  assert.deepEqual(getBodyPartNames(part), ["Sleepless", "Insomnia", "Yen"]);
  assert.equal(matchBodyPartName(part, "Sleepless"), true);
  assert.equal(matchBodyPartName(part, "Yen"), true);
});

test("resolves Shiitake's Japan variant without changing its base name", () => {
  const part = { class: "plant", slot: "back", id: 4 };
  const mapping = getBodyPartMapping(part);

  assert.equal(mapping.canonicalName, "Shiitake");
  assert.equal(matchBodyPartName(part, "Yakitori"), true);
  assert.equal(matchBodyPartName(part, "Unknown Part"), false);
});

test("returns no mapping for invalid or unknown decoded parts", () => {
  assert.equal(getBodyPartMapping({ class: "plant", slot: "back", id: 999 }), null);
  assert.deepEqual(getBodyPartNames(null), []);
  assert.equal(matchBodyPartName({ class: "plant", slot: "back", id: 4 }, ""), false);
});
