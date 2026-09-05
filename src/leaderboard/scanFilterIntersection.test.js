import assert from "node:assert/strict";
import { test } from "node:test";
import { intersectScanMatches } from "./scanFilterIntersection.js";

test("intersects rune and body-part matches by user ID while preserving primary order", () => {
  const runeMatches = [
    { userID: "player-2", rank: 2 },
    { userID: "player-1", rank: 1 },
    { userID: "player-3", rank: 3 }
  ];
  const bodyPartMatches = [{ userID: "player-3" }, { userID: "player-1" }];

  assert.deepEqual(intersectScanMatches(runeMatches, bodyPartMatches), [
    { userID: "player-1", rank: 1 },
    { userID: "player-3", rank: 3 }
  ]);
});

test("uses rank as the fallback identity when a match has no user ID", () => {
  const primary = [{ rank: 10 }, { rank: 11 }];
  const secondary = [{ rank: 11 }];

  assert.deepEqual(intersectScanMatches(primary, secondary), [{ rank: 11 }]);
});

test("returns an empty intersection when no player matches both filters", () => {
  assert.deepEqual(
    intersectScanMatches([{ userID: "rune-only" }], [{ userID: "body-only" }]),
    []
  );
});