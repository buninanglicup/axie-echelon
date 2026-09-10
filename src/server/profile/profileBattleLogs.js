import { AXIE_ECHELON_API_KEY, DEBUG_ON, MAVIS_API_URL } from "../shared/env.js";
import { mapWithConcurrency, withBattleLogSlot } from "../shared/concurrency.js";
import { fetchWithRetry } from "../shared/httpRetry.js";
import { getRuneMetadata } from "../leaderboard/runeCatalog.js";
import { getCharmMetadata } from "../leaderboard/charmCatalog.js";
import {
  mergeObservedBattleLogs,
  getRetainedBattleLogs
} from "./profileBattleLogRetentionStore.js";
import { getCurrentEraForConfiguredSeason } from "../../eraResolver.js";
import { SnapshotRepository } from "../snapshots/snapshotRepository.js";
import { findAcceptedSnapshot, extractHistoricalTeam } from "../snapshots/snapshotReader.js";
import { normalizeLeaderboardScope } from "../../leaderboard/leaderboardScope.js";
import { resolvePlayerProfile } from "../shared/profileCache.js";

// This adapter turns the upstream battle-log shape into the UI's compact
// matchup model. It enriches only known rune/charm IDs from local catalogs and
// never invents unavailable levels, parts, results, or older battle pages.
export const PROFILE_BATTLE_LOG_PAGE_SIZE = 20;
const PROFILE_BATTLE_LOG_MIN_LIMIT = 5;

