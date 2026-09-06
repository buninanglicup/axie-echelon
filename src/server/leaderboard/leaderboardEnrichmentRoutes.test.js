import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { createLeaderboardEnrichmentRouter } from "./leaderboardEnrichmentRoutes.js";

let server;
let baseUrl;
let liveCalls = 0;
let snapshotCalls = 0;

before(async () => {
  const app = express();
  app.use(createLeaderboardEnrichmentRouter({
    getLiveEnrichment: async () => {
      liveCalls += 1;
      return { status: "ready", source: "live", team: { fighters: [] } };
    },
    getSnapshotEnrichment: async ({ userID, leaderboardScope }) => {
      snapshotCalls += 1;
      return {
        status: "ready",
        source: "historical-snapshot",
        team: { fighters: [{ axieID: 7 }] },
        snapshot: { scopeKey: `season:${leaderboardScope.seasonId}:milestone:${leaderboardScope.milestone}`, requestedUserID: userID }
      };
    }
  }));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("uses an accepted historical snapshot path without live enrichment", async () => {
  liveCalls = 0;
  snapshotCalls = 0;
  const response = await fetch(`${baseUrl}/api/leaderboard/team/player-1?milestone=4&historical=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "historical-snapshot");
  assert.equal(body.team.fighters[0].axieID, 7);
  assert.equal(snapshotCalls, 1);
  assert.equal(liveCalls, 0);
});

test("keeps automatic seasonal enrichment on the live path", async () => {
  liveCalls = 0;
  snapshotCalls = 0;
  const response = await fetch(`${baseUrl}/api/leaderboard/team/player-1?milestone=4`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "live");
  assert.equal(liveCalls, 1);
  assert.equal(snapshotCalls, 0);
});
