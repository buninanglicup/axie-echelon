// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes.
//
// Design summary (agreed 2026-08-13):
// - A player "matches" a rune filter if ANY of the 3 axies on their team,
//   as of their most-recent RANKED battle, has that rune equipped (OR
//   across the team, single most-recent battle only -- this mirrors
//   lastRankedBattleTime and represents "current" loadout, not history).
// - Candidates are drawn from ranks 1-LEADERBOARD_MAX_RANK. Confirmed via
//   direct testing against Skymavis that season-leaderboards caps `limit`
//   at 100 ("Limit must be 100 or less"), so covering 200 ranks requires
//   two sequential upstream calls (offset 0, offset 100), merged.
// - The scan walks the FULL candidate range and returns every match, rather
//   than stopping at a fixed match count -- coverage matters more here than
//   response speed for rare runes. See the 2026-08-19 design discussion:
//   this "filter over the whole candidate pool, then paginate the output"
//   shape is intentional and is the model any future content filter (team
//   composition, etc.) should follow too -- pagination cannot correctly be
//   computed by slicing the raw rank range BEFORE filtering, since match
//   density across ranks is unknown ahead of time.
// - Every candidate's team lookup goes through the same teamCache /
//   fetchBattleLogsForClientDeduped path as normal leaderboard enrichment,
//   so repeated/different rune scans warm the same cache over time instead
//   of re-fetching players that were already looked up recently.
//
// NOTE: pagination of the OUTPUT (the filtered match list) is not yet
// implemented here -- this still returns every match unpaginated, same as
// before the split. That's Phase 2 work (see leaderboardConstants.js).
import { fetchRankCandidates } from "./leaderboardCandidates.js";
import { getCachedTeam, setCachedTeam, isTeamCacheStale, scheduleTeamRefresh } from "./leaderboardCaches.js";
import { fetchBattleLogsForClientDeduped } from "./battleLogClient.js";
import { mapWithConcurrency, BATTLELOG_FETCH_CONCURRENCY } from "../shared/concurrency.js";
import { LEADERBOARD_MAX_RANK } from "./leaderboardConstants.js";

// True if any fighter on the team currently has runeId equipped.
function teamHasRune(team, runeId) {
  if (!team || !Array.isArray(team.fighters)) return false;
  return team.fighters.some(
    (fighter) => Array.isArray(fighter.runes) && fighter.runes.includes(runeId)
  );
}

export async function scanLeaderboardForRune(runeId, eraMilestone) {
  const candidates = await fetchRankCandidates(eraMilestone, LEADERBOARD_MAX_RANK);

  const results = await mapWithConcurrency(
    candidates,
    async (player) => {
      const userID = player.userID;
      if (!userID) return null;

      let team = getCachedTeam(userID);
      if (!team) {
        team = await fetchBattleLogsForClientDeduped(userID, 20);
        if (team) setCachedTeam(userID, team);
      } else if (isTeamCacheStale(userID)) {
        scheduleTeamRefresh(userID);
      }

      if (!teamHasRune(team, runeId)) return null;

      return {
        rank: player.topRank || player.rank,
        name: player.name || userID,
        mmr: player.vstar || player.rating,
        winRate: player.win_rate !== null && player.win_rate !== undefined ? player.win_rate * 100 : null,
        dailyChange: player.daily_change || "-",
        recentForm: Array.isArray(player.recent_form) ? player.recent_form : [],
        team,
        lastRankedBattleTime: team?.lastRankedBattleTime || null,
        userID
      };
    },
    BATTLELOG_FETCH_CONCURRENCY
  );

  return results
    .filter(Boolean)
    .sort((a, b) => (Number(a.rank) || Infinity) - (Number(b.rank) || Infinity));
}
