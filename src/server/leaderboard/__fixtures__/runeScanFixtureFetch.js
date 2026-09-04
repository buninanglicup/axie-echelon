import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "season18-rune-scan.fixture.json");

export function loadRuneScanFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function battleLogBody(userID, team) {
  if (!team) return { _items: [] };
  return { _items: [{ gameData: { gameMode: "ranked", startedAt: team.startedAt, endedAt: team.endedAt, players: [{ userID, team: { fighters: team.fighters } }] } }] };
}

export function createFixtureFetch(fixture, { onBattleLogCall } = {}) {
  return async (url) => {
    const target = new URL(url);
    if (target.pathname.includes("season-leaderboards")) {
      const offset = Number(target.searchParams.get("offset") || 0);
      const limit = Number(target.searchParams.get("limit") || 100);
      const items = fixture.candidates.filter((candidate) => candidate.rank > offset && candidate.rank <= offset + limit);
      return new Response(JSON.stringify({ _items: items }), { status: 200 });
    }
    if (target.pathname.includes("battle-logs")) {
      const userID = target.pathname.split("/").at(-2);
      if (onBattleLogCall) await onBattleLogCall(userID);
      if (fixture.erroredUserIDs.includes(userID)) return new Response("fixture failure", { status: 500 });
      return new Response(JSON.stringify(battleLogBody(userID, fixture.teams[userID])), { status: 200 });
    }
    throw new Error(`Unexpected fixture fetch: ${url}`);
  };
}
