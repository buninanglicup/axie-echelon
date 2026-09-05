import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";

const leaderboardBodyPartScanRoutes = (await import("./leaderboardBodyPartScanRoutes.js")).default;
const leaderboardRuneScanRoutes = (await import("./leaderboardRuneScanRoutes.js")).default;
const {
  __setBodyPartScannerForTesting,
  bodyPartScanJobStore
} = await import("./bodyPartScanJobs.js");

const nativeFetch = globalThis.fetch;
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(leaderboardBodyPartScanRoutes);
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
  __setBodyPartScannerForTesting(async () => []);
  bodyPartScanJobStore.clear();
});

function installScanner(scanner = async () => []) {
  __setBodyPartScannerForTesting(scanner);
}

test("POST rejects missing or only-empty bodyPartName values", async () => {
  const missing = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan`, { method: "POST" });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "BODY_PART_NAME_REQUIRED");

  const empty = await nativeFetch(
    `${baseUrl}/api/leaderboard/body-part-scan?bodyPartName=%20%20&bodyPartName=`,
    { method: "POST" }
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "BODY_PART_NAME_REQUIRED");
});

test("POST accepts repeated names, trims inputs, and passes filters to the scoped job", async () => {
  let received;
  installScanner(async (bodyPartNames, leaderboardScope, options) => {
    received = { bodyPartNames, leaderboardScope, options };
    return [];
  });

  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/body-part-scan?bodyPartName=%20Hazy%20&bodyPartName=Clear&milestone=4&rankMin=3&rankMax=9&name=%20Player%20One%20`,
    { method: "POST" }
  );
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.deepEqual(job.bodyPartNames, ["Hazy", "Clear"]);
  assert.equal(job.eraMilestone, "4");
  assert.equal(job.rankMin, 3);
  assert.equal(job.rankMax, 9);
  assert.equal(job.name, "Player One");

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(received.bodyPartNames, ["Hazy", "Clear"]);
  assert.equal(received.leaderboardScope.offSeasonMode, false);
  assert.equal(received.leaderboardScope.milestone, "4");
  assert.equal(received.options.rankMin, 3);
  assert.equal(received.options.rankMax, 9);
  assert.equal(received.options.name, "Player One");
});

test("POST normalizes rank bounds and does not expose internal job fields", async () => {
  installScanner();
  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/body-part-scan?bodyPartName=Hazy&rankMin=-20&rankMax=9000`,
    { method: "POST" }
  );
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.equal(job.rankMin, 1);
  assert.equal(job.rankMax, 1000);
  for (const internalField of ["dedupKey", "cancelRequested", "pendingQueue", "lastPolledAt", "runningCount"]) {
    assert.equal(Object.hasOwn(job, internalField), false);
  }
});

test("POST clamps an oversized rankMin without inverting the range", async () => {
  installScanner();
  const response = await nativeFetch(
    `${baseUrl}/api/leaderboard/body-part-scan?bodyPartName=Hazy&rankMin=9000&rankMax=2`,
    { method: "POST" }
  );
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.equal(job.rankMin, 1000);
  assert.equal(job.rankMax, 1000);
});

test("GET returns a job snapshot and 404s for an unknown job", async () => {
  installScanner(async () => new Promise(() => {}));
  const createdResponse = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan?bodyPartName=Hazy`, { method: "POST" });
  const created = await createdResponse.json();

  const getResponse = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan/${created.jobId}`);
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).jobId, created.jobId);

  const missing = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan/not-a-real-job-id`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "BODY_PART_SCAN_JOB_NOT_FOUND");
});

test("DELETE returns a cancelled job snapshot and 404s for an unknown job", async () => {
  installScanner(async () => new Promise(() => {}));
  const createdResponse = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan?bodyPartName=Hazy`, { method: "POST" });
  const created = await createdResponse.json();

  const deleted = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan/${created.jobId}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).status, "cancelled");

  const missing = await nativeFetch(`${baseUrl}/api/leaderboard/body-part-scan/not-a-real-job-id`, { method: "DELETE" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "BODY_PART_SCAN_JOB_NOT_FOUND");
});

test("the existing rune scan route remains mounted and responds normally", async () => {
  const response = await nativeFetch(`${baseUrl}/api/leaderboard/rune-scan`, { method: "POST" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "RUNE_ID_REQUIRED");
});
