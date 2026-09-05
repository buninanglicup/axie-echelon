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
  assert.equal(final.seasonOver, false);
});

test("marks the season over at the configured season end", () => {
  const atEnd = getCurrentEraForConfiguredSeason(seasonEndedAt * 1000);

  assert.equal(atEnd.seasonEndedAt, seasonEndedAt);
  assert.equal(atEnd.seasonOver, true);
  assert.equal(atEnd.milestone, 4);
});