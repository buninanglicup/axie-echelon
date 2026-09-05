import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  appendLeaderboardScopeParams,
  createHistoricalLeaderboardScope,
  getCurrentLeaderboardControl,
  getLeaderboardEndpointPath,
  getLeaderboardScopeKey,
  getSelectedEraMilestone,
  getVisibleEraMilestones,
  isCurrentLeaderboardScope
} from "./leaderboardScope.js";

const finalScope = { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" };
const offseasonScope = { seasonId: 19, offSeasonMode: true, milestone: null, eraName: "Offseason" };
const rareScope = { seasonId: 19, offSeasonMode: false, milestone: 1, eraName: "Rare" };
const epicScope = { seasonId: 19, offSeasonMode: false, milestone: 2, eraName: "Epic" };
const mysticScope = { seasonId: 19, offSeasonMode: false, milestone: 3, eraName: "Mystic" };

test("uses distinct stable scope keys and omits milestone for offseason requests", () => {
  assert.equal(getLeaderboardScopeKey(finalScope), "season:19:milestone:4");
  assert.equal(getLeaderboardScopeKey(offseasonScope), "offseason:19");
  assert.equal(getLeaderboardEndpointPath(finalScope), "/origins/v2/season-leaderboards");
  assert.equal(getLeaderboardEndpointPath(offseasonScope), "/origins/v2/leaderboards");

  const seasonalParams = appendLeaderboardScopeParams(new URLSearchParams({ limit: "100" }), finalScope);
  const offseasonParams = appendLeaderboardScopeParams(new URLSearchParams({ limit: "100", milestone: "4" }), offseasonScope);
  assert.equal(seasonalParams.get("milestone"), "4");
  assert.equal(offseasonParams.has("milestone"), false);
});

test("rejects stale responses from a different leaderboard scope", () => {
  assert.equal(isCurrentLeaderboardScope(finalScope, finalScope), true);
  assert.equal(isCurrentLeaderboardScope(finalScope, offseasonScope), false);
  assert.equal(isCurrentLeaderboardScope(offseasonScope, finalScope), false);
});

test("automatic offseason leaves numeric tabs unselected while Final remains historical", () => {
  assert.equal(getSelectedEraMilestone(offseasonScope), null);

  const finalHistory = createHistoricalLeaderboardScope(offseasonScope, 4, "Final");
  assert.equal(finalHistory.seasonId, offseasonScope.seasonId);
  assert.equal(finalHistory.offSeasonMode, false);
  assert.equal(finalHistory.milestone, "4");
  assert.equal(finalHistory.eraName, "Final");
  assert.equal(getSelectedEraMilestone(finalHistory), "4");
  assert.equal(getLeaderboardEndpointPath(finalHistory), "/origins/v2/season-leaderboards");
  assert.equal(
    appendLeaderboardScopeParams(new URLSearchParams(), finalHistory).get("milestone"),
    "4"
  );
});

test("Rare, Epic, and Mystic stay selectable as seasonal history during offseason", () => {
  for (const [milestone, eraName] of [[1, "Rare"], [2, "Epic"], [3, "Mystic"]]) {
    const historicalScope = createHistoricalLeaderboardScope(offseasonScope, milestone, eraName);
    const params = appendLeaderboardScopeParams(new URLSearchParams({ limit: "50" }), historicalScope);

    assert.equal(historicalScope.offSeasonMode, false);
    assert.equal(getSelectedEraMilestone(historicalScope), String(milestone));
    assert.equal(getLeaderboardEndpointPath(historicalScope), "/origins/v2/season-leaderboards");
    assert.equal(params.get("milestone"), String(milestone));
  }
});

test("only shows eras reached by the automatic season progression", () => {
  assert.deepEqual(getVisibleEraMilestones(rareScope), ["1"]);
  assert.deepEqual(getVisibleEraMilestones(epicScope), ["1", "2"]);
  assert.deepEqual(getVisibleEraMilestones(mysticScope), ["1", "2", "3"]);
  assert.deepEqual(getVisibleEraMilestones(finalScope), ["1", "2", "3", "4"]);
  assert.deepEqual(getVisibleEraMilestones(offseasonScope), ["1", "2", "3", "4"]);
});

test("shows the Current control only when it adds navigation or identifies offseason", () => {
  assert.deepEqual(getCurrentLeaderboardControl(epicScope, false), {
    visible: false,
    label: "",
    actionable: false
  });
  assert.deepEqual(getCurrentLeaderboardControl(epicScope, true), {
    visible: true,
    label: "Current: Epic",
    actionable: true
  });
  assert.deepEqual(getCurrentLeaderboardControl(offseasonScope, false), {
    visible: true,
    label: "Current: Offseason",
    actionable: false
  });
  assert.deepEqual(getCurrentLeaderboardControl(offseasonScope, true), {
    visible: true,
    label: "Current: Offseason",
    actionable: true
  });
});

test("returning from historical Final restores the automatic offseason source", () => {
  const finalHistory = createHistoricalLeaderboardScope(offseasonScope, 4, "Final");
  assert.notEqual(getLeaderboardScopeKey(finalHistory), getLeaderboardScopeKey(offseasonScope));

  // The automatic resolver scope is retained unchanged while history is
  // selected, so using it again restores the current no-milestone source.
  const returnedScope = offseasonScope;
  const params = appendLeaderboardScopeParams(new URLSearchParams({ milestone: "4" }), returnedScope);
  assert.equal(getSelectedEraMilestone(returnedScope), null);
  assert.equal(getLeaderboardEndpointPath(returnedScope), "/origins/v2/leaderboards");
  assert.equal(params.has("milestone"), false);
  assert.equal(isCurrentLeaderboardScope(finalHistory, returnedScope), false);
});

test("frontend contains a current-season action without adding a fifth numeric era tab", () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const view = fs.readFileSync(new URL("./leaderboardView.js", import.meta.url), "utf8");
  const numericTabs = [...html.matchAll(/class="era-tab"[^>]*data-milestone="(\d+)"/g)].map((match) => match[1]);

  assert.deepEqual(numericTabs, ["1", "2", "3", "4"]);
  assert.match(html, /button id="offseason-status"[^>]*hidden[^>]*>Current: Offseason</);
  assert.doesNotMatch(html, /data-milestone="5"/);
  assert.ok(html.indexOf('id="offseason-status"') < html.indexOf('class="era-tabs"'));
  assert.match(view, /createHistoricalLeaderboardScope\(/);
  assert.match(view, /returnToAutomaticLeaderboardScope/);
  assert.match(view, /offseasonStatus\?\.addEventListener\("click", returnToAutomaticLeaderboardScope\)/);
});
