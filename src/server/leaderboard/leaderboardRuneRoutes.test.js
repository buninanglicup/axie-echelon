import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import leaderboardRuneRoutes from "./leaderboardRuneRoutes.js";
import { rankCandidateCache } from "./leaderboardCandidates.js";
import { teamCache } from "./leaderboardCaches.js";

const nativeFetch = globalThis.fetch;
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(leaderboardRuneRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  rankCandidateCache.clear();
  teamCache.clear();
});

test("returns 400 with a stable code when runeId is missing", async () => {
  const response = await nativeFetch(`${baseUrl}/api/leaderboard/rune/%20`);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "RUNE_ID_REQUIRED");
});

test("returns 503 with Retry-After when the candidate pool is unavailable", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    if (upstreamCalls < 3) return new Response("unavailable", { status: 503, headers: { "retry-after": "0" } });
    return new Response("unavailable", { status: 503, headers: { "retry-after": "9" } });
  };

  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/rune/rune-x?milestone=rune-route-test&rankMax=30`
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "9");
  const body = await response.json();
  assert.equal(body.code, "LEADERBOARD_UPSTREAM_UNAVAILABLE");
});

test("returns 500 with a stable code on another scan failure", async () => {
  globalThis.fetch = async () => new Response("not json", { status: 200 });

  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/rune/rune-x?milestone=rune-route-test-2&rankMax=30`
  );

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "RUNE_SCAN_FAILED");
});

test("returns an empty successful result when candidates have no ranked battles", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) {
      const items = Array.from({ length: 3 }, (_, index) => ({
        rank: index + 1,
        topRank: index + 1,
        userID: `user-${index + 1}`,
        name: `Player ${index + 1}`,
        vstar: 2000 - index
      }));
      return new Response(JSON.stringify({ _items: items }), { status: 200 });
    }
    if (target.pathname.includes("battle-logs")) return new Response(JSON.stringify({ _items: [] }), { status: 200 });
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/rune/rune-x?milestone=rune-route-test-3&rankMax=3`
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.scannedRanks, 1000);
  assert.deepEqual(body.players, []);
});
