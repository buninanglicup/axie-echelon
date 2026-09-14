import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { createLeaderboardEnrichmentRouter } from "./leaderboardEnrichmentRoutes.js";

const VALID_USER_ID = "1ec9eb6f-4495-6cfc-a60c-0252ee9b2cde";
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
  const response = await fetch(`${baseUrl}/api/leaderboard/team/${VALID_USER_ID}?milestone=4&historical=1`);
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
  const response = await fetch(`${baseUrl}/api/leaderboard/team/${VALID_USER_ID}?milestone=4`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "live");
  assert.equal(liveCalls, 1);
  assert.equal(snapshotCalls, 0);
});

test("route rejects a malformed userID before calling either enrichment loader", async () => {
  liveCalls = 0;
  snapshotCalls = 0;
  const response = await fetch(`${baseUrl}/api/leaderboard/team/not-a-user-id`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "A valid userID is required.");
  assert.equal(liveCalls, 0);
  assert.equal(snapshotCalls, 0);
});