function normalizeEpochToMs(candidate) {
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate > 1e12 ? candidate : candidate * 1000;
  if (typeof candidate === "string") {
    const maybeNumber = Number(candidate);
    if (!Number.isNaN(maybeNumber)) return maybeNumber > 1e12 ? maybeNumber : maybeNumber * 1000;
    const parsed = Date.parse(candidate);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toIso(candidate) {
  const ms = normalizeEpochToMs(candidate);
  return ms == null || Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function mapCharms(charms) {
  if (!charms || typeof charms !== "object") return null;
  return Object.fromEntries(Object.entries(charms).map(([slot, charmID]) => {
    const id = typeof charmID === "string" && charmID.trim() ? charmID.trim() : null;
    const metadata = id ? getCharmMetadata(id) : null;
    return [slot, metadata || (id ? { id, name: null, description: null, imageUrl: null } : null)];
  }));
}

function mapFighter(fighter) {
  let runeId = null;
  if (typeof fighter?.runes === "string" && fighter.runes) runeId = fighter.runes;
  else if (Array.isArray(fighter?.runes) && fighter.runes.length > 0) runeId = fighter.runes[0];
  const runeMetadata = runeId ? getRuneMetadata(runeId) : null;
  return {
    axieID: fighter?.axieID,
    name: fighter?.name || `Axie #${fighter?.axieID}`,
    genes: fighter?.genes,
    genes_metamorph: fighter?.genes_metamorph,
    position: Number(fighter?.position ?? 0),
    axieType: fighter?.axieType,
    runes: Array.isArray(fighter?.runes) ? fighter.runes : (typeof fighter?.runes === "string" ? [fighter.runes] : []),
    rune: runeMetadata,
    charms: mapCharms(fighter?.charms)
  };
}

function mapTeam(playerEntry) {
  if (!playerEntry?.team?.fighters || !Array.isArray(playerEntry.team.fighters)) return null;
  const fighters = playerEntry.team.fighters.map(mapFighter).sort((a, b) => a.position - b.position);
  return fighters.length > 0 ? { fighters } : null;
}

function participantRoninAddress(participant) {
  return participant?.roninAddress
    || participant?.ronin_address
    || participant?.ronin
    || participant?.addresses?.ronin
    || participant?.addresses?.roninAddress
    || null;
}

function numberOrNull(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function mapRatingImpact(reward) {
  if (!reward) return null;
  const vstarBefore = numberOrNull(reward.oldVstar);
  const vstarAfter = numberOrNull(reward.newVstar);
  const eloBefore = numberOrNull(reward.oldElo);
  const eloAfter = numberOrNull(reward.newElo);
  return {
    vstarBefore,
    vstarAfter,
    vstarDelta: vstarBefore != null && vstarAfter != null ? vstarAfter - vstarBefore : null,
    eloBefore,
    eloAfter,
    eloDelta: eloBefore != null && eloAfter != null ? eloAfter - eloBefore : null
  };
}

function findRatingImpact(battle, userID) {
  const rewardMeta = battle?.rewardMeta || battle?.gameData?.rewardMeta;
  const rewards = Array.isArray(rewardMeta?.deltaRewards) ? rewardMeta.deltaRewards : rewardMeta?.rewards;
  if (!Array.isArray(rewards)) return null;
  return mapRatingImpact(rewards.find((reward) => reward?.userId === userID || reward?.userID === userID));
}

function winnerUserID(gameData, players) {
  const winner = gameData?.winner;
  if (typeof winner === "string" && players.some((player) => player?.userID === winner)) return winner;
  // Fixtures use a zero-based player slot for decisive games; only resolve when
  // it addresses an actual participant. Other values (such as a draw enum)
  // remain unknown rather than being guessed.
  if (Number.isInteger(winner) && winner >= 0 && winner < players.length) return players[winner]?.userID || null;
  return null;
}

function resolveResult(battle, clientId, opponentUserID, players) {
  const gameData = battle?.gameData || battle;
  const selfEntry = gameData?.players?.find((player) => player?.userID === clientId);
  if (selfEntry) {
    if (typeof selfEntry.won === "boolean") return selfEntry.won ? "win" : "loss";
    if (typeof selfEntry.win === "boolean") return selfEntry.win ? "win" : "loss";
    if (typeof selfEntry.result === "string") {
      const normalized = selfEntry.result.toLowerCase();
      if (["win", "won"].includes(normalized)) return "win";
      if (["loss", "lose", "lost"].includes(normalized)) return "loss";
      if (["draw", "tie"].includes(normalized)) return "draw";
    }
  }
  if (gameData?.isDraw === true || battle?.isDraw === true) return "draw";
  const explicitWinner = winnerUserID(gameData, players);
  if (explicitWinner === clientId) return "win";
  if (explicitWinner === opponentUserID) return "loss";
  return "unknown";
}

export function buildBattleLogUrl(clientId, limit, offset = 0) {
  const clampedLimit = Math.min(PROFILE_BATTLE_LOG_PAGE_SIZE, Math.max(PROFILE_BATTLE_LOG_MIN_LIMIT, Number(limit) || PROFILE_BATTLE_LOG_PAGE_SIZE));
  const clampedOffset = Math.max(0, Math.floor(Number(offset) || 0));
  return {
    url: `${MAVIS_API_URL}/origin/v2/community/users/${encodeURIComponent(clientId)}/battle-logs?limit=${clampedLimit}&offset=${clampedOffset}`,
    clampedLimit,
    clampedOffset
  };
}

export function normalizeBattleForProfile(battle, clientId) {
  if (!battle?.gameData) return null;
  const players = Array.isArray(battle.gameData.players) ? battle.gameData.players : [];
  const selfEntry = players.find((player) => player?.userID === clientId);
  const opponentEntry = players.find((player) => player?.userID !== clientId);
  const team = mapTeam(selfEntry);
  if (!team) return null;

  const endedAt = toIso(battle.gameData?.endedAt ?? battle.endedAt ?? battle.gameData?.createdAt ?? battle.createdAt);
  const startedAt = toIso(battle.gameData?.startedAt ?? battle.startedAt);
  const durationMs = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null;
  const turns = numberOrNull(battle.gameData?.turnEndAt);

  return {
    battleId: battle?.id || battle?._id || battle?.gameData?.id || battle?.gameData?.uuid || null,
    timestamp: endedAt,
    startedAt,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    gameMode: battle.gameData.gameMode || "unknown",
    turns: turns != null && turns > 0 ? turns : null,
    endReason: typeof battle.gameData?.battleEndReason === "string" ? battle.gameData.battleEndReason : null,
    result: resolveResult(battle, clientId, opponentEntry?.userID || null, players),
    player: {
      userID: clientId,
      name: selfEntry?.name || null,
      roninAddress: participantRoninAddress(selfEntry),
      rank: numberOrNull(selfEntry?.rank ?? selfEntry?.topRank ?? selfEntry?.leaderboardRank),
      impact: findRatingImpact(battle, clientId)
    },
    opponent: {
      userID: opponentEntry?.userID || null,
      name: opponentEntry?.name || null,
      roninAddress: participantRoninAddress(opponentEntry),
      impact: findRatingImpact(battle, opponentEntry?.userID),
      team: mapTeam(opponentEntry)
    },
    team,
    provenance: { source: "live", fetchedAt: new Date().toISOString() }
  };
}

async function enrichParticipantProfiles(items) {
  const unresolvedIDs = [...new Set((items || []).flatMap((item) => [item?.player, item?.opponent])
    .filter((participant) => participant?.userID && (!participant.name || !participant.roninAddress))
    .map((participant) => participant.userID))];
  if (unresolvedIDs.length === 0) return items;
  const profiles = await mapWithConcurrency(unresolvedIDs, async (userID) => {
    try { return [userID, await resolvePlayerProfile(userID)]; }
    catch { return [userID, null]; }
  }, 4);
  const profileByUserID = new Map(profiles);
  for (const item of items || []) {
    for (const participant of [item?.player, item?.opponent]) {
      if (!participant?.userID) continue;
      const profile = profileByUserID.get(participant.userID);
      if (!participant.name) participant.name = profile?.name || null;
      if (!participant.roninAddress) participant.roninAddress = profile?.roninAddress || null;
    }
  }
  return items;
}

async function fetchLiveBattleLogsForProfile(clientId, limit, offset) {
  const { url, clampedLimit, clampedOffset } = buildBattleLogUrl(clientId, limit, offset);
  if (DEBUG_ON) console.log(`[profileBattleLogs] Fetching: ${url}`);
  const response = await withBattleLogSlot(
    () => fetchWithRetry(url, { headers: { "x-api-key": AXIE_ECHELON_API_KEY } }, { debug: DEBUG_ON }),
    "high"
  );
  if (!response.ok) {
    const error = new Error(`Battle logs fetch failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const items = (Array.isArray(data._items) ? data._items : [])
    .map((battle) => normalizeBattleForProfile(battle, clientId))
    .filter(Boolean);
  return {
    items: await enrichParticipantProfiles(items),
    pagination: {
      limit: Number.isFinite(data?._metadata?.limit) ? data._metadata.limit : clampedLimit,
      offset: Number.isFinite(data?._metadata?.offset) ? data._metadata.offset : clampedOffset,
      hasNext: data?._metadata?.hasNext === true
    }
  };
}

async function getHistoricalProfileBattle({ userID, leaderboardScope, repository = new SnapshotRepository() }) {
  const scope = normalizeLeaderboardScope(leaderboardScope);
  const snapshot = await findAcceptedSnapshot(repository, scope);
  if (!snapshot) return { status: "unavailable", error: "No accepted historical snapshot is available for this era." };
  if (snapshot.hasTeamEvidence === false) {
    return {
      status: "unavailable",
      snapshot: { captureId: snapshot.captureId, capturedAt: snapshot.completedAt },
      error: "This historical snapshot contains only leaderboard candidates; team evidence is not available."
    };
  }
  const normalizedBattleLog = await repository.readNormalizedBattleLog(snapshot, userID);
  const team = extractHistoricalTeam(userID, normalizedBattleLog);
  if (!team) {
    return {
      status: "unavailable",
      snapshot: { captureId: snapshot.captureId, capturedAt: snapshot.completedAt },
      error: "No archived ranked team is available for this player in this era."
    };
  }
  return {
    status: "ready",
    items: [{
      battleId: null,
      timestamp: normalizedBattleLog?.selectedBattleTimestamp || null,
      startedAt: null,
      durationMs: null,
      gameMode: "ranked",
      result: "unknown",
      player: { userID, name: null },
      opponent: { userID: null, name: null, team: null },
      team,
      provenance: {
        source: "historical-snapshot",
        captureId: snapshot.captureId,
        capturedAt: normalizedBattleLog?.capturedAt || snapshot.completedAt,
        coverage: snapshot.battleLogSummary?.eraCoverage || "unknown",
        note: "This era's archival capture retains only the latest observed in-era battle, not a full log."
      }
    }]
  };
}

export async function getPlayerBattleLogPage({
  userID,
  leaderboardScope = null,
  requestedFetchLimit = PROFILE_BATTLE_LOG_PAGE_SIZE,
  offset = 0
}) {
  const currentEra = getCurrentEraForConfiguredSeason();
  const scope = leaderboardScope ? normalizeLeaderboardScope(leaderboardScope) : null;
  const isHistoricalRequest = scope && !scope.offSeasonMode && !currentEra.offSeasonMode && String(scope.milestone) !== String(currentEra.milestone);

  if (isHistoricalRequest) {
    if (offset > 0) return { status: "ready", userID, source: "historical-snapshot", items: [], totalItems: 0, pagination: { limit: requestedFetchLimit, offset, hasNext: false } };
    const historical = await getHistoricalProfileBattle({ userID, leaderboardScope: scope });
    if (historical.status !== "ready") return { status: "unavailable", error: historical.error, source: "historical-snapshot", snapshot: historical.snapshot };
    return {
      status: "ready",
      userID,
      source: "historical-snapshot",
      items: historical.items,
      totalItems: historical.items.length,
      pagination: { limit: requestedFetchLimit, offset: 0, hasNext: false },
      retention: { note: "Archived evidence: one observed battle, not full history." }
    };
  }

  let fetchError = null;
  let page = null;
  try {
    page = await fetchLiveBattleLogsForProfile(userID, requestedFetchLimit, offset);
    mergeObservedBattleLogs(userID, page.items);
  } catch (error) {
    fetchError = error;
    if (DEBUG_ON) console.warn(`[profileBattleLogs] Live fetch failed for ${userID}: ${error.message}`);
  }

  if (!page) {
    const allRetained = await enrichParticipantProfiles(getRetainedBattleLogs(userID));
    if (fetchError) return { status: "error", error: `Could not fetch battle logs (${fetchError.status || fetchError.message}).` };
    return { status: "ready", userID, source: "live", items: allRetained.slice(0, requestedFetchLimit), totalItems: Math.min(allRetained.length, requestedFetchLimit), pagination: { limit: requestedFetchLimit, offset, hasNext: false } };
  }

  return {
    status: "ready",
    userID,
    source: "live",
    liveFetchFailed: Boolean(fetchError),
    items: page.items,
    totalItems: page.items.length,
    pagination: page.pagination,
    retention: { note: "Battle history is fetched in 20-battle pages only when requested." }
  };
}
