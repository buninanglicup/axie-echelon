import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.RUNE_SCAN_ENRICHMENT_BATCH_SIZE = "5";
process.env.RUNE_SCAN_BATCH_PAUSE_MS = "0";
process.env.BATTLELOG_FETCH_CONCURRENCY = "5";
process.env.BATTLELOG_FETCH_ATTEMPTS = "1";

const { scanLeaderboardForRune } = await import("./runeScanner.js");
const { rankCandidateCache } = await import("./leaderboardCandidates.js");
const { teamCache } = await import("./leaderboardCaches.js");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  rankCandidateCache.clear();
  teamCache.clear();
});

function candidateResponse(count, startRank) {
  const items = Array.from({ length: count }, (_, index) => ({
    rank: startRank + index,
    topRank: startRank + index,
    userID: `user-${startRank + index}`,
    name: `Player ${startRank + index}`,
    vstar: 3000 - (startRank + index)
  }));
  return new Response(JSON.stringify({ _items: items }), { status: 200 });
}

function battleLogResponse(userID, runeId) {
  return new Response(JSON.stringify({
    _items: [{
      gameData: {
        gameMode: "ranked",
        startedAt: Date.now() - 60_000,
        endedAt: Date.now(),
        players: [{
          userID,
          team: {
            fighters: [
              { axieID: 1, position: 0, runes: runeId ? [runeId] : [] },
              { axieID: 2, position: 1, runes: [] },
              { axieID: 3, position: 2, runes: [] }
            ]
          }
        }]
      }
    }]
  }), { status: 200 });
}

test("scans the full narrowed candidate range across enrichment batches", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(12, 1);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      const rank = Number(userID.split("-")[1]);
      return battleLogResponse(userID, rank % 4 === 0 ? "rune-x" : null);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const matches = await scanLeaderboardForRune(["rune-x"], "batch-test", { rankMin: 1, rankMax: 12 });
  assert.deepEqual(matches.map((match) => match.rank), [4, 8, 12]);
});

test("a failing battle-log fetch does not drop other candidates' matches", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(3, 1);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      if (userID === "user-2") return new Response("boom", { status: 500 });
      return battleLogResponse(userID, "rune-x");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const matches = await scanLeaderboardForRune(["rune-x"], "resilience-test", { rankMin: 1, rankMax: 3 });
  assert.deepEqual(matches.map((match) => match.rank), [1, 3]);
});
