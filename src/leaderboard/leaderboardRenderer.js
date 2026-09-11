// Leaderboard DOM rendering only. Data fetching and filter decisions remain
// in leaderboardView.js so rendering stays independent of orchestration.
import { renderMorphedAxieCached } from "../shared/morphRenderer.js";
import { formatRelativeTime, predictNextActivity, formatActivityEstimate, formatActivityEstimateCompact, computeAvgPauseMs } from "../shared/formatting.js";
import { getLastBattleTimestamp } from "./leaderboardFilters.js";
import { leaderboardState, RANKED_SESSION_GAP_THRESHOLD_MS, MIN_VALID_MATCH_DURATION_MS, POLLING_STALE_MULTIPLIER, DEFAULT_MATCH_DURATION_MS, PROFILE_BASE, leaderboardCount } from "./leaderboardState.js";
import { coerceCompatibleRune, formatRuneBadgeLabel } from "./runeBadgeUtil.js";
import { formatHistoricalTeamProvenance } from "./historicalTeamProvenance.js";

function formatDebugClock(date) {
  if (!date || Number.isNaN(date.getTime())) return "?";

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const hour12 = hours % 12 || 12;
  const meridiem = hours >= 12 ? "pm" : "am";

  return `${String(hour12).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} ${meridiem}`;
}

