import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getCachedTeam,
  getCachedTeamComposition,
  setCachedTeam,
  setCachedTeamComposition,
  teamCache,
  teamCompositionCache
} from "./leaderboardCaches.js";

const finalScope = { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" };
const offseasonScope = { seasonId: 19, offSeasonMode: true, milestone: null, eraName: "Offseason" };

afterEach(() => {
  teamCache.clear();
  teamCompositionCache.clear();
});

test("does not reuse a cached team across Final and offseason scopes", () => {
  const finalTeam = { fighters: [{ axieID: "final-axie" }] };
  const offseasonTeam = { fighters: [{ axieID: "offseason-axie" }] };

  setCachedTeam("user-1", finalTeam, finalScope);
  assert.deepEqual(getCachedTeam("user-1", finalScope), finalTeam);
  assert.equal(getCachedTeam("user-1", offseasonScope), null);

  setCachedTeam("user-1", offseasonTeam, offseasonScope);
  assert.deepEqual(getCachedTeam("user-1", finalScope), finalTeam);
  assert.deepEqual(getCachedTeam("user-1", offseasonScope), offseasonTeam);
});

test("does not reuse cached team compositions across Final and offseason scopes", () => {
  const finalFighters = [{ axieID: "final-axie" }];
  const offseasonFighters = [{ axieID: "offseason-axie" }];

  setCachedTeamComposition("user-1", finalFighters, finalScope);
  assert.deepEqual(getCachedTeamComposition("user-1", finalScope), finalFighters);
  assert.equal(getCachedTeamComposition("user-1", offseasonScope), null);

  setCachedTeamComposition("user-1", offseasonFighters, offseasonScope);
  assert.deepEqual(getCachedTeamComposition("user-1", finalScope), finalFighters);
  assert.deepEqual(getCachedTeamComposition("user-1", offseasonScope), offseasonFighters);
});
