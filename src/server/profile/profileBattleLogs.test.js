import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBattleLogUrl, normalizeBattleForProfile, PROFILE_BATTLE_LOG_PAGE_SIZE } from "./profileBattleLogs.js";

const PLAYER_ID = "11111111-2222-4333-8444-555555555555";

test("buildBattleLogUrl requests an offset page and clamps profile page size to 20", () => {
  const page = buildBattleLogUrl(PLAYER_ID, 100, 20);
  assert.equal(PROFILE_BATTLE_LOG_PAGE_SIZE, 20);
  assert.equal(page.clampedLimit, 20);
  assert.equal(page.clampedOffset, 20);
  assert.match(page.url, /limit=20&offset=20$/);
});

test("normalizeBattleForProfile uses the upstream gameData UUID as the battle ID", () => {
  const item = normalizeBattleForProfile({
    gameData: {
      uuid: "battle-uuid-123",
      gameMode: "ranked",
      startedAt: 100,
      endedAt: 200,
      players: [{ userID: PLAYER_ID, team: { fighters: [{ axieID: 7, position: 0 }] } }]
    }
  }, PLAYER_ID);

  assert.equal(item.battleId, "battle-uuid-123");
});

test("normalizeBattleForProfile retains an opponent Ronin address for the profile tooltip and copy control", () => {
  const opponentAddress = "0x1234567890abcdef1234567890abcdef12345678";
  const item = normalizeBattleForProfile({
    gameData: {
      players: [
        { userID: PLAYER_ID, team: { fighters: [{ axieID: 7, position: 0 }] } },
        { userID: "opponent-id", name: "Opponent", addresses: { ronin: opponentAddress }, team: { fighters: [{ axieID: 8, position: 0 }] } }
      ]
    }
  }, PLAYER_ID);

  assert.equal(item.opponent.roninAddress, opponentAddress);
});
