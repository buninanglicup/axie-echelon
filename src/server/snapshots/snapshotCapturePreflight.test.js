import assert from "node:assert/strict";
import test from "node:test";
import { requireSnapshotApiKey } from "./snapshotCapturePreflight.js";

test("rejects missing credentials before a caller can make a fetch", () => {
  let fetchCalled = false;
  assert.throws(() => {
    const key = requireSnapshotApiKey("");
    fetchCalled = true;
    return fetch(key);
  }, /AXIE_ECHELON_API_KEY is required/);
  assert.equal(fetchCalled, false);
});

test("does not include credentials in the actionable error", () => {
  assert.throws(
    () => requireSnapshotApiKey(""),
    (error) => !error.message.includes("test-secret")
  );
});
