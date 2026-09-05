import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";

process.env.RUNE_SCAN_ENRICHMENT_BATCH_SIZE = "2";
process.env.RUNE_SCAN_BATCH_PAUSE_MS = "0";
process.env.BATTLELOG_FETCH_CONCURRENCY = "5";
process.env.BATTLELOG_FETCH_ATTEMPTS = "1";
process.env.MAX_CONCURRENT_RUNE_SCAN_JOBS = "2";

const leaderboardRuneScanRoutes = (await import("./leaderboardRuneScanRoutes.js")).default;
const { rankCandidateCache } = await import("./leaderboardCandidates.js");
const { teamCache } = await import("./leaderboardCaches.js");
const { runeScanJobStore } = await import("./runeScanJobs.js");

const nativeFetch = globalThis.fetch;
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(leaderboardRuneScanRoutes);
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
  runeScanJobStore.clear();
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
  return new Response(
    JSON.stringify({
      _items: [
        {
          gameData: {
            gameMode: "ranked",
            startedAt: Date.now() - 60_000,
            endedAt: Date.now(),
            players: [
              {
                userID,
                team: {
                  fighters: [
                    { axieID: 1, position: 0, runes: runeId ? [runeId] : [] },
                    { axieID: 2, position: 1, runes: [] },
                    { axieID: 3, position: 2, runes: [] }
                  ]
                }
              }
            ]
          }
        }
      ]
    }),
    { status: 200 }
  );
}

test("POST rejects a request with no runeId", async () => {
  const response = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan?milestone=1`, { method: "POST" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "RUNE_ID_REQUIRED");
});

test("POST starts a job, GET reports progress through completion, unknown jobId 404s", async () => {
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(4, 1);
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      return battleLogResponse(userID, "rune-x");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const postResponse = await nativeFetch(
    `${baseUrl}/api/leaderboard/rune-scan?runeId=rune-x&milestone=2&rankMin=1&rankMax=4`,
    { method: "POST" }
  );
  assert.equal(postResponse.status, 202);
  const created = await postResponse.json();
  assert.ok(created.jobId);
  assert.ok(["queued", "running"].includes(created.status));

  let finished;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const getResponse = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan/${created.jobId}`);
    assert.equal(getResponse.status, 200);
    const job = await getResponse.json();
    if (job.status === "complete" || job.status === "failed") {
      finished = job;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.ok(finished, "job did not finish in time");
  assert.equal(finished.status, "complete");
  assert.deepEqual(finished.matches.map((m) => m.rank), [1, 2, 3, 4]);

  const missingResponse = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan/not-a-real-job-id`);
  assert.equal(missingResponse.status, 404);
});

test("DELETE cancels a running job at the next batch boundary", async () => {
  let releaseSecondBatch;
  const secondBatchGate = new Promise((resolve) => {
    releaseSecondBatch = resolve;
  });

  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) return candidateResponse(4, 1); // batch size 2 -> 2 batches
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      const rank = Number(userID.split("-")[1]);
      if (rank > 2) await secondBatchGate;
      return battleLogResponse(userID, "rune-x");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const postResponse = await nativeFetch(
    `${baseUrl}/api/leaderboard/rune-scan?runeId=rune-x&milestone=3&rankMin=1&rankMax=4`,
    { method: "POST" }
  );
  const created = await postResponse.json();

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const getResponse = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan/${created.jobId}`);
    const job = await getResponse.json();
    if (job.processedCount >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const deleteResponse = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan/${created.jobId}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);
  const cancelled = await deleteResponse.json();
  assert.equal(cancelled.status, "cancelled");

  releaseSecondBatch();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const finalGet = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan/${created.jobId}`);
  const finalJob = await finalGet.json();
  assert.equal(finalJob.status, "cancelled");
});

test("DELETE 404s for an unknown jobId", async () => {
  const response = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan/not-a-real-job-id`, { method: "DELETE" });
  assert.equal(response.status, 404);
});
