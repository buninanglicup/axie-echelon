import assert from "node:assert/strict";
import test from "node:test";
import { buildBattleLogUrl, fetchArchivalBattleLogs, normalizeBattleLogs } from "./archivalBattleLogClient.js";

test("requests the archival battle-log endpoint at limit 100 and preserves coverage metadata", async () => {
  let requested;
  const result = await fetchArchivalBattleLogs({
    userId: "user/1",
    apiUrl: "https://example.test",
    apiKey: "test",
    fetchImpl: async (url) => {
      requested = new URL(url);
      return new Response(JSON.stringify({ _items: Array.from({ length: 100 }, () => ({ gameData: { gameMode: "ranked", endedAt: 1700000000 } })) }), { status: 200 });
    }
  });

  test("retries a transient 429 before persisting the archival response", async () => {
    let calls = 0;
    const result = await fetchArchivalBattleLogs({
      userId: "user-429",
      apiUrl: "https://example.test",
      apiKey: "test",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
        return new Response(JSON.stringify({ _items: [] }), { status: 200 });
      }
    });
    assert.equal(calls, 2);
    assert.equal(result.httpStatus, 200);
  });
  assert.equal(requested.pathname, "/origin/v2/community/users/user%2F1/battle-logs");
  assert.equal(requested.searchParams.get("limit"), "100");
  assert.equal(result.normalized.eraCoverage, "partial");
  assert.equal(result.checksum.length, 64);
});

test("classifies timestamp-ambiguous responses as unknown", () => {
  const normalized = normalizeBattleLogs("user-1", { _items: [{ gameData: { gameMode: "ranked" } }] });
  assert.equal(normalized.eraCoverage, "unknown");
  assert.equal(normalized.missingTimestampCount, 1);
});

test("builds a safe battle-log URL", () => {
  assert.match(buildBattleLogUrl({ apiUrl: "https://example.test", userId: "user/1" }), /user%2F1\/battle-logs\?limit=100$/);
});
