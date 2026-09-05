import { fetchRankCandidates } from "./leaderboardCandidates.js";
import { getCachedTeam, setCachedTeam, isTeamCacheStale, scheduleTeamRefresh } from "./leaderboardCaches.js";
import { fetchBattleLogsForClientDeduped } from "./battleLogClient.js";
import { mapWithConcurrency, BATTLELOG_FETCH_CONCURRENCY } from "../shared/concurrency.js";
import {
  LEADERBOARD_MAX_RANK,
  RUNE_SCAN_ENRICHMENT_BATCH_SIZE,
  RUNE_SCAN_BATCH_PAUSE_MS
} from "./leaderboardConstants.js";
import { fighterMatchesBodyParts } from "../../bodyPartFilter.js";

function teamMatchesBodyParts(team, selectedNames) {
  if (!team || !Array.isArray(team.fighters)) return { matched: false, known: false, parts: [] };
  const matches = [];
  let knownFighterCount = 0;

  for (const fighter of team.fighters) {
    const result = fighterMatchesBodyParts(fighter, selectedNames);
    if (result.known) knownFighterCount += 1;
    matches.push(...result.parts);
  }

  return {
    matched: matches.length > 0,
    known: knownFighterCount > 0,
    parts: matches
  };
}

async function enrichCandidateForBodyParts(player, selectedNames) {
  const userID = player.userID;
  if (!userID) return null;

  let team = getCachedTeam(userID);
  if (!team) {
    team = await fetchBattleLogsForClientDeduped(userID, 20, "low");
    if (team) setCachedTeam(userID, team);
  } else if (isTeamCacheStale(userID)) {
    scheduleTeamRefresh(userID);
  }

  const bodyPartResult = teamMatchesBodyParts(team, selectedNames);
  if (!bodyPartResult.matched) return null;

  return {
    rank: player.topRank || player.rank,
    name: player.name || userID,
    mmr: player.vstar || player.rating,
    winRate: player.win_rate !== null && player.win_rate !== undefined ? player.win_rate * 100 : null,
    dailyChange: player.daily_change || "-",
    recentForm: Array.isArray(player.recent_form) ? player.recent_form : [],
    team,
    bodyParts: bodyPartResult.parts,
    lastRankedBattleTime: team?.lastRankedBattleTime || null,
    userID
  };
}

export async function scanLeaderboardForBodyParts(
  selectedNames,
  eraMilestone,
  { rankMin = 1, rankMax = LEADERBOARD_MAX_RANK, name = "", onProgress } = {}
) {
  const requestedNames = [...new Set((Array.isArray(selectedNames) ? selectedNames : [selectedNames])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  const candidates = await fetchRankCandidates(eraMilestone, LEADERBOARD_MAX_RANK);
  const nameQuery = String(name || "").trim().toLowerCase();
  const narrowedCandidates = candidates.filter((player) => {
    const rank = Number(player.topRank || player.rank);
    if (!Number.isFinite(rank) || rank <= 0) return false;
    if (rank < rankMin || rank > rankMax) return false;
    if (nameQuery && !String(player.name || player.userID || "").toLowerCase().includes(nameQuery)) return false;
    return true;
  });

  const matches = [];
  if (narrowedCandidates.length === 0 && typeof onProgress === "function") {
    onProgress([], 0, 0);
  }
  for (let start = 0; start < narrowedCandidates.length; start += RUNE_SCAN_ENRICHMENT_BATCH_SIZE) {
    const batch = narrowedCandidates.slice(start, start + RUNE_SCAN_ENRICHMENT_BATCH_SIZE);
    const batchResults = await mapWithConcurrency(
      batch,
      (player) => enrichCandidateForBodyParts(player, requestedNames),
      BATTLELOG_FETCH_CONCURRENCY
    );
    const batchMatches = batchResults.filter(Boolean);
    matches.push(...batchMatches);
    if (typeof onProgress === "function") {
      onProgress(batchMatches, Math.min(start + batch.length, narrowedCandidates.length), narrowedCandidates.length);
    }

    const isLastBatch = start + RUNE_SCAN_ENRICHMENT_BATCH_SIZE >= narrowedCandidates.length;
    if (!isLastBatch && RUNE_SCAN_BATCH_PAUSE_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, RUNE_SCAN_BATCH_PAUSE_MS));
    }
  }

  return matches.sort((left, right) => (Number(left.rank) || Infinity) - (Number(right.rank) || Infinity));
}

export { teamMatchesBodyParts };
