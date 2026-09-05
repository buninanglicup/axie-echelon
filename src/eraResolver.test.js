import assert from "node:assert/strict";
import { test } from "node:test";
import { getCurrentEraForConfiguredSeason, getEraBoundaries } from "./eraResolver.js";

const seasonStartedAt = 1783483200;
const seasonEndedAt = 1788319800;
const day = 24 * 60 * 60;

test("works backward from season end and preserves the configured Rare start", () => {
  const boundaries = getEraBoundaries();

  assert.deepEqual(boundaries.map(({ startMs, endMs }) => [startMs / 1000, endMs / 1000]), [
    [seasonStartedAt, seasonStartedAt + (14 * day) - 30 * 60],
    [seasonStartedAt + (14 * day) - 30 * 60, seasonStartedAt + (28 * day) - 30 * 60],
    [seasonStartedAt + (28 * day) - 30 * 60, seasonStartedAt + (42 * day) - 30 * 60],
    [seasonStartedAt + (42 * day) - 30 * 60, seasonEndedAt]
  ]);
});

test("resolves the final era using the backward-calculated boundary", () => {
  const final = getCurrentEraForConfiguredSeason((seasonEndedAt - 60) * 1000);

  assert.equal(final.milestone, 4);
  assert.equal(final.eraStartedAt, seasonEndedAt - (14 * day));
  assert.equal(final.eraEndsAt, seasonEndedAt);
  assert.equal(final.offSeasonMode, false);
});

test("resolves every active era at its exact start boundary", () => {
  const boundaries = getEraBoundaries();
  const expectedNames = ["Rare", "Epic", "Mystic", "Final"];

  for (const [index, boundary] of boundaries.entries()) {
    const era = getCurrentEraForConfiguredSeason(boundary.startMs);
    assert.equal(era.offSeasonMode, false);
    assert.equal(era.milestone, index + 1);
    assert.equal(era.eraName, expectedNames[index]);
  }
});

test("keeps the configured timestamp as the exact Rare start", () => {
  const rare = getCurrentEraForConfiguredSeason(seasonStartedAt * 1000);

  assert.equal(rare.offSeasonMode, false);
  assert.equal(rare.milestone, 1);
  assert.equal(rare.eraName, "Rare");
  assert.equal(rare.eraStartedAt, seasonStartedAt);
});

test("enters offseason at the configured season end without a milestone", () => {
  const atEnd = getCurrentEraForConfiguredSeason(seasonEndedAt * 1000);

  assert.equal(atEnd.seasonEndedAt, seasonEndedAt);
  assert.equal(atEnd.offSeasonMode, true);
  assert.equal(atEnd.milestone, null);
  assert.equal(atEnd.eraName, "Offseason");
});
