// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes.
import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { mapWithConcurrency, BATTLELOG_FETCH_CONCURRENCY } from "../shared/concurrency.js";
import { resolvePlayerProfile } from "../shared/profileCache.js";
import { fetchBattleLogsForClientDeduped } from "./battleLogClient.js";
import {
  getCachedTeam,
  setCachedTeam,
  isTeamCacheStale,
  scheduleTeamRefresh,
  getCachedTeamComposition,
  setCachedTeamComposition,
  getCachedPage,
  setCachedPage,
  inFlightPageRefreshes,
  getCachedGlobalAvgMatchDuration,
  setCachedGlobalAvgMatchDuration
} from "./leaderboardCaches.js";
import { SEASON_LEADERBOARD_API_MAX_LIMIT, MIN_VALID_MATCH_DURATION_MS } from "./leaderboardConstants.js";

// ===== LEADERBOARD ENRICHMENT =====
// Fetch the leaderboard page from Skymavis and enrich each player with recent ranked battle team data.
// This function is responsible for taking the raw leaderboard page, attaching team/battle info,
// and exposing lastRankedBattleTime to the frontend.
//
// Upstream endpoint: GET https://api-gateway.skymavis.com/origins/v2/season-leaderboards?limit=N&offset=O&milestone=M
// (Note: plural '/origins/')
//
// Parameters:
//   limit       - number of players requested (we merge multiple upstream calls if >100)
//   offset      - starting rank (0 = rank 1, 100 = rank 101, etc.)
//   eraMilestone - numeric era selector sent to Skymavis as `milestone`
//
// Upstream constraint: Skymavis caps single request at 100 rows.
// Our workaround: if requesting >100 rows (e.g., limit=200), we issue 2 upstream calls
// (offset=0,limit=100 + offset=100,limit=100) and merge before enrichment.
//
// Response enrichment: For each player, we fetch battle logs to get their current 3-axie team,
// which allows frontend to render morph previews.
//
// *** Caching strategy for YOUR use case ***
// You need to know ASAP when a top-rank player finishes a battle (lastRankedBattleTime).
// Therefore:
//   - Shorter leaderboard page cache: 30-60s (not 5 min) to catch rank changes
//   - Longer team cache: 10+ min (teams rarely change mid-session)
//   - Keep polling at 30s interval to stay within API budgets
//
// *** UPDATED 2026-08-19: live mode no longer bypasses caching wholesale ***
// The old behavior ("DISABLED in live mode") bypassed BOTH the profile
// lookup and the team cache on every single poll, for every player, which
// is more than this feature actually needs. The only thing that must be
// fresh every poll, in live mode, is `lastRankedBattleTime` -- because
// that's the one signal that tells you a player just finished a ranked
// battle. Team composition (which axies, which runes) and profile/address
// data do not need to be re-fetched just because live mode is on. See the
// per-cache comments in shared/profileCache.js (PROFILE_CACHE_TTL_MS) and
// leaderboardConstants.js (TEAM_COMPOSITION_CACHE_TTL_MS), and the liveMode
// branch below for the concrete split:
//   - Profile/address: ALWAYS cached (long TTL), live mode or not.
//   - Team composition: ALWAYS cached (long TTL) once known; live mode
//     still fetches fresh every poll (see note below on why), but falls
//     back to the cached composition if that fetch fails, rather than
//     showing nothing.
//   - lastRankedBattleTime: NEVER cached. In live mode it is read only from
//     this poll's fresh fetch result. If that fetch fails, the timestamp is
//     returned as null (explicitly "unknown this cycle") -- it is NOT
//     backfilled from a previous cycle's value. This is a deliberate
//     accuracy requirement: a stale timestamp that LOOKS fresh is worse
//     than an honest "unknown."
//   - recentRankedBattles: NEVER cached (live-mode-only feature). Same
//     never-stale guarantee as lastRankedBattleTime. Used by Phase 2+ for
//     match-duration and pause calculations. Refer to formatting.js for
//     implementation details on how the pause averages are computed.
//
// *** Frontend note (resolved 2026-08-19) ***
// src/main.js's hydrateLeaderboard() used to backfill lastRankedBattleTime
// from a previous poll cycle whenever a fetch failed, which would have
// defeated the "never stale-reused" guarantee this function provides. That
// frontend logic has since been removed -- see src/leaderboard/leaderboardView.js
// (post file-split) for the current behavior, which trusts this function's
// null/battleTimeFetchFailed fields as-is.

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Computes (or returns the cached) global average ranked-match duration
// across all currently-enriched players' recentRankedBattles. Uses MEDIAN
// rather than mean to resist skew from long outlier matches -- Axie battle
// duration likely has high variance (fast sweeps vs. close 3-round
// battles), and a single very long match shouldn't drag the whole
// estimate. Matches shorter than MIN_VALID_MATCH_DURATION_MS are excluded
// as likely surrenders/early exits, not representative match lengths.
//
// Returns null (not a fallback default like 180s) if no valid durations
// exist across the current snapshot -- an honest "unknown" is preferred
// over a guessed number here, consistent with how lastRankedBattleTime is
// never backfilled with a stale value (see this file's top comment).
//
// Point-in-time only: recomputed from whatever's in the current poll
// snapshot when the cache expires, with no cross-poll accumulation. TTL is
// AVG_MATCH_DURATION_CACHE_TTL_MS (see leaderboardConstants.js for why
// it's a static value, not derived from the user's polling interval).
function computeGlobalAvgMatchDurationMs(enrichedPlayers) {
  const cached = getCachedGlobalAvgMatchDuration();
  if (cached !== undefined) return cached;

  const durations = [];
  for (const player of enrichedPlayers) {
    if (!Array.isArray(player.recentRankedBattles)) continue;
    for (const battle of player.recentRankedBattles) {
      const startMs = Date.parse(battle.startedAt);
      const endMs = Date.parse(battle.endedAt);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
      const durationMs = endMs - startMs;
      if (durationMs >= MIN_VALID_MATCH_DURATION_MS) {
        durations.push(durationMs);
      }
    }
  }

  const result = durations.length > 0 ? median(durations) : null;
  setCachedGlobalAvgMatchDuration(result);
  if (DEBUG_ON) console.log(`[computeGlobalAvgMatchDurationMs] ${durations.length} valid durations, median=${result}`);
  return result;
}

