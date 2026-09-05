import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  CandidatePoolUnavailableError,
  chunkCacheKey,
  fetchRankCandidates,
  rankCandidateCache
} from "./leaderboardCandidates.js";

const originalFetch = globalThis.fetch;
const finalScope = { seasonId: 19, offSeasonMode: false, milestone: 4, eraName: "Final" };
const offseasonScope = { seasonId: 19, offSeasonMode: true, milestone: null, eraName: "Offseason" };

function responseForItems(count, startRank = 1, headers = {}) {
  const items = Array.from({ length: count }, (_, index) => ({
    rank: startRank + index,
    userID: String(startRank + index)
  }));
  return new Response(JSON.stringify({ _items: items }), { status: 200, headers });
}

function upstreamUrl(url) {
  return new URL(url);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  rankCandidateCache.clear();
});

test("recovers from a transient 429 response", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
    return responseForItems(100);
  };

  const candidates = await fetchRankCandidates("retry-test", 30);

  assert.equal(calls, 2);
  assert.equal(candidates.length, 30);
});

test("deduplicates concurrent requests for the same canonical chunk", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return responseForItems(100);
  };

  const results = await Promise.all([
    fetchRankCandidates("dedup-test", 100),
    fetchRankCandidates("dedup-test", 100)
  ]);

  assert.equal(calls, 1);
  assert.equal(results[0].length, 100);
  assert.equal(results[1].length, 100);
});

test("reuses canonical chunks across requested pool sizes", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return responseForItems(100);
  };

  const first = await fetchRankCandidates("canonical-test", 30);
  const second = await fetchRankCandidates("canonical-test", 100);

  assert.equal(calls, 1);
  assert.equal(first.length, 30);
  assert.equal(second.length, 100);
  assert.equal(rankCandidateCache.size, 1);
});

test("retains successful chunks when a later chunk fails", async () => {
  const callsByOffset = new Map();
  globalThis.fetch = async (url) => {
    const offset = Number(upstreamUrl(url).searchParams.get("offset"));
    const calls = (callsByOffset.get(offset) || 0) + 1;
    callsByOffset.set(offset, calls);
    if (offset === 200 && calls === 1) {
      return new Response("unavailable", { status: 503, headers: { "retry-after": "0" } });
    }
    if (offset === 200 && calls < 4) {
      return new Response("still unavailable", { status: 503, headers: { "retry-after": "0" } });
    }
    return responseForItems(100, offset + 1);
  };

  await assert.rejects(
    fetchRankCandidates("partial-test", 300),
    (error) => error instanceof CandidatePoolUnavailableError && error.failedOffset === 200
  );
  assert.equal(rankCandidateCache.has(chunkCacheKey("partial-test", 0)), true);
  assert.equal(rankCandidateCache.has(chunkCacheKey("partial-test", 100)), true);
  assert.equal(rankCandidateCache.has(chunkCacheKey("partial-test", 200)), false);

  const candidates = await fetchRankCandidates("partial-test", 300);
  assert.equal(candidates.length, 300);
  assert.equal(callsByOffset.get(0), 1);
  assert.equal(callsByOffset.get(100), 1);
  assert.equal(callsByOffset.get(200), 4);
});

test("fails closed when a required chunk remains unavailable", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const offset = Number(upstreamUrl(url).searchParams.get("offset"));
    if (offset === 100) return new Response("unavailable", { status: 503, headers: { "retry-after": "0" } });
    return responseForItems(100, offset + 1);
  };

  await assert.rejects(
    fetchRankCandidates("fail-closed-test", 200),
    (error) => error instanceof CandidatePoolUnavailableError && error.failedOffset === 100
  );
  assert.equal(calls, 4);
  assert.equal(rankCandidateCache.has(chunkCacheKey("fail-closed-test", 0)), true);
  assert.equal(rankCandidateCache.has(chunkCacheKey("fail-closed-test", 100)), false);
});

test("uses the seasonal endpoint and milestone for a seasonal scope", async () => {
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return responseForItems(1);
  };

  const candidates = await fetchRankCandidates(finalScope, 1);

  assert.equal(requestedUrl.pathname, "/origins/v2/season-leaderboards");
  assert.equal(requestedUrl.searchParams.get("milestone"), "4");
  assert.deepEqual(candidates, [{ rank: 1, userID: "1" }]);
});

test("uses the offseason endpoint without a milestone and keeps candidate items unchanged", async () => {
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return responseForItems(1);
  };

  const candidates = await fetchRankCandidates(offseasonScope, 1);

  assert.equal(requestedUrl.pathname, "/origins/v2/leaderboards");
  assert.equal(requestedUrl.searchParams.has("milestone"), false);
  assert.deepEqual(candidates, [{ rank: 1, userID: "1" }]);
});

test("keeps Final and offseason cache and in-flight chunks separate", async () => {
  let calls = 0;
  let releaseFetches;
  const fetchGate = new Promise((resolve) => {
    releaseFetches = resolve;
  });
  globalThis.fetch = async () => {
    calls += 1;
    await fetchGate;
    return responseForItems(1);
  };

  const finalCandidates = fetchRankCandidates(finalScope, 1);
  const offseasonCandidates = fetchRankCandidates(offseasonScope, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls, 2);
  assert.notEqual(chunkCacheKey(finalScope, 0), chunkCacheKey(offseasonScope, 0));

  releaseFetches();
  await Promise.all([finalCandidates, offseasonCandidates]);
  assert.equal(rankCandidateCache.has(chunkCacheKey(finalScope, 0)), true);
  assert.equal(rankCandidateCache.has(chunkCacheKey(offseasonScope, 0)), true);
});
