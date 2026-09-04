import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRetryAfterMs } from "./httpRetry.js";

test("parses a numeric-seconds Retry-After header", () => {
  assert.equal(parseRetryAfterMs("5"), 5000);
});

test("parses an HTTP-date Retry-After header", () => {
  const future = new Date(Date.now() + 30_000);
  const milliseconds = parseRetryAfterMs(future.toUTCString());
  assert.ok(milliseconds > 25_000 && milliseconds <= 30_000, `expected about 30000ms, got ${milliseconds}`);
});

test("returns null for missing or unparseable headers", () => {
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs(undefined), null);
  assert.equal(parseRetryAfterMs("not-a-date"), null);
});

test("clamps a past HTTP-date to zero", () => {
  const past = new Date(Date.now() - 10_000).toUTCString();
  assert.equal(parseRetryAfterMs(past), 0);
});
