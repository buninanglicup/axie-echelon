// validators.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanAxieId, cleanRoninAddress, cleanUserId } from "./validators.js";

const VALID_RONIN = "0x93144b2cf85af14f50ba9875c3608fce81fb1805";
const VALID_USER_ID = "1ec9eb6f-4495-6cfc-a60c-0252ee9b2cde"; // v6, variant "c" is in [89ab]? -- see note below

test("cleanAxieId accepts a plain numeric ID", () => {
  assert.equal(cleanAxieId("12345"), "12345");
  assert.equal(cleanAxieId("  67890  "), "67890");
});

test("cleanAxieId rejects non-numeric input", () => {
  assert.throws(() => cleanAxieId("abc123"), { message: "Axie ID must contain only numbers." });
  assert.throws(() => cleanAxieId(""), { message: "Axie ID must contain only numbers." });
  assert.throws(() => cleanAxieId("12.5"), { message: "Axie ID must contain only numbers." });
});

test("cleanRoninAddress normalizes the ronin: prefix and case", () => {
  assert.equal(cleanRoninAddress(VALID_RONIN), VALID_RONIN);
  assert.equal(cleanRoninAddress(`ronin:${VALID_RONIN.slice(2).toUpperCase()}`), VALID_RONIN);
  assert.equal(cleanRoninAddress(`RONIN:${VALID_RONIN.slice(2)}`), VALID_RONIN);
});

test("cleanRoninAddress rejects malformed addresses", () => {
  assert.throws(() => cleanRoninAddress("not-an-address"), { message: "A valid Ronin address is required." });
  assert.throws(() => cleanRoninAddress("0x123"), { message: "A valid Ronin address is required." });
  assert.throws(() => cleanRoninAddress(""), { message: "A valid Ronin address is required." });
});

test("cleanUserId accepts a valid UUIDv6 with any allowed variant nibble and case", () => {
  const upper = VALID_USER_ID.toUpperCase();
  assert.equal(cleanUserId(upper), VALID_USER_ID);
  assert.equal(cleanUserId(`  ${VALID_USER_ID}  `), VALID_USER_ID);
});

test("cleanUserId rejects malformed or wrong-version/variant input", () => {
  assert.throws(() => cleanUserId("not-a-uuid"), { message: "A valid userID is required." });
  // wrong version nibble (5 instead of 6)
  assert.throws(() => cleanUserId("1ec9eb6f-4495-5cfc-a60c-0252ee9b2cde"), { message: "A valid userID is required." });
  // wrong variant nibble (0 is not in [89ab])
  assert.throws(() => cleanUserId("1ec9eb6f-4495-6cfc-0a0c-0252ee9b2cde"), { message: "A valid userID is required." });
  assert.throws(() => cleanUserId(""), { message: "A valid userID is required." });
});