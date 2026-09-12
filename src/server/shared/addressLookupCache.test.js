import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDRESS_LOOKUP_CACHE_TTL_MS,
  addressLookupCache,
  getCachedAddressLookup,
  setCachedAddressLookup
} from "./addressLookupCache.js";

test("stores a normalized Ronin address lookup and reuses it", () => {
  const rawAddress = "ronin:93144b2cf85af14f50ba9875c3608fce81fb1805";
  const canonicalAddress = "0x93144b2cf85af14f50ba9875c3608fce81fb1805";
  const payload = { profile: { accountId: "abc-123" }, axies: [{ id: 1 }], totalItems: 1 };

  addressLookupCache.clear();
  setCachedAddressLookup(rawAddress, payload);

  assert.equal(addressLookupCache.has(canonicalAddress), true);

  const cached = getCachedAddressLookup(rawAddress);
  assert.ok(cached);
  assert.deepEqual(cached.profile, payload.profile);
  assert.deepEqual(cached.axies, payload.axies);
  assert.equal(cached.totalItems, 1);
});

test("expires stale address lookups after the TTL window", () => {
  const address = "0x93144b2cf85af14f50ba9875c3608fce81fb1805";
  addressLookupCache.set(address, {
    timestamp: Date.now() - ADDRESS_LOOKUP_CACHE_TTL_MS - 1,
    profile: { accountId: "abc-123" },
    axies: [],
    totalItems: 0
  });

  assert.equal(getCachedAddressLookup(address), null);
  assert.equal(addressLookupCache.has(address), false);
});