export async function fetchAndEnrichLeaderboard(limit, offset, eraMilestone, liveMode = false) {
  const requestedLimit = Math.max(1, Number(limit) || 20);
  const requestedOffset = Math.max(0, Number(offset) || 0);

  // Skymavis caps a single upstream leaderboard call at 100 rows. Request sizes
  // above that need to be fetched as multiple offset pages and merged before
  // enrichment, otherwise the server silently truncates ranks past 100.
  const mergedPlayers = [];
  for (let currentOffset = requestedOffset; currentOffset < requestedOffset + requestedLimit; currentOffset += SEASON_LEADERBOARD_API_MAX_LIMIT) {
    const remaining = requestedOffset + requestedLimit - currentOffset;
    const pageLimit = Math.min(SEASON_LEADERBOARD_API_MAX_LIMIT, remaining);
    const leaderboardUrl = `${MAVIS_API_URL}/origins/v2/season-leaderboards?limit=${pageLimit}&offset=${currentOffset}&milestone=${eraMilestone}`;
    const leaderboardResponse = await fetch(leaderboardUrl, {
      headers: { "x-api-key": AXIE_ECHELON_API_KEY }
    });

    if (!leaderboardResponse.ok) {
      throw new Error(`Leaderboard fetch failed: ${leaderboardResponse.status}`);
    }

    const leaderboardData = await leaderboardResponse.json();
    const pagePlayers = Array.isArray(leaderboardData._items) ? leaderboardData._items : [];
    mergedPlayers.push(...pagePlayers);

    if (DEBUG_ON) console.log(`[/api/leaderboard] Fetched ${pagePlayers.length} players from offset ${currentOffset} (${pageLimit} limit)`);

    // Upstream can return short pages when the season ends early; stop rather
    // than making unnecessary follow-up requests.
    if (pagePlayers.length < pageLimit) break;
  }

  const players = mergedPlayers.slice(0, requestedLimit);

  if (DEBUG_ON) console.log(`[/api/leaderboard] Fetched ${players.length} players from Skymavis across ${Math.ceil(requestedLimit / SEASON_LEADERBOARD_API_MAX_LIMIT)} upstream page(s)`);

  let enrichmentFailures = 0;

  // Enrich players with bounded concurrency (reuses the same logic as in-handler)
  const enrichedPlayers = await mapWithConcurrency(
    players,
    async (player) => {
      try {
        const userID = player.userID;

        // Profile/address resolution: ALWAYS cached now, live mode or not
        // (see PROFILE_CACHE_TTL_MS in shared/profileCache.js). This used to
        // run uncached on every single enrichment pass -- a second full
        // network call per player, per poll, that had nothing to do with
        // live mode's actual freshness requirement.
        const { roninAddress, profileUrl } = await resolvePlayerProfile(userID);

        let team = null;
        let lastRankedBattleTime = null;
        let recentRankedBattles = []; // only ever populated in live mode
        let battleTimeFetchFailed = false; // true only in live mode when this cycle's fetch failed

        if (liveMode) {
          // LIVE MODE: the battle-log fetch itself is NOT skippable here --
          // it's the only endpoint that can reveal a new lastRankedBattleTime,
          // so this call happens every poll for every player regardless of
          // caching. What changed is what we DO with the result:
          //   - lastRankedBattleTime is taken ONLY from this fresh response.
          //     It is never read from any cache, and a failed fetch leaves
          //     it as null -- explicitly "unknown this cycle" rather than a
          //     stale value dressed up as current. See the big comment above
          //     this function for why this matters.
          //   - Team composition (fighters/runes) IS cached long-term. A
          //     successful fetch refreshes that cache; a FAILED fetch falls
          //     back to whatever composition was last known, so the row
          //     still shows a team instead of going blank, without lying
          //     about when that team was last confirmed via the timestamp.
          const fresh = await fetchBattleLogsForClientDeduped(userID, 20);

          if (fresh) {
            if (DEBUG_ON) console.log(`[/api/leaderboard] LIVE MODE: fresh fetch OK for userID=${userID}`);
            setCachedTeamComposition(userID, fresh.fighters);
            team = fresh;
            lastRankedBattleTime = fresh.lastRankedBattleTime || null;
            recentRankedBattles = fresh.recentRankedBattles || []; // same never-stale rule as lastRankedBattleTime
          } else {
            battleTimeFetchFailed = true;
            const cachedComposition = getCachedTeamComposition(userID);
            if (cachedComposition) {
              if (DEBUG_ON) console.log(`[/api/leaderboard] LIVE MODE: fresh fetch FAILED for userID=${userID}, falling back to cached composition (battle time reported as unknown)`);
              team = { fighters: cachedComposition, lastRankedBattleTime: null };
            } else {
              if (DEBUG_ON) console.log(`[/api/leaderboard] LIVE MODE: fresh fetch FAILED for userID=${userID}, no cached composition available either`);
              team = null;
            }
            lastRankedBattleTime = null; // NEVER backfilled from a previous poll -- see function-level comment
            recentRankedBattles = []; // never backfilled, same reasoning as lastRankedBattleTime
          }
        } else {
          // NON-LIVE MODE: unchanged behavior -- serve from the legacy
          // combined teamCache when available, refreshing in the background
          // once stale. This path is fine reusing a slightly-old
          // lastRankedBattleTime, since the activity filter (the only
          // consumer that cares about timestamp freshness) is disabled
          // outside live mode by design.
          team = getCachedTeam(userID);

          if (!team) {
            team = await fetchBattleLogsForClientDeduped(userID, 20);

            if (team) {
              if (DEBUG_ON) console.log(`[/api/leaderboard] team attached for userID=${userID}`);
              setCachedTeam(userID, team);
              // Opportunistically warm the long-TTL composition cache too,
              // so that if the user later flips live mode ON, this player's
              // team is already known instead of showing blank until their
              // first live-mode poll succeeds.
              setCachedTeamComposition(userID, team.fighters);
            } else {
              if (DEBUG_ON) console.log(`[/api/leaderboard] No team extracted for userID=${userID}`);
            }
          } else {
            if (DEBUG_ON) console.log(`[/api/leaderboard] team (from cache) attached for userID=${userID}`);
            if (isTeamCacheStale(userID)) {
              scheduleTeamRefresh(userID);
            }
          }

          lastRankedBattleTime = team?.lastRankedBattleTime || null;
          recentRankedBattles = team?.recentRankedBattles || [];
        }

        return {
          rank: player.topRank || player.rank,
          name: player.name || userID,
          mmr: player.vstar || player.rating,
          winRate: player.win_rate !== null ? (player.win_rate * 100) : null,
          dailyChange: player.daily_change || "-",
          recentForm: Array.isArray(player.recent_form) ? player.recent_form : [],
          team,
          lastRankedBattleTime,
          // NEW field: only meaningful in live mode. True when this poll's
          // battle-log fetch failed and the returned team (if any) came from
          // teamCompositionCache rather than a fresh response. The frontend
          // can use this to show "can't fetch last battle" (already
          // supported by formatRelativeTime on a null timestamp) while still
          // rendering the last-known team, instead of either blanking the
          // row or silently reusing an old timestamp.
          battleTimeFetchFailed,
          recentRankedBattles,
          userID: userID,
          roninAddress,
          profileUrl
        };
      } catch (error) {
        enrichmentFailures += 1;
        if (DEBUG_ON) console.error(`[/api/leaderboard] Error enriching player:`, error.message);
        return {
          rank: player.topRank || player.rank,
          name: player.name || player.userID,
          mmr: player.vstar || player.rating,
          winRate: player.win_rate !== null ? (player.win_rate * 100) : null,
          dailyChange: player.daily_change || "-",
          recentForm: Array.isArray(player.recent_form) ? player.recent_form : [],
          team: null,
          lastRankedBattleTime: null,
          battleTimeFetchFailed: liveMode, // consistent with the liveMode branch's semantics above
          recentRankedBattles: [],
          userID: player.userID,
          roninAddress: null,
          profileUrl: null
        };
      }
    },
    BATTLELOG_FETCH_CONCURRENCY
  );

  if (enrichmentFailures > 0) {
    console.warn(`[/api/leaderboard] ${enrichmentFailures}/${players.length} players failed enrichment for eraMilestone=${eraMilestone} offset=${offset}`);
  }

  const avgMatchDurationMs = liveMode ? computeGlobalAvgMatchDurationMs(enrichedPlayers) : null;

  return { players: enrichedPlayers, limit, offset, milestone: eraMilestone, avgMatchDurationMs };
}

export function schedulePageRefresh(key, limit, offset, eraMilestone) {
  if (inFlightPageRefreshes.has(key)) return;
  inFlightPageRefreshes.add(key);

  (async () => {
    try {
      if (DEBUG_ON) console.log(`[schedulePageRefresh] refreshing ${key}`);
      const payload = await fetchAndEnrichLeaderboard(limit, offset, eraMilestone);
      setCachedPage(key, payload);
      if (DEBUG_ON) console.log(`[schedulePageRefresh] refreshed ${key}`);
    } catch (err) {
      if (DEBUG_ON) console.log(`[schedulePageRefresh] failed refresh ${key}:`, err && err.message ? err.message : err);
    } finally {
      inFlightPageRefreshes.delete(key);
    }
  })();
}
