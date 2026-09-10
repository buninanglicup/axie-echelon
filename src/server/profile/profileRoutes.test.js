import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { createProfileRouter, isAccountIdentifier, isRoninIdentifier, resolveProfileIdentifier } from "./profileRoutes.js";

const ACCOUNT_ID = "11111111-2222-4333-8444-555555555555";
const AXIE_ACCOUNT_ID = "1ec9eb6f-4495-6cfc-a60c-0252ee9b2cde";
const RONIN_ADDRESS = "0x93144b2cf85af14f50ba9875c3608fce81fb1805";
let server;
let baseUrl;
let battleLogCalls;
let lookupCalls;

before(async () => {
  const app = express();
  app.use(createProfileRouter({
    lookupProfileByRoninAddress: async (address) => {
      lookupCalls.push(address);
      if (address === "0x0000000000000000000000000000000000000000") throw new Error("No Axie profile was found for this Ronin address.");
      return { accountId: ACCOUNT_ID, name: "Ronin Player" };
    },
    lookupProfileByAccountId: async (accountId) => ({
      name: accountId === AXIE_ACCOUNT_ID ? "Axie Player" : "Account Player",
      roninAddress: RONIN_ADDRESS
    }),
    getBattleLogPage: async (options) => {
      battleLogCalls.push(options);
      return { status: "ready", userID: options.userID, source: "live", items: [], totalItems: 0 };
    }
  }));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

test("recognizes both supported Ronin address prefixes", () => {
  assert.equal(isRoninIdentifier(RONIN_ADDRESS), true);
  assert.equal(isRoninIdentifier(`ronin:${RONIN_ADDRESS.slice(2)}`), true);
  assert.equal(isRoninIdentifier(ACCOUNT_ID), false);
  assert.equal(isAccountIdentifier(ACCOUNT_ID), true);
  assert.equal(isAccountIdentifier(AXIE_ACCOUNT_ID), true);
  assert.equal(isAccountIdentifier("not-a-player-id"), false);
});

test("normalizes a Ronin address before resolving its account ID", async () => {
  let receivedAddress;
  const resolved = await resolveProfileIdentifier(`ronin:${RONIN_ADDRESS.slice(2).toUpperCase()}`, {
    lookupProfileByRoninAddress: async (address) => { receivedAddress = address; return { accountId: ACCOUNT_ID, name: "Ronin Player" }; }
  });
  assert.equal(receivedAddress, RONIN_ADDRESS);
  assert.deepEqual(resolved, { accountId: ACCOUNT_ID, roninAddress: RONIN_ADDRESS, name: "Ronin Player" });
});

test("passes account IDs through without a GraphQL lookup", async () => {
  const resolved = await resolveProfileIdentifier(ACCOUNT_ID, { lookupProfileByRoninAddress: async () => { throw new Error("lookup should not run"); } });
  assert.deepEqual(resolved, { accountId: ACCOUNT_ID, roninAddress: null });
});

test("passes UUID-shaped Axie account IDs through even when their version is above five", async () => {
  const resolved = await resolveProfileIdentifier(AXIE_ACCOUNT_ID, { lookupProfileByRoninAddress: async () => { throw new Error("lookup should not run"); } });
  assert.deepEqual(resolved, { accountId: AXIE_ACCOUNT_ID, roninAddress: null });
});

test("route resolves Ronin input and returns canonical identity metadata", async () => {
  battleLogCalls = [];
  lookupCalls = [];
  const response = await fetch(`${baseUrl}/api/profile/ronin:${RONIN_ADDRESS.slice(2)}/battle-logs?milestone=4&seasonId=18`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(lookupCalls, [RONIN_ADDRESS]);
  assert.equal(battleLogCalls[0].userID, ACCOUNT_ID);
  assert.deepEqual(battleLogCalls[0].leaderboardScope, { milestone: "4", seasonId: "18", offSeasonMode: false });
  assert.equal(body.resolvedUserID, ACCOUNT_ID);
  assert.equal(body.resolvedRoninAddress, RONIN_ADDRESS);
  assert.equal(body.resolvedPlayerName, "Ronin Player");
});

test("route forwards a requested offset to the battle-log page loader", async () => {
  battleLogCalls = [];
  const response = await fetch(`${baseUrl}/api/profile/${ACCOUNT_ID}/battle-logs?offset=20`);
  assert.equal(response.status, 200);
  assert.equal(battleLogCalls[0].offset, 20);
});

test("route resolves a direct account ID to its Ronin address for the profile header", async () => {
  const response = await fetch(`${baseUrl}/api/profile/${AXIE_ACCOUNT_ID}/battle-logs`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.resolvedUserID, AXIE_ACCOUNT_ID);
  assert.equal(body.resolvedRoninAddress, RONIN_ADDRESS);
  assert.equal(body.resolvedPlayerName, "Axie Player");
});

test("route rejects malformed Ronin input before an upstream lookup", async () => {
  battleLogCalls = [];
  lookupCalls = [];
  const response = await fetch(`${baseUrl}/api/profile/ronin:not-an-address/battle-logs`);
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, "A valid Ronin address is required.");
  assert.deepEqual(lookupCalls, []);
  assert.deepEqual(battleLogCalls, []);
});

test("route rejects malformed account IDs before requesting battle logs", async () => {
  battleLogCalls = [];
  const response = await fetch(`${baseUrl}/api/profile/not-a-player-id/battle-logs`);
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, "Enter a valid player account ID or Ronin address.");
  assert.deepEqual(battleLogCalls, []);
});

test("route returns 404 for a valid Ronin address without a profile", async () => {
  const response = await fetch(`${baseUrl}/api/profile/0x0000000000000000000000000000000000000000/battle-logs`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error, "No Axie profile was found for this Ronin address.");
});
