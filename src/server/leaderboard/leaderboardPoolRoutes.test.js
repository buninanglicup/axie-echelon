import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import leaderboardPoolRoutes from "./leaderboardPoolRoutes.js";
import { rankCandidateCache } from "./leaderboardCandidates.js";

const nativeFetch = globalThis.fetch;
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(leaderboardPoolRoutes);
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
});

test("returns 503 with Retry-After when the candidate pool is unavailable", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    if (upstreamCalls < 3) return new Response("unavailable", { status: 503, headers: { "retry-after": "0" } });
    return new Response("unavailable", { status: 503, headers: { "retry-after": "7" } });
  };

  const response = await nativeFetch(`${baseUrl}/api/leaderboard/pool?milestone=route-test&rankMax=30`);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "7");
  const body = await response.json();
  assert.match(body.error, /temporarily unavailable/i);
});

test("returns filtered, mapped players on a successful upstream response", async () => {
  globalThis.fetch = async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      rank: index + 1,
      topRank: index + 1,
      userID: `user-${index + 1}`,
      name: `Player ${index + 1}`,
      vstar: 2000 - index
    }));
    return new Response(JSON.stringify({ _items: items }), { status: 200 });
  };

  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/pool?milestone=route-test-2&rankMin=1&rankMax=5`
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.players.length, 5);
  assert.deepEqual(body.players.map((player) => player.rank), [1, 2, 3, 4, 5]);
  assert.equal(body.players[0].enrichment.status, "not_requested");
});
