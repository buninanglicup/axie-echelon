import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";

process.env.RUNE_SCAN_ENRICHMENT_BATCH_SIZE = "5";
process.env.RUNE_SCAN_BATCH_PAUSE_MS = "0";
process.env.BATTLELOG_FETCH_CONCURRENCY = "5";
process.env.BATTLELOG_FETCH_ATTEMPTS = "1";

const { scanLeaderboardForBodyParts } = await import("./bodyPartScanner.js");
const { rankCandidateCache } = await import("./leaderboardCandidates.js");
const { teamCache } = await import("./leaderboardCaches.js");

const originalFetch = globalThis.fetch;
const fixture = JSON.parse(fs.readFileSync(new URL("../../../api-responses/body-part-name-validation.json", import.meta.url), "utf8"));
const genes = fixture.axies[0].genes;

afterEach(() => {
  globalThis.fetch = originalFetch;
  rankCandidateCache.clear();
  teamCache.clear();
});

function candidateResponse(count, startRank = 1) {
  return new Response(JSON.stringify({
    _items: Array.from({ length: count }, (_, index) => ({
      rank: startRank + index,
      topRank: startRank + index,
      userID: `user-${startRank + index}`,
      name: `Player ${startRank + index}`,
      vstar: 3000 - (startRank + index)
    }))
  }), { status: 200 });
}

function battleLogResponse(userID, includesPart) {
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
              { axieID: 1, genes: includesPart ? genes : "not-a-gene", genes_metamorph: "", position: 0 },
              { axieID: 2, genes: "not-a-gene", position: 1 },
              { axieID: 3, genes: "not-a-gene", position: 2 }
            ]
          }
        }]
      }
    }]
  }), { status: 200 });
}

test("scans narrowed candidates for canonical and variant body parts", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(6);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      const rank = Number(userID.split("-")[1]);
      return battleLogResponse(userID, rank % 2 === 0);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const matches = await scanLeaderboardForBodyParts(["Hazy"], "body-part-test", { rankMin: 1, rankMax: 6 });
  assert.deepEqual(matches.map((match) => match.rank), [2, 4, 6]);
  assert.equal(matches[0].bodyParts[0].mapping.canonicalName, "Clear");
});

test("applies name and rank narrowing before enrichment", async () => {
  let battleLogCalls = 0;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(6);
    if (target.pathname.includes("battle-logs")) {
      battleLogCalls += 1;
      return battleLogResponse(target.pathname.split("/").at(-2), true);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const matches = await scanLeaderboardForBodyParts(["Clear"], "body-part-narrowing-test", {
    rankMin: 2,
    rankMax: 5,
    name: "Player 3"
  });
  assert.deepEqual(matches.map((match) => match.rank), [3]);
  assert.equal(battleLogCalls, 1);
});

test("uses a valid stale cached team without scheduling a refresh during a scan", async () => {
  let battleLogCalls = 0;
  teamCache.set("user-1", {
    timestamp: Date.now() - 6 * 60 * 1000,
    team: {
      fighters: [
        { axieID: 1, genes, genes_metamorph: "", position: 0 },
        { axieID: 2, genes: "not-a-gene", position: 1 },
        { axieID: 3, genes: "not-a-gene", position: 2 }
      ]
    }
  });
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(1, 1);
    if (target.pathname.includes("battle-logs")) {
      battleLogCalls += 1;
      return battleLogResponse("user-1", true);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const matches = await scanLeaderboardForBodyParts(["Clear"], "stale-cache-test", { rankMin: 1, rankMax: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(matches.map((match) => match.rank), [1]);
  assert.equal(battleLogCalls, 0);
});
