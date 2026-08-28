// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes. This is the ONLY module that calls Skymavis's
// battle-logs endpoint. Every other leaderboard module (enrichment, rune
// scanner, on-demand enrichment cache) goes through
// fetchBattleLogsForClientDeduped() here rather than calling the endpoint
// directly, which is what keeps the dedup and the global concurrency
// semaphore (see shared/concurrency.js) effective across all three callers.
import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { withBattleLogSlot } from "../shared/concurrency.js";
import { getRuneMetadata } from "./runeCatalog.js";
import { BATTLE_LOGS_MIN_LIMIT, BATTLE_LOGS_MAX_LIMIT } from "./leaderboardConstants.js";

const BATTLELOG_FETCH_ATTEMPTS = Number(process.env.BATTLELOG_FETCH_ATTEMPTS || 3);
const BATTLELOG_FETCH_TIMEOUT_MS = Number(process.env.BATTLELOG_FETCH_TIMEOUT_MS || 3000);
const BATTLELOG_FETCH_BACKOFF_MS = Number(process.env.BATTLELOG_FETCH_BACKOFF_MS || 500);

async function fetchWithRetry(url, options = {}, attempt = 1) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BATTLELOG_FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Retry on transient errors
    if ([429, 500, 502, 503].includes(response.status)) {
      if (attempt < BATTLELOG_FETCH_ATTEMPTS) {
        const delay = backoffWithJitter(attempt);
        if (DEBUG_ON) console.log(`[fetchWithRetry] attempt ${attempt}/${BATTLELOG_FETCH_ATTEMPTS} got ${response.status}, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return fetchWithRetry(url, options, attempt + 1);
      }
    }

    return response;
  } catch (error) {
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      if (attempt < BATTLELOG_FETCH_ATTEMPTS) {
        const delay = backoffWithJitter(attempt);
        if (DEBUG_ON) console.log(`[fetchWithRetry] attempt ${attempt}/${BATTLELOG_FETCH_ATTEMPTS} timed out, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return fetchWithRetry(url, options, attempt + 1);
      }
    }
    throw error;
  }
}

function backoffWithJitter(attempt) {
  const base = BATTLELOG_FETCH_BACKOFF_MS * attempt;
  const jitterFactor = 0.5 + Math.random();
  return Math.round(base * jitterFactor);
}

function extractBattleTimestamp(battle) {
  if (!battle || typeof battle !== 'object') return null;
  const candidate =
    battle.gameData?.endedAt ??
    battle.endedAt ??
    battle.createdAt ??
    battle.created_at ??
    battle.timestamp ??
    battle.time ??
    battle.battleTime ??
    battle.startedAt ??
    battle.startTime ??
    battle.gameData?.createdAt ??
    battle.gameData?.created_at ??
    battle.gameData?.startTime ??
    battle.gameData?.timestamp;

  if (candidate == null) return null;
  let parsedMs = null;

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    parsedMs = candidate > 1e12 ? candidate : candidate * 1000;
  } else if (typeof candidate === 'string') {
    const maybeNumber = Number(candidate);
    if (!Number.isNaN(maybeNumber)) {
      parsedMs = maybeNumber > 1e12 ? maybeNumber : maybeNumber * 1000;
    } else {
      parsedMs = Date.parse(candidate);
    }
  }

  if (parsedMs == null || Number.isNaN(parsedMs)) return null;
  return new Date(parsedMs).toISOString();
}

