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

  const response = await nativeFetch(`${baseUrl}/api/leaderboard/pool?milestone=1&rankMax=30`);

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
    `${baseUrl}/api/leaderboard/pool?milestone=2&rankMin=1&rankMax=5`
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.players.length, 5);
  assert.deepEqual(body.players.map((player) => player.rank), [1, 2, 3, 4, 5]);
  assert.equal(body.players[0].enrichment.status, "not_requested");
});

test("uses automatic offseason mode when no milestone is supplied", async () => {
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = new URL(url);
    return new Response(JSON.stringify({ _items: [] }), { status: 200 });
  };

  const response = await nativeFetch(`${baseUrl}/api/leaderboard/pool?rankMax=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.offSeasonMode, true);
  assert.equal(body.milestone, null);
  assert.equal(body.scopeKey, "offseason:19");
  assert.equal(upstreamUrl.pathname, "/origins/v2/leaderboards");
  assert.equal(upstreamUrl.searchParams.has("milestone"), false);
});

test("keeps explicit milestones on the seasonal endpoint during offseason", async () => {
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = new URL(url);
    return new Response(JSON.stringify({ _items: [] }), { status: 200 });
  };

  const response = await nativeFetch(`${baseUrl}/api/leaderboard/pool?milestone=4&rankMax=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.offSeasonMode, false);
  assert.equal(body.milestone, "4");
  assert.equal(upstreamUrl.pathname, "/origins/v2/season-leaderboards");
  assert.equal(upstreamUrl.searchParams.get("milestone"), "4");
});

test("keeps Rare, Epic, and Mystic on the seasonal endpoint during offseason", async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(new URL(url));
    return new Response(JSON.stringify({ _items: [] }), { status: 200 });
  };

  for (const milestone of ["1", "2", "3"]) {
    const response = await nativeFetch(`${baseUrl}/api/leaderboard/pool?milestone=${milestone}&rankMax=1`);
    assert.equal(response.status, 200);
  }

  assert.deepEqual(requestedUrls.map((url) => url.pathname), [
    "/origins/v2/season-leaderboards",
    "/origins/v2/season-leaderboards",
    "/origins/v2/season-leaderboards"
  ]);
  assert.deepEqual(requestedUrls.map((url) => url.searchParams.get("milestone")), ["1", "2", "3"]);
});

test("does not forward null or fifth-era milestone values", async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(new URL(url));
    return new Response(JSON.stringify({ _items: [] }), { status: 200 });
  };

  for (const invalidMilestone of ["null", "5"]) {
    const response = await nativeFetch(
      `${baseUrl}/api/leaderboard/pool?milestone=${invalidMilestone}&rankMax=1`
    );
    assert.equal(response.status, 200);
  }

  for (const requestedUrl of requestedUrls) {
    assert.equal(requestedUrl.pathname, "/origins/v2/leaderboards");
    assert.equal(requestedUrl.searchParams.has("milestone"), false);
  }
});
