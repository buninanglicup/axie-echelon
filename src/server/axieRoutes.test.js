import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { createAxieRouter } from "./axieRoutes.js";

const ADDRESS = "0x93144b2cf85af14f50ba9875c3608fce81fb1805";
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(createAxieRouter({
    resolveAxieById: async () => ({ id: "1" }),
    getAxieMarketplaceDetails: async () => ({ id: "1" }),
    getProfileByRoninAddress: async () => ({ accountId: "acct-1", name: "Test Player" }),
    fetchAxiesOwnedByAddress: async () => ({ items: [], total: 0 }),
    getAllUserFighters: async () => ({ items: [], totalItems: 0 }),
    normalizeFighter: (fighter) => fighter,
    classifyCollectible: (fighter, normalized) => normalized
  }));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

test("an oversized limit is clamped to 100 and reflected in the response pageSize", async () => {
  const response = await fetch(`${baseUrl}/api/address/${ADDRESS}?limit=99999`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pageSize, 100);
});

test("a limit below 1 is clamped up to 1, not rejected", async () => {
  const response = await fetch(`${baseUrl}/api/address/${ADDRESS}?limit=-5`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pageSize, 1);
});