function createStatusSpan(text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

const HISTORICAL_TEAM_UNAVAILABLE_TOOLTIP =
  "This does not indicate that the player had no team. It means the historical archive does not contain usable team evidence for this player.";

function historicalUnavailableCopy(player) {
  const evidence = player?.historicalTeamEvidence;
  const snapshot = player?.snapshot;
  const error = player?.historicalTeamError;

  if (snapshot?.hasTeamEvidence === false) {
    return {
      title: "Historical team not captured",
      subtitle: "No historical team evidence was captured for this player."
    };
  }

  // Evidence exists but failed validation; reserve "unavailable" for this case.
  if (evidence?.teamEvidenceReason === "INVALID_TRACKED_PLAYER_TEAM_FIGHTERS") {
    return {
      title: "Historical team unavailable",
      subtitle: "Captured battle data did not contain a usable team for this player."
    };
  }

  // No usable evidence exists; distinguish known archival gaps from the fallback case.
  if (evidence?.teamEvidenceReason === "NO_VALID_IN_ERA_RANKED_BATTLE_FOUND_FOR_PLAYER") {
    return {
      title: "Historical team not captured",
      subtitle: "No valid in-era ranked battle was captured for this player."
    };
  }

  return {
    title: "Historical team not captured",
    subtitle: error || "No usable historical team evidence was captured for this player."
  };
}

function appendHistoricalTeamProvenance(container, player) {
  const provenance = document.createElement("div");
  provenance.className = "historical-team-provenance";

  const formatted = formatHistoricalTeamProvenance(player);
  const summary = document.createElement("div");
  summary.className = "historical-team-provenance-summary";
  summary.textContent = formatted.text;
  summary.title = [formatted.detail, formatted.capturedAt && `Captured: ${formatted.capturedAt}`].filter(Boolean).join("\n");
  summary.tabIndex = 0;
  summary.setAttribute("aria-label", summary.title.replace(/\n/g, ". "));
  provenance.append(summary);
  container.append(provenance);
}

function formatStatusClock(deltaMs) {
  const totalSeconds = Math.floor(Math.abs(deltaMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(Math.max(0, minutes)).padStart(2, "0")}m ${String(Math.max(0, seconds)).padStart(2, "0")}s`;
}

function appendActivityStatusLine(container, result, lastPlayedLabel, heuristicPauseMs) {
  const statusLine = document.createElement("div");
  statusLine.className = "activity-status-line";

  if (!result || result.state === "unknown") {
    statusLine.appendChild(createStatusSpan("Est. next activity", "activity-status-info"));
    statusLine.appendChild(createStatusSpan(" · Unknown", "activity-status-muted"));
    statusLine.appendChild(createStatusSpan(` · Last played ${lastPlayedLabel}`, "activity-status-muted"));

    if (Number.isFinite(heuristicPauseMs) && heuristicPauseMs > 0) {
      statusLine.appendChild(createStatusSpan(` · heuristic: ${formatStatusClock(heuristicPauseMs)}`, "activity-status-heuristic"));
    }

    container.appendChild(statusLine);
    return;
  }

  const now = Date.now();

  if (result.state === "before_due") {
    const timeUntilStart = result.predictedStart - now;
    statusLine.appendChild(createStatusSpan("Est. next activity", "activity-status-info"));
    statusLine.appendChild(createStatusSpan(` · ~${formatStatusClock(timeUntilStart)}`, "activity-status-info"));
  } else if (result.state === "expected_game") {
    const timeElapsedSincePredictedStart = now - result.predictedStart;
    statusLine.appendChild(createStatusSpan("Likely playing", "activity-status-warning"));
    statusLine.appendChild(createStatusSpan(` · ${formatStatusClock(timeElapsedSincePredictedStart)} elapsed`, "activity-status-warning"));
  } else {
    const timeElapsedSincePredictedEnd = now - result.predictedEnd;
    statusLine.appendChild(createStatusSpan("Next game overdue", "activity-status-danger"));
    statusLine.appendChild(createStatusSpan(` · ${formatStatusClock(timeElapsedSincePredictedEnd)}`, "activity-status-danger"));
  }

  statusLine.appendChild(createStatusSpan(` · Last played ${lastPlayedLabel}`, "activity-status-muted"));

  if (Number.isFinite(heuristicPauseMs) && heuristicPauseMs > 0) {
    statusLine.appendChild(createStatusSpan(` · heuristic: ${formatStatusClock(heuristicPauseMs)}`, "activity-status-heuristic"));
  }

  container.appendChild(statusLine);
}

export function renderLeaderboardRows(leaderboardBody, players) {
  console.log(`[renderLeaderboardRows] START: ${players.length} players to render`);

  while (leaderboardBody.firstChild) {
    leaderboardBody.removeChild(leaderboardBody.firstChild);
  }

  for (let rowIndex = 0; rowIndex < players.length; rowIndex++) {
    const player = players[rowIndex];
    const row = document.createElement("tr");
    row.classList.add("leaderboard-row");
    const rankNumber = Number(player.rank);
    if (rankNumber >= 1 && rankNumber <= 3) row.classList.add(`leaderboard-rank-${rankNumber}`);

    const rankCell = document.createElement("td");
    rankCell.className = "rank-cell numeric-cell";
    const rankValue = document.createElement("span");
    rankValue.className = "rank-value";
    rankValue.textContent = player.rank || "-";
    rankCell.append(rankValue);
    if (rankNumber >= 1 && rankNumber <= 3) rankCell.classList.add("podium-rank");
    row.append(rankCell);

    const playerCell = document.createElement("td");
    playerCell.className = "player-cell";
    const playerNameContainer = document.createElement("div");
    playerNameContainer.className = "player-name-container";

    const playerName = document.createElement("div");
    const playerProfileLink = player.userID ? `/profile/${encodeURIComponent(player.userID)}` : null;

    if (playerProfileLink) {
      const playerLink = document.createElement("a");
      playerLink.className = "player-name-link";
      playerLink.href = playerProfileLink;
      playerLink.title = `View ${player.name || player.userID}'s recent ranked battles`;
      playerLink.setAttribute(
        "aria-label",
        `View ${player.name || player.userID}'s recent ranked battle logs`
      );
      playerLink.textContent = `${player.name || player.userID} ↗`;
      playerName.append(playerLink);
    } else {
      playerName.className = "player-name";
      playerName.title = player.name || player.userID;
      playerName.textContent = player.name || player.userID;
    }

    playerNameContainer.append(playerName);

    if (leaderboardState.liveModeEnabled) {
      const subtitle = document.createElement("div");
      subtitle.className = "last-battle-subtitle";
      const displayTimestamp = getLastBattleTimestamp(player);
      const isCoastingOnCache = player.battleTimeFetchFailed && Boolean(displayTimestamp);

      if (displayTimestamp) {
        subtitle.dataset.lastRankedBattleTime = displayTimestamp;
      }
      subtitle.dataset.battleTimeFetchFailed = String(Boolean(player.battleTimeFetchFailed));
      subtitle.textContent = formatRelativeTime(
        displayTimestamp ? new Date(displayTimestamp) : null,
        {
          unavailableLabel: player.battleTimeFetchFailed ? "Can't fetch last battle" : "Played: —",
          failedLabel: "Can't fetch last battle"
        }
      );
      subtitle.classList.toggle("battle-time-unconfirmed", isCoastingOnCache);
      playerNameContainer.append(subtitle);
    }

    const nextActivitySubtitle = document.createElement("div");
    nextActivitySubtitle.className = "next-activity-subtitle";
    if (leaderboardState.liveModeEnabled) {
      if (Array.isArray(player.recentRankedBattles) && player.recentRankedBattles.length > 0) {
        nextActivitySubtitle.dataset.recentRankedBattles = JSON.stringify(player.recentRankedBattles);
      }

      const prediction = predictNextActivity(
        player.recentRankedBattles || [],
        leaderboardState.avgMatchDurationMs,
        RANKED_SESSION_GAP_THRESHOLD_MS,
        MIN_VALID_MATCH_DURATION_MS
      );

      const debugSummary = document.createElement("div");
      debugSummary.className = "debug-next-activity-summary";
      const summaryText = formatActivityEstimate(prediction);
      debugSummary.textContent = summaryText;
      nextActivitySubtitle.append(debugSummary);

      const debugBattleLines = Array.isArray(player.recentRankedBattles)
        ? player.recentRankedBattles
            .slice(0, 4)
            .map((battle, index) => {
              const start = battle.startedAt ? new Date(battle.startedAt) : null;
              const end = battle.endedAt ? new Date(battle.endedAt) : null;
              const startLabel = formatDebugClock(start);
              const endLabel = formatDebugClock(end);
              const durationMs = start && end ? Math.max(0, end.getTime() - start.getTime()) : null;
              const durationLabel = durationMs != null
                ? `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
                : "?";
              const label = `G${index + 1}`;
              return `${label} ${startLabel} → ${endLabel} • ${durationLabel}`;
            })
        : [];

      if (debugBattleLines.length > 0) {
        const debugTrace = document.createElement("div");
        debugTrace.className = "debug-next-activity-trace";
        debugTrace.textContent = debugBattleLines.join(" | ");
        nextActivitySubtitle.append(debugTrace);
      }
    }

    playerNameContainer.append(nextActivitySubtitle);

    playerCell.append(playerNameContainer);
    row.append(playerCell);

    const teamCell = document.createElement("td");
    teamCell.classList.add("team-cell");

    if (player.team && Array.isArray(player.team.fighters) && player.team.fighters.length > 0) {
      const teamFighters = player.team.fighters
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .slice(0, 3);

      console.log(
        `[renderLeaderboardRows] Row ${rowIndex}: ${player.name || player.userID} has ${teamFighters.length} fighters`
      );

      console.debug(
        "Leaderboard team preview:",
        player.name || player.userID,
        teamFighters.map((fighter) => ({
          axieID: fighter.axieID,
          position: fighter.position,
          hasGenesMetamorph: Boolean(fighter.genes_metamorph),
          hasRune: Boolean(fighter.rune),
          runeId: fighter.rune?.id,
          runeName: fighter.rune?.name
        }))
      );

      const previewGrid = document.createElement("div");
      previewGrid.className = "team-preview";

      const previewSlots = Array.from({ length: 3 }, (_, index) => teamFighters[index] || null);
      for (let slotIndex = 0; slotIndex < previewSlots.length; slotIndex++) {
        const fighter = previewSlots[slotIndex];
        const previewItem = document.createElement("div");
        previewItem.className = "team-preview-item";
        previewItem.dataset.rowIndex = rowIndex;
        previewItem.dataset.slotIndex = slotIndex;

        if (!fighter) {
          console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}: EMPTY`);
          previewItem.classList.add("empty");
          previewItem.textContent = "Empty slot";
          previewGrid.append(previewItem);
          continue;
        }

        const axieID = fighter.axieID || "?";
        const isStarterAxie = fighter.axieType === "starter";
        const axieLabel = isStarterAxie ? (fighter.name || "Starter Axie") : `#${axieID}`;
        console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}: Starting render for Axie #${axieID}`);

        const axieWrapper = document.createElement("div");
        axieWrapper.className = "axie-wrapper";
        axieWrapper.style.position = "relative";
        axieWrapper.style.width = "100%";
        axieWrapper.style.height = "100%";
        previewItem.append(axieWrapper);

        const morphContainer = document.createElement("div");
        morphContainer.className = "morph-container";
        morphContainer.style.position = "relative";
        morphContainer.style.width = "100%";
        morphContainer.style.height = "100%";
        axieWrapper.append(morphContainer);

        // CASE 1: collectible Axies should provide genes_metamorph, which
        // represents the morphed appearance and must take precedence.
        // CASE 2: non-collectible Ronin Axies have no metamorph genes, so use
        // their standard genes instead.
        // CASE 3: collectible Axies are expected to provide genes_metamorph,
        // but observed API responses have occasionally returned null. Use
        // standard genes as a defensive fallback for that data-quality case.
        // CASE 4: starter Axies are intentionally name-only for now. Their
        // genes are not sent to the mixer until starter rendering is added.
        const genes = fighter.genes_metamorph || fighter.genes;
        if (isStarterAxie) {
          morphContainer.classList.add("empty");
        } else if (genes) {
          morphContainer.classList.add("is-loading");
          const geneSource = fighter.genes_metamorph ? "genes_metamorph" : "genes fallback";
          console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Rendering with ${geneSource}`);

          renderMorphedAxieCached(morphContainer, genes, {
            snapshot: true,
            width: 240,
            height: 240,
            imageHeight: "96px"
          })
            .then(() => {
              const image = morphContainer.querySelector("img");
              if (image) {
                image.alt = player.teamSource === "historical-snapshot"
                  ? `Historical Axie ${axieID} (reconstructed)`
                  : `Axie ${axieID}`;
              }
            })
            .catch((error) => {
              console.warn(
                `[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Render failed`,
                error
              );
              morphContainer.innerHTML = `<div style="color: #aaa;">${axieLabel}</div>`;
            })
            .finally(() => {
              morphContainer.classList.remove("is-loading");
              console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Render complete`);
            });
        } else {
          morphContainer.classList.add("empty");
          if (!isStarterAxie) morphContainer.textContent = `${axieLabel} (no morph)`;
          console.warn(
            `[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}: No renderable genes for Axie #${axieID}`
          );
        }

        const visibleRune = coerceCompatibleRune(fighter);

        if (visibleRune) {
          const addRuneTooltip = (runeBadge) => {
            const showTooltip = () => {
              if (axieWrapper.querySelector(".rune-badge-tooltip")) return;
              const tooltip = document.createElement("span");
              tooltip.className = "rune-badge-tooltip";
              tooltip.textContent = visibleRune.name || visibleRune.id;
              axieWrapper.append(tooltip);
            };
            const hideTooltip = () => axieWrapper.querySelector(".rune-badge-tooltip")?.remove();
            runeBadge.addEventListener("mouseenter", showTooltip);
            runeBadge.addEventListener("mouseleave", hideTooltip);
            runeBadge.addEventListener("focus", showTooltip);
            runeBadge.addEventListener("blur", hideTooltip);
          };

          let runeLabel = formatRuneBadgeLabel(visibleRune);
          if (!runeLabel && Array.isArray(fighter.runes) && fighter.runes.length > 0) {
            try {
              const raw = fighter.runes[0];
              runeLabel = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : (raw?.id ? String(raw.id) : String(raw));
            } catch (e) {
              runeLabel = "";
            }
          }

          if (visibleRune.imageUrl) {
            console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Adding rune badge ${visibleRune.name || visibleRune.id}`);
            const runeBadge = document.createElement("img");
            runeBadge.className = "rune-badge";
            runeBadge.src = visibleRune.imageUrl;
            runeBadge.alt = `Rune: ${runeLabel}`;
            runeBadge.setAttribute("aria-label", `Rune: ${runeLabel}`);
            addRuneTooltip(runeBadge);

            runeBadge.addEventListener("error", () => {
              runeBadge.style.display = "none";
              console.warn(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Failed to load rune image`);
            });

            axieWrapper.append(runeBadge);
          } else {
            console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Adding fallback rune badge ${visibleRune.name || visibleRune.id}`);
            const runeBadge = document.createElement("div");
            runeBadge.className = "rune-badge rune-badge-text";
            runeBadge.textContent = runeLabel || "";
            runeBadge.setAttribute("aria-label", `Rune: ${runeLabel}`);
            addRuneTooltip(runeBadge);
            axieWrapper.append(runeBadge);
          }
        }

        if (isStarterAxie) {
          const starterLabel = document.createElement("span");
          starterLabel.className = "axie-id";
          starterLabel.textContent = axieLabel;
          starterLabel.setAttribute("aria-label", `${axieLabel}, starter Axie`);
          previewItem.append(starterLabel);
        } else {
          const marketplaceUrl = `https://app.axieinfinity.com/marketplace/axies/${axieID}/`;
          const idLink = document.createElement("a");
          idLink.className = "axie-id";
          idLink.href = marketplaceUrl;
          idLink.target = "_blank";
          idLink.rel = "noopener noreferrer";
          idLink.setAttribute("aria-label", `View Axie #${axieID} on the Axie Marketplace, opens in a new tab`);
          idLink.title = `View Axie #${axieID} on the marketplace (opens in new tab)`;
          idLink.textContent = `#${axieID} ↗`;
          previewItem.append(idLink);
        }

        previewGrid.append(previewItem);
      }

      teamCell.append(previewGrid);
      if (player.teamSource === "historical-snapshot") {
        appendHistoricalTeamProvenance(teamCell, player);
      }
    } else if (player.historicalTeamUnavailable) {
      const copy = historicalUnavailableCopy(player);
      teamCell.className = copy.title === "Historical team not captured"
        ? "historical-team-not-captured"
        : "historical-team-unavailable";
      const title = document.createElement("div");
      title.textContent = copy.title;
      const detail = document.createElement("div");
      detail.className = "historical-team-unavailable-detail";
      detail.textContent = copy.subtitle;
      teamCell.title = HISTORICAL_TEAM_UNAVAILABLE_TOOLTIP;
      teamCell.setAttribute(
        "aria-label",
        `${copy.title}. ${copy.subtitle} ${HISTORICAL_TEAM_UNAVAILABLE_TOOLTIP}`
      );
      teamCell.tabIndex = 0;
      teamCell.append(title, detail);
    } else {
      teamCell.textContent = "-";
      teamCell.style.color = "#888";
    }
    row.append(teamCell);

    const mmrCell = document.createElement("td");
    mmrCell.className = "mmr-cell numeric-cell";
    mmrCell.textContent = player.mmr || "-";
    row.append(mmrCell);

    leaderboardBody.append(row);
  }

  console.log(`[renderLeaderboardRows] COMPLETE: ${players.length} rows rendered`);
  if (leaderboardCount) leaderboardCount.textContent = `Showing ${players.length} entries`;
}

export function updateLeaderboardRelativeTimes() {
  // Hide the legacy "Played: X" subtitle line (now incorporated into the status line)
  // This loop preserves data attributes for backward compatibility.
  const subtitles = document.querySelectorAll(".last-battle-subtitle");
  for (const subtitle of subtitles) {
    subtitle.style.display = "none";
  }

  // Polling staleness check: if data hasn't refreshed within 2.5x the polling interval,
  // don't display a prediction (the underlying game timestamps may be stale).
  // This is a data-freshness gate, separate from prediction validation.
  const pollingIntervalMs = leaderboardState.pollingIntervalSeconds * 1000;
  const timeSinceLastPoll = Date.now() - (leaderboardState.lastSuccessfulPollAt || 0);
  const isPollingStale = !leaderboardState.liveModeEnabled || timeSinceLastPoll > pollingIntervalMs * POLLING_STALE_MULTIPLIER;

  const nextActivitySubtitles = document.querySelectorAll(".next-activity-subtitle");
  for (const el of nextActivitySubtitles) {
    // Skip live mode features if Live Mode is disabled
    if (!leaderboardState.liveModeEnabled) {
      el.innerHTML = "";
      continue;
    }

    if (isPollingStale) {
      el.innerHTML = "";
      const statusLine = document.createElement("div");
      statusLine.className = "activity-status-line";
      statusLine.textContent = "Polling stale";
      el.append(statusLine);
      continue;
    }

    let times = [];
    try {
      times = el.dataset.recentRankedBattles ? JSON.parse(el.dataset.recentRankedBattles) : [];
    } catch {
      times = []; // malformed dataset, treat as no data rather than throwing mid-interval
    }

    // Calculate "Last played X ago" directly from the latest completed game's end timestamp.
    // This is an observed fact, not a prediction. Never show "—" when games exist.
    let lastPlayedLabel = "—";
    if (Array.isArray(times) && times.length > 0) {
      const latestGame = times[0];
      const latestGameEndTime = Date.parse(latestGame.endedAt);
      if (!Number.isNaN(latestGameEndTime)) {
        const now = Date.now();
        const lastPlayedMs = now - latestGameEndTime;
        const totalSecs = Math.floor(lastPlayedMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const pad = (value) => String(value).padStart(2, "0");
        if (mins === 0) {
          lastPlayedLabel = `${pad(secs)}s ago`;
        } else if (mins < 60) {
          lastPlayedLabel = `${pad(mins)}m ${pad(secs)}s ago`;
        } else {
          const hours = Math.floor(mins / 60);
          const minsPart = mins % 60;
          lastPlayedLabel = `${pad(hours)}h ${pad(minsPart)}m ago`;
        }
      }
    }

    const result = predictNextActivity(times, leaderboardState.avgMatchDurationMs, RANKED_SESSION_GAP_THRESHOLD_MS, MIN_VALID_MATCH_DURATION_MS, DEFAULT_MATCH_DURATION_MS);
    const heuristicPauseMs = result && result.state !== "unknown"
      ? computeAvgPauseMs(times, RANKED_SESSION_GAP_THRESHOLD_MS, MIN_VALID_MATCH_DURATION_MS)
      : null;

    el.innerHTML = "";
    appendActivityStatusLine(el, result, lastPlayedLabel, heuristicPauseMs);

    const debugBattleLines = Array.isArray(times)
      ? times
          .slice(0, 4)
          .map((battle, index, list) => {
            const start = battle.startedAt ? new Date(battle.startedAt) : null;
            const end = battle.endedAt ? new Date(battle.endedAt) : null;
            const startLabel = formatDebugClock(start);
            const endLabel = formatDebugClock(end);
            const durationMs = start && end ? Math.max(0, end.getTime() - start.getTime()) : null;
            const pad = (value) => String(value).padStart(2, "0");
            const durationLabel = durationMs != null
              ? `${pad(Math.floor(durationMs / 60000))}m ${pad(Math.floor((durationMs % 60000) / 1000))}s`
              : "?";

            const previousBattle = list[index + 1] || null;
            const stopMs = previousBattle && start && previousBattle.endedAt
              ? Math.max(0, start.getTime() - new Date(previousBattle.endedAt).getTime())
              : null;
            const stopLabel = stopMs != null
              ? (() => {
                  const hours = Math.floor(stopMs / 3600000);
                  const minutes = Math.floor((stopMs % 3600000) / 60000);
                  const seconds = Math.floor((stopMs % 60000) / 1000);
                  if (hours > 0) {
                    return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
                  }
                  return `${pad(minutes)}m ${pad(seconds)}s`;
                })()
              : null;

            return stopLabel
              ? `G${index + 1}  ${startLabel} → ${endLabel} · ◷ ${durationLabel} · break ${stopLabel}`
              : `G${index + 1}  ${startLabel} → ${endLabel} · ◷ ${durationLabel}`;
          })
      : [];

    if (debugBattleLines.length > 0) {
      const debugTrace = document.createElement("div");
      debugTrace.className = "activity-game-history";
      for (const line of debugBattleLines) {
        const lineDiv = document.createElement("div");
        lineDiv.className = "game-history-line";
        lineDiv.textContent = line;
        debugTrace.append(lineDiv);
      }
      el.append(debugTrace);
    }
  }
}