export async function fetchBattleLogsForClient(clientId, limit = 20, priority = "high") {
  try {
    // ===== BATTLE-LOGS API =====
    // Endpoint: GET https://api-gateway.skymavis.com/origin/v2/community/users/:client_id/battle-logs?limit=N
    // (Note: singular '/origin/' not '/origins/')
    //
    // Parameters:
    //   :client_id  - userID of the player
    //   limit       - number of recent battles to return (range: 5-100, default: 20)
    //
    // Response shape:
    //   { _items: [{ gameData: { gameMode, players: [{ userID, team: { fighters: [...] } }, ...] }, ... }] }
    //
    // Key fields extracted:
    //   - gameMode: "ranked" (we only process ranked battles)
    //   - team.fighters[3]: array of 3 axies with axieID, genes, runes[], charms{}
    //   - lastRankedBattleTime: extracted from gameData.endedAt / createdAt / gameData.startTime etc.
    //
    // *** CRITICAL for your use case: lastRankedBattleTime is VOLATILE ***
    // You're tracking which top-rank players just finished a battle to decide who to fight next.
    // This field must be fresh! Cache this team data for stability, but refresh battle times frequently.
    //
    // Concurrency: Gated by BATTLELOG_FETCH_CONCURRENCY (default 4) to avoid rate-limiting.
    // Deduped globally via fetchBattleLogsForClientDeduped() so concurrent requests for the
    // same clientId reuse in-flight promises.
    const clampedLimit = Math.min(
      BATTLE_LOGS_MAX_LIMIT,
      Math.max(BATTLE_LOGS_MIN_LIMIT, Number(limit) || BATTLE_LOGS_MIN_LIMIT)
    );
    const url = `${MAVIS_API_URL}/origin/v2/community/users/${clientId}/battle-logs?limit=${clampedLimit}`;
    if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] Fetching: ${url} (priority=${priority})`);

    const response = await withBattleLogSlot(
      () =>
        fetchWithRetry(url, {
          headers: { "x-api-key": AXIE_ECHELON_API_KEY }
        }),
      priority
    );

    if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] Error response: ${errorText.slice(0, 200)}`);
      throw new Error(`Battle logs fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const battles = Array.isArray(data._items) ? data._items : [];
    if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] Found ${battles.length} battles`);

    // Find first ranked battle and extract player's team
    // Battle structure:
    // {
    //   gameData: {
    //     gameMode: "ranked",
    //     players: [
    //       {
    //         userID: "...",
    //         team: {
    //           fighters: [
    //             {
    //               axieID: number,
    //               genes: string,
    //               genes_metamorph: string,
    //               position: number,
    //               runes: [string],        // rune IDs equipped on this axie
    //               charms: { eyes, mouth, ears, horn, back, tail }  // charm IDs
    //             },
    //             ...
    //           ]
    //         }
    //       },
    //       { userID: "..." (opponent), team: { fighters: [...] } }
    //     ]
    //   }
    // }
    for (const battle of battles) {
      if (battle.gameData && battle.gameData.gameMode === 'ranked' && Array.isArray(battle.gameData.players)) {
        // Find the player entry (current user) vs opponent by matching userID
        const playerEntry = battle.gameData.players.find(p => p.userID === clientId);
        const lastRankedBattleTime = extractBattleTimestamp(battle);

        if (playerEntry && playerEntry.team && Array.isArray(playerEntry.team.fighters)) {
          const teamFighters = playerEntry.team.fighters
            .map(fighter => {
              // Extract first rune (max 1 per axie) and look up its metadata
              // runes can be either a string or an array, depending on source
              let runeId = null;
              if (typeof fighter.runes === 'string' && fighter.runes) {
                runeId = fighter.runes;
              } else if (Array.isArray(fighter.runes) && fighter.runes.length > 0) {
                runeId = fighter.runes[0];
              }
              const runeMetadata = runeId ? getRuneMetadata(runeId) : null;

              if (DEBUG_ON && runeId) {
                console.log(`[fetchBattleLogsForClient] Fighter #${fighter.axieID} has rune ${runeId}, metadata: ${runeMetadata ? 'found' : 'not found'}`);
              }

              return {
                axieID: fighter.axieID,
                name: fighter.name || `Axie #${fighter.axieID}`,
                genes: fighter.genes,
                genes_metamorph: fighter.genes_metamorph,
                position: Number(fighter.position ?? 0),
                axieType: fighter.axieType,
                // runes: array of equipped rune IDs (usually 0 or 1 entry per axie).
                // rune: metadata object { id, name, imageUrl } or null if no rune equipped.
                //   Populated from cached rune catalog. If lookup fails, gracefully degrades to null.
                // charms: per-slot charm IDs. Captured for future charm icon display.
                runes: Array.isArray(fighter.runes) ? fighter.runes : (typeof fighter.runes === 'string' ? [fighter.runes] : []),
                rune: runeMetadata,
                charms: fighter.charms || null
              };
            })
            .sort((a, b) => a.position - b.position);

          if (teamFighters.length > 0 || lastRankedBattleTime) {
            if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] Extracted ${teamFighters.length} fighters for ${clientId}`);
            return { fighters: teamFighters, lastRankedBattleTime };
          }
        }
      }
    }

    if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] No ranked battles found for ${clientId}`);
    return null;
  } catch (error) {
    if (DEBUG_ON) console.log(`[fetchBattleLogsForClient] Error fetching for ${clientId}:`, error.message);
    return null;
  }
}

// In-flight FETCH tracker. This de-dupes concurrent calls to
// fetchBattleLogsForClient for the same clientId -- distinct from the
// "refresh" in-flight tracker in leaderboardCaches.js, which de-dupes
// background cache-refresh *tasks*, not raw fetches.
const inFlightBattleLogFetches = new Map();

export function fetchBattleLogsForClientDeduped(clientId, limit, priority = "high") {
  if (inFlightBattleLogFetches.has(clientId)) {
    if (DEBUG_ON) console.log(`[fetchBattleLogsForClientDeduped] REUSING in-flight fetch for ${clientId}`);
    // Note: if a "low" priority call rides along on a fetch that a "high"
    // priority call already kicked off (or vice versa), the priority of the
    // ALREADY-IN-FLIGHT request wins -- dedup means there's only one real
    // network call, so there's nothing left to reprioritize.
    return inFlightBattleLogFetches.get(clientId);
  }

  const promise = fetchBattleLogsForClient(clientId, limit, priority).finally(() => {
    inFlightBattleLogFetches.delete(clientId);
  });

  inFlightBattleLogFetches.set(clientId, promise);
  return promise;
}
