import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { baselineLimiter, createExpensiveRouteLimiter, liveModeLimiter } from "./rateLimiters.js";

let server;
let baseUrl;
let expensiveRouteLimiter;

before(async () => {
  expensiveRouteLimiter = createExpensiveRouteLimiter();
  const app = express();
  // Dummy handlers standing in for the real routes -- these tests exercise
  // the limiter middleware itself, not route business logic, matching how
  // profileRoutes.test.js injects fakes rather than hitting real upstreams.
  app.get("/api/address/:address", expensiveRouteLimiter, (request, response) => {
    response.json({ address: request.params.address });
  });
  app.get("/api/leaderboard", liveModeLimiter, (request, response) => {
    response.json({ liveMode: request.query.liveMode === "true" });
  });
  app.get("/api/leaderboard/pool", baselineLimiter, (request, response) => {
    response.json({ cached: true });
  });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

test("expensiveRouteLimiter returns 429 after its per-minute quota is exceeded", async () => {
  let lastStatus;
  for (let i = 0; i < 21; i++) {
    const response = await fetch(`${baseUrl}/api/address/0x0000000000000000000000000000000000000001`);
    lastStatus = response.status;
    if (i < 20) assert.equal(lastStatus, 200, `request ${i + 1} should still be within quota`);
  }
  assert.equal(lastStatus, 429);
});

test("liveModeLimiter blocks repeated liveMode=true polling after its hourly quota, but leaves non-liveMode requests unaffected", async () => {
  let lastLiveStatus;
  for (let i = 0; i < 151; i++) {
    const response = await fetch(`${baseUrl}/api/leaderboard?liveMode=true`);
    lastLiveStatus = response.status;
  }
  assert.equal(lastLiveStatus, 429);

  // A plain (non-liveMode) request on the same path, from the same
  // exhausted key-space, should still succeed -- confirms `skip` is
  // actually scoping the quota to liveMode traffic, not the whole route.
  const plainResponse = await fetch(`${baseUrl}/api/leaderboard`);
  assert.equal(plainResponse.status, 200);
});

test("normal cached-style reads under the baseline quota are unaffected by limiter logic", async () => {
  for (let i = 0; i < 50; i++) {
    const response = await fetch(`${baseUrl}/api/leaderboard/pool`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { cached: true });
  }
});

test("exactly 20 parallel requests to expensiveRouteLimiter are allowed, the 21st is rejected", async () => {
  const parallelLimiter = createExpensiveRouteLimiter();
  const app = express();
  app.get("/api/address/:address", parallelLimiter, (request, response) => {
    response.json({ address: request.params.address });
  });

  let parallelServer;
  await new Promise((resolve) => { parallelServer = app.listen(0, "127.0.0.1", resolve); });
  const parallelBaseUrl = `http://127.0.0.1:${parallelServer.address().port}`;

  try {
    const requests = Array.from({ length: 21 }, () =>
      fetch(`${parallelBaseUrl}/api/address/0x0000000000000000000000000000000000000001`)
    );
    const responses = await Promise.all(requests);
    const statuses = responses.map((response) => response.status);

    const allowed = statuses.filter((status) => status === 200);
    const limited = statuses.filter((status) => status === 429);

    assert.equal(allowed.length, 20, "expected exactly 20 requests to succeed under concurrent load");
    assert.equal(limited.length, 1, "expected exactly 1 request to be rejected");
  } finally {
    await new Promise((resolve) => parallelServer.close(resolve));
  }
});

test("429 response from expensiveRouteLimiter includes a Retry-After header", async () => {
  const retryAfterLimiter = createExpensiveRouteLimiter();
  const app = express();
  app.get("/api/address/:address", retryAfterLimiter, (request, response) => {
    response.json({ address: request.params.address });
  });

  let retryAfterServer;
  await new Promise((resolve) => { retryAfterServer = app.listen(0, "127.0.0.1", resolve); });
  const retryAfterBaseUrl = `http://127.0.0.1:${retryAfterServer.address().port}`;

  try {
    for (let i = 0; i < 20; i++) {
      await fetch(`${retryAfterBaseUrl}/api/address/0x0000000000000000000000000000000000000001`);
    }
    const response = await fetch(`${retryAfterBaseUrl}/api/address/0x0000000000000000000000000000000000000001`);

    assert.equal(response.status, 429);
    assert.ok(
      response.headers.get("retry-after"),
      "expected a Retry-After header on the 429 response"
    );
  } finally {
    await new Promise((resolve) => retryAfterServer.close(resolve));
  }
});