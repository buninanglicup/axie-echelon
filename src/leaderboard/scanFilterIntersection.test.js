import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearScanFilterState,
  getVisibleScanMatches,
  intersectScanMatches,
  isCurrentScanUpdate
} from "./scanFilterIntersection.js";

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

test("shows all rune results when only rune filtering is active", () => {
  const runeMatches = [
    { userID: "rune-a", rank: 1 },
    { userID: "rune-b", rank: 2 }
  ];

  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: true,
      runeMatches,
      bodyPartFilterActive: false,
      bodyPartMatches: [{ userID: "body-only", rank: 3 }]
    }),
    runeMatches
  );
});

test("shows all body-part results when only body-part filtering is active", () => {
  const bodyPartMatches = [
    { userID: "body-a", rank: 1 },
    { userID: "body-b", rank: 2 }
  ];

  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: false,
      runeMatches: [{ userID: "rune-only", rank: 3 }],
      bodyPartFilterActive: true,
      bodyPartMatches
    }),
    bodyPartMatches
  );
});

test("intersects rune and body-part results only when both filters are active", () => {
  const runeMatches = [
    { userID: "matches-both", rank: 1 },
    { userID: "rune-only", rank: 2 }
  ];
  const bodyPartMatches = [
    { userID: "body-only", rank: 3 },
    { userID: "matches-both", rank: 1 }
  ];

  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: true,
      runeMatches,
      bodyPartFilterActive: true,
      bodyPartMatches
    }),
    [{ userID: "matches-both", rank: 1 }]
  );
});

test("does not collapse the OR results from multiple selected runes or body parts", () => {
  // The scan endpoints establish the OR semantics. The combined-result
  // helper must preserve every result they return while only that filter is
  // active; it must not accidentally turn either selection into an AND.
  const runeOrMatches = [
    { userID: "has-rune-a", rank: 1, matchedRuneIds: ["rune-a"] },
    { userID: "has-rune-b", rank: 2, matchedRuneIds: ["rune-b"] }
  ];
  const bodyPartOrMatches = [
    { userID: "has-part-a", rank: 3, matchedBodyPartNames: ["Clear"] },
    { userID: "has-part-b", rank: 4, matchedBodyPartNames: ["Hazy"] }
  ];

  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: true,
      runeMatches: runeOrMatches,
      bodyPartFilterActive: false,
      bodyPartMatches: []
    }),
    runeOrMatches
  );
  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: false,
      runeMatches: [],
      bodyPartFilterActive: true,
      bodyPartMatches: bodyPartOrMatches
    }),
    bodyPartOrMatches
  );
});

test("clearing body-part state preserves rune state, results, and unrelated filters", () => {
  const runeMatches = [{ userID: "rune-player", rank: 15 }];
  const initialState = {
    selectedRunes: [{ id: "rune-a", name: "Rune A" }],
    activeRuneId: "rune-a",
    runeFilterActive: true,
    selectedBodyPartNames: ["Clear"],
    bodyPartFilterActive: true,
    playerNameQuery: "player",
    rankMin: 10,
    rankMax: 100,
    activeBattleWindowMinutes: 5,
    liveModeEnabled: true,
    pollingIntervalSeconds: 30,
    currentEraMilestone: "4"
  };

  const cleared = clearScanFilterState(initialState, "body-part");

  assert.notEqual(cleared, initialState);
  assert.deepEqual(cleared.selectedBodyPartNames, []);
  assert.equal(cleared.bodyPartFilterActive, false);
  assert.deepEqual(cleared.selectedRunes, initialState.selectedRunes);
  assert.equal(cleared.runeFilterActive, true);
  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: cleared.runeFilterActive,
      runeMatches,
      bodyPartFilterActive: cleared.bodyPartFilterActive,
      bodyPartMatches: [{ userID: "body-player", rank: 20 }]
    }),
    runeMatches
  );
  assert.equal(cleared.playerNameQuery, "player");
  assert.equal(cleared.rankMin, 10);
  assert.equal(cleared.rankMax, 100);
  assert.equal(cleared.activeBattleWindowMinutes, 5);
  assert.equal(cleared.liveModeEnabled, true);
  assert.equal(cleared.pollingIntervalSeconds, 30);
  assert.equal(cleared.currentEraMilestone, "4");
});

test("clearing rune state preserves body-part state, results, and unrelated filters", () => {
  const bodyPartMatches = [{ userID: "body-player", rank: 15 }];
  const initialState = {
    selectedRunes: [{ id: "rune-a", name: "Rune A" }],
    activeRuneId: "rune-a",
    runeFilterActive: true,
    selectedBodyPartNames: ["Clear"],
    bodyPartFilterActive: true,
    playerNameQuery: "player",
    rankMin: 10,
    rankMax: 100,
    activeBattleWindowMinutes: 5,
    liveModeEnabled: true,
    pollingIntervalSeconds: 30,
    currentEraMilestone: "4"
  };

  const cleared = clearScanFilterState(initialState, "rune");

  assert.notEqual(cleared, initialState);
  assert.deepEqual(cleared.selectedRunes, []);
  assert.equal(cleared.activeRuneId, null);
  assert.equal(cleared.runeFilterActive, false);
  assert.deepEqual(cleared.selectedBodyPartNames, ["Clear"]);
  assert.equal(cleared.bodyPartFilterActive, true);
  assert.deepEqual(
    getVisibleScanMatches({
      runeFilterActive: cleared.runeFilterActive,
      runeMatches: [{ userID: "rune-player", rank: 20 }],
      bodyPartFilterActive: cleared.bodyPartFilterActive,
      bodyPartMatches
    }),
    bodyPartMatches
  );
  assert.equal(cleared.playerNameQuery, "player");
  assert.equal(cleared.rankMin, 10);
  assert.equal(cleared.rankMax, 100);
  assert.equal(cleared.activeBattleWindowMinutes, 5);
  assert.equal(cleared.liveModeEnabled, true);
  assert.equal(cleared.pollingIntervalSeconds, 30);
  assert.equal(cleared.currentEraMilestone, "4");
});

test("does not let a stale or cleared-filter response overwrite newer scan results", () => {
  let currentGeneration = 2;
  let filterActive = true;
  let renderedMatches = [{ userID: "newer-result", rank: 2 }];

  function applyResponse(generation, matches) {
    if (!isCurrentScanUpdate({ generation, currentGeneration, filterActive })) return false;
    renderedMatches = matches;
    return true;
  }

  assert.equal(applyResponse(2, renderedMatches), true);
  assert.equal(applyResponse(1, [{ userID: "late-result", rank: 1 }]), false);
  assert.deepEqual(renderedMatches, [{ userID: "newer-result", rank: 2 }]);

  currentGeneration = 3;
  assert.equal(applyResponse(2, [{ userID: "superseded-result", rank: 2 }]), false);
  assert.deepEqual(renderedMatches, [{ userID: "newer-result", rank: 2 }]);

  filterActive = false;
  assert.equal(applyResponse(3, [{ userID: "cleared-result", rank: 3 }]), false);
  assert.deepEqual(renderedMatches, [{ userID: "newer-result", rank: 2 }]);
});
