// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old main.js,
// no logic changes. All former bare module-scope `let` variables (e.g.
// `leaderboardData`, `rankMin`, `liveModeEnabled`) are now properties of the
// imported `leaderboardState` object -- see leaderboardState.js for why.
import { renderMorphedAxieCached } from "../shared/morphRenderer.js";
import { formatRelativeTime } from "../shared/formatting.js";
import {
  leaderboardState,
  DEFAULT_BATTLE_WINDOW_MINUTES,
  LEADERBOARD_STORAGE_TTL_MS,
  GET_SEASON_LEADERBOARD_API_LIMIT,
  GET_SEASON_LEADERBOARD_API_OFFSET,
  LEADERBOARD_MAX_RANK,
  PROFILE_BASE,
  getBattleWindowPreset,
  getLeaderboardStorageKey,
  lastBattleFilter,
  lastBattleValue,
  playerNameSearch,
  playerNameClear,
  rankMinInput,
  rankMaxInput,
  rankFilterValue,
  rankTopNButton,
  resetFiltersButton,
  activeFilters,
  leaderboardCount,
  liveModeToggle,
  pollingControls,
  pollingIntervalSelect,
  liveOnlyControls,
  rankMinError,
  rankMaxError,
  seasonSelector,
  headerLastUpdated,
  eraTabs,
  compactModeToggle,
  standardModeToggle,
  leaderboardTable,
  runeSearchInput,
  runeSuggestions,
  runeFilterStatus,
  runeFilterClear
} from "./leaderboardState.js";

// ===== sessionStorage leaderboard page cache =====
function loadLeaderboardPageFromStorage(limit, offset, milestone) {
  if (typeof sessionStorage === "undefined") return null;
  const key = getLeaderboardStorageKey(limit, offset, milestone);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.timestamp || !parsed.payload) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - parsed.timestamp > LEADERBOARD_STORAGE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.payload;
  } catch (error) {
    console.warn("Failed to parse leaderboard cache", error);
    sessionStorage.removeItem(key);
    return null;
  }
}

function saveLeaderboardPageToStorage(limit, offset, milestone, payload) {
  if (typeof sessionStorage === "undefined") return;
  const key = getLeaderboardStorageKey(limit, offset, milestone);
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ timestamp: Date.now(), payload })
    );
  } catch (error) {
    console.warn("Failed to save leaderboard cache", error);
  }
}

function fingerprintLeaderboard(players) {
  if (!Array.isArray(players)) return "";
  return players
    .map((p) => `${p.userID}:${p.rank}:${p.mmr}:${p.winRate}:${p.lastRankedBattleTime || ""}`)
    .join("|");
}

// ===== Rank / activity filter labels & application =====
function updateRankFilterLabels() {
  if (!rankFilterValue) return;

  const { rankMin, rankMax } = leaderboardState;
  if (!rankMin && !rankMax) {
    rankFilterValue.textContent = "All ranks";
  } else if (rankMin && !rankMax) {
    rankFilterValue.textContent = `Rank ≥ ${rankMin}`;
  } else if (!rankMin && rankMax) {
    rankFilterValue.textContent = `Top ${rankMax}`;
  } else {
    rankFilterValue.textContent = `Ranks ${rankMin}–${rankMax}`;
  }
}

function updateLeaderboardFilterLabels() {
  if (lastBattleValue) {
    const selectedValue = Number.isFinite(leaderboardState.activeBattleWindowMinutes)
      ? leaderboardState.activeBattleWindowMinutes
      : Number(lastBattleFilter?.value ?? 5);

    const preset = getBattleWindowPreset(selectedValue);
    const labelValue = preset.label || "5m";
    lastBattleValue.textContent = `Up to ${labelValue} ago`;
  }
  updateRankFilterLabels();
}

function updateEraTabs(milestone) {
  for (const tab of eraTabs) {
    const selected = tab.dataset.milestone === String(milestone);
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function applyRankFilter(players) {
  const { rankMin, rankMax } = leaderboardState;
  return (players || []).filter((player) => {
    const rank = Number(player?.rank);
    if (!Number.isFinite(rank) || rank <= 0) return false;
    if (rankMin && rank < rankMin) return false;
    if (rankMax && rank > rankMax) return false;
    return true;
  });
}

function getLastBattleTimestamp(player) {
  return player.lastRankedBattleTime || player.team?.lastRankedBattleTime || null;
}

// Apply the "active within" filter to leaderboard data.
// This filter uses each player's last ranked battle timestamp and keeps only players
// whose last ranked battle ended within the selected time window.
// It is applied on the client side after loading the enriched leaderboard data.
function applyLeaderboardActivityFilter(players) {
  // Active-within is a live-mode-only filter: it depends on lastRankedBattleTime
  // staying fresh via polling, so it should have no effect while live mode is off.
  const { liveModeEnabled, activeBattleWindowMinutes } = leaderboardState;
  if (!liveModeEnabled || activeBattleWindowMinutes === null || activeBattleWindowMinutes === undefined) return players;

  const now = Date.now();
  const windowMs = activeBattleWindowMinutes * 60 * 1000;

  return (players || []).filter((player) => {
    const timestamp = getLastBattleTimestamp(player);
    if (!timestamp) return false;

    const ts = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(ts)) return false;

    const ageMs = now - ts;
    return ageMs >= 0 && ageMs <= windowMs;
  });
}

function applyLeaderboardFilters(players) {
  let filtered = applyLeaderboardActivityFilter(players);
  filtered = applyRankFilter(filtered);
  return filtered;
}

function renderFilteredLeaderboard() {
  if (leaderboardState.runeFilterActive) return;
  const leaderboardBody = document.querySelector("#leaderboard-body");
  if (!leaderboardBody) return;
  renderLeaderboardRows(leaderboardBody, applyLeaderboardFilters(leaderboardState.leaderboardData));
}

function updateActiveFilters() {
  if (!activeFilters) return;
  activeFilters.replaceChildren();
  const tags = [];
  const { rankMin, rankMax, activeRuneId } = leaderboardState;

  if (rankMin || rankMax) {
    tags.push({
      label: `Rank: ${rankMin || 1}-${rankMax || 1000}`,
      clear: () => {
        leaderboardState.rankMin = null;
        leaderboardState.rankMax = null;
        if (rankMinInput) rankMinInput.value = "";
        if (rankMaxInput) rankMaxInput.value = "";
      }
    });
  }

  if (activeRuneId) {
    tags.push({
      label: `Rune: ${runeSearchInput?.value || activeRuneId}`,
      clear: clearRuneFilter
    });
  }

  if (leaderboardState.liveModeEnabled && leaderboardState.activeBattleWindowMinutes !== null) {
    const preset = getBattleWindowPreset(leaderboardState.activeBattleWindowMinutes);
    tags.push({
      label: `Recency: ${preset.label || "5m"}`,
      clear: () => {
        leaderboardState.activeBattleWindowMinutes = null;
        if (lastBattleFilter) lastBattleFilter.value = "";
      }
    });
  }

  for (const tag of tags) {
    const tagElement = document.createElement("span");
    tagElement.className = "active-filter-tag";
    tagElement.append(document.createTextNode(tag.label));

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "×";
    clearButton.setAttribute("aria-label", `Remove ${tag.label} filter`);
    clearButton.addEventListener("click", () => {
      tag.clear();
      updateLeaderboardFilterLabels();
      renderFilteredLeaderboard();
    });
    tagElement.append(clearButton);
    activeFilters.append(tagElement);
  }

  activeFilters.hidden = tags.length === 0;
}

// ===== Live mode / polling =====
// Stop any active leaderboard refresh timer.
// This is used both when switching out of live mode and before starting a new interval.
function stopLeaderboardPolling() {
  if (leaderboardState.leaderboardPollTimer !== null) {
    window.clearInterval(leaderboardState.leaderboardPollTimer);
    leaderboardState.leaderboardPollTimer = null;
  }
}

// Start polling the leaderboard on a repeat interval, but only when live mode is enabled.
// The live mode toggle controls whether polling is active, and the interval is controlled
// by pollingIntervalSeconds. This keeps live updates separated from normal leaderboard refresh behavior.
function startLeaderboardPolling() {
  stopLeaderboardPolling();
  if (!leaderboardState.liveModeEnabled) return;
  leaderboardState.leaderboardPollTimer = window.setInterval(() => {
    if (leaderboardState.liveModeEnabled) hydrateLeaderboard();
  }, leaderboardState.pollingIntervalSeconds * 1000);
}

// Update the live mode UI and polling state.
// "Live mode" is the feature that groups the polling controls and the active-within filter.
// When enabled, the app should refresh leaderboard data periodically and apply the
// active-within window to show only players with recent ranked battle activity.
// Battle-window lifecycle: disabling live mode always clears
// activeBattleWindowMinutes to null below (including the initial setup call
// at module load, where liveModeEnabled starts false); enabling live mode
// always restores it to DEFAULT_BATTLE_WINDOW_MINUTES whenever it finds a
// null value. One restore path covers both "first time live mode is ever
// turned on" and "turned on again after being disabled" -- re-enabling
// intentionally falls back to the documented default rather than
// remembering whatever window the user had picked before disabling
// (confirmed UX call, see leaderboard-pagination-plan.md).
function updateLiveModeControls() {
  const { liveModeEnabled } = leaderboardState;
  if (liveOnlyControls) liveOnlyControls.hidden = !liveModeEnabled;
  if (pollingControls) pollingControls.hidden = !liveModeEnabled;

  if (liveModeToggle) {
    liveModeToggle.setAttribute("aria-pressed", String(liveModeEnabled));
  }

  if (liveModeEnabled) {
    if (leaderboardState.activeBattleWindowMinutes === null) {
      leaderboardState.activeBattleWindowMinutes = DEFAULT_BATTLE_WINDOW_MINUTES;
      if (lastBattleFilter) lastBattleFilter.value = String(DEFAULT_BATTLE_WINDOW_MINUTES);
      updateLeaderboardFilterLabels();
    }
    startLeaderboardPolling();
  } else {
    stopLeaderboardPolling();
    leaderboardState.activeBattleWindowMinutes = null;
    if (lastBattleFilter) lastBattleFilter.value = "";
    updateLeaderboardFilterLabels();
  }

  renderFilteredLeaderboard();
}

// ===== Leaderboard row rendering =====
function renderLeaderboardRows(leaderboardBody, players) {
  console.log(`[renderLeaderboardRows] START: ${players.length} players to render`);

  while (leaderboardBody.firstChild) {
    leaderboardBody.removeChild(leaderboardBody.firstChild);
  }

  for (let rowIndex = 0; rowIndex < players.length; rowIndex++) {
    const player = players[rowIndex];
    const row = document.createElement("tr");
    const rankNumber = Number(player.rank);
    if (rankNumber >= 1 && rankNumber <= 3) row.classList.add(`leaderboard-rank-${rankNumber}`);

    // Rank cell
    const rankCell = document.createElement("td");
    rankCell.textContent = player.rank || "-";
    if (rankNumber >= 1 && rankNumber <= 3) rankCell.classList.add("podium-rank");
    row.append(rankCell);

    // Player name cell
    const playerCell = document.createElement("td");
    const playerNameContainer = document.createElement("div");
    playerNameContainer.className = "player-name-container";

    const playerName = document.createElement("div");
    const playerProfileUrl = player.profileUrl || (player.roninAddress ? `${PROFILE_BASE}/${player.roninAddress}/axies/` : null);

    if (playerProfileUrl) {
      const playerLink = document.createElement("a");
      playerLink.className = "player-name-link";
      playerLink.href = playerProfileUrl;
      playerLink.target = "_blank";
      playerLink.rel = "noopener noreferrer";
      playerLink.title = `View ${player.name || player.userID}'s Axie profile (opens in new tab)`;
      playerLink.setAttribute(
        "aria-label",
        `View ${player.name || player.userID}'s Axie profile on the Axie marketplace, opens in a new tab`
      );
      playerLink.textContent = `${player.name || player.userID} ↗`;
      playerName.append(playerLink);
    } else {
      playerName.className = "player-name";
      playerName.title = player.name || player.userID;
      playerName.textContent = player.name || player.userID;
    }

    playerNameContainer.append(playerName);

    // BUG FIX (2026-08-19, caught during Phase 1 validation): this subtitle
    // used to only be created when `player.lastRankedBattleTime` was
    // truthy, which meant a failed live-mode fetch (now correctly reported
    // as an honest `null`, see leaderboardEnrichment.js) rendered NO
    // subtitle at all -- not the "can't fetch last battle" message the rest
    // of this codebase's documentation claimed formatRelativeTime()
    // already handled. That claim was only true if this element existed in
    // the first place. Before the backend's honest-null change, a failed
    // fetch's timestamp was almost always silently backfilled from a
    // previous cycle by the old oldTimestamps workaround (since removed),
    // so `player.lastRankedBattleTime` was rarely actually null and this
    // gap rarely surfaced. Now it does, on every fetch failure, so the
    // subtitle is always created; only its `dataset.lastRankedBattleTime`
    // attribute is conditional, so updateLeaderboardRelativeTimes()'s
    // per-second refresh (which reads that dataset attribute) also falls
    // through to "can't fetch last battle" rather than a stale value.
    const subtitle = document.createElement("div");
    subtitle.className = "last-battle-subtitle";
    if (player.lastRankedBattleTime) {
      subtitle.dataset.lastRankedBattleTime = player.lastRankedBattleTime;
    }
    subtitle.textContent = formatRelativeTime(
      player.lastRankedBattleTime ? new Date(player.lastRankedBattleTime) : null
    );
    playerNameContainer.append(subtitle);

    playerCell.append(playerNameContainer);
    row.append(playerCell);

    // Team cell with Axies
    const teamCell = document.createElement("td");

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
        console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}: Starting render for Axie #${axieID}`);

        // Create wrapper for Axie image and rune (they form a single visual unit)
        const axieWrapper = document.createElement("div");
        axieWrapper.className = "axie-wrapper";
        axieWrapper.style.position = "relative";
        axieWrapper.style.width = "100%";
        axieWrapper.style.height = "100%";
        previewItem.append(axieWrapper);

        // Create separate container for the morphed Axie image
        // This prevents renderMorphedAxieCached from wiping out the rune badge
        const morphContainer = document.createElement("div");
        morphContainer.className = "morph-container";
        morphContainer.style.position = "relative";
        morphContainer.style.width = "100%";
        morphContainer.style.height = "100%";
        axieWrapper.append(morphContainer);

        // Render morphed Axie into the morphContainer, not the previewItem
        const genes = fighter.genes_metamorph;
        if (genes) {
          morphContainer.classList.add("is-loading");
          console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Calling renderMorphedAxieCached`);

          renderMorphedAxieCached(morphContainer, genes, {
            snapshot: true,
            width: 240,
            height: 240,
            imageHeight: "96px"
          })
            .catch((error) => {
              console.warn(
                `[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Render failed`,
                error
              );
              morphContainer.innerHTML = `<div style="color: #aaa;">#${axieID}</div>`;
            })
            .finally(() => {
              morphContainer.classList.remove("is-loading");
              console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Render complete`);
            });
        } else {
          morphContainer.classList.add("empty");
          morphContainer.textContent = `#${axieID} (no morph)`;
          console.warn(
            `[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}: Missing genes_metamorph for Axie #${axieID}`
          );
        }

        // Add rune badge as child of axieWrapper (positioned relative to Axie, not the card)
        if (fighter.rune) {
          if (fighter.rune.imageUrl) {
            // Image-based rune badge
            console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Adding rune badge ${fighter.rune.name}`);
            const runeBadge = document.createElement("img");
            runeBadge.className = "rune-badge";
            runeBadge.src = fighter.rune.imageUrl;
            runeBadge.alt = `Rune: ${fighter.rune.name}`;
            runeBadge.title = fighter.rune.name;
            runeBadge.setAttribute("aria-label", `Rune: ${fighter.rune.name}`);

            // Gracefully hide rune if image fails to load
            runeBadge.addEventListener("error", () => {
              runeBadge.style.display = "none";
              console.warn(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Failed to load rune image`);
            });

            axieWrapper.append(runeBadge);
          } else {
            // Fallback text-based badge for runes without images
            console.log(`[renderLeaderboardRows] Row ${rowIndex}, Slot ${slotIndex}, Axie #${axieID}: Adding fallback rune badge ${fighter.rune.name}`);
            const runeBadge = document.createElement("div");
            runeBadge.className = "rune-badge rune-badge-text";
            runeBadge.textContent = "?";
            runeBadge.title = fighter.rune.name;
            runeBadge.setAttribute("aria-label", `Rune: ${fighter.rune.name}`);
            axieWrapper.append(runeBadge);
          }
        }

        // Add Axie ID link to marketplace (positioned relative to card)
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

        previewGrid.append(previewItem);
      }

      teamCell.append(previewGrid);
    } else {
      teamCell.textContent = "-";
      teamCell.style.color = "#888";
    }
    row.append(teamCell);

    const mmrCell = document.createElement("td");
    mmrCell.textContent = player.mmr || "-";
    row.append(mmrCell);

    leaderboardBody.append(row);
  }

  console.log(`[renderLeaderboardRows] COMPLETE: ${players.length} rows rendered`);
  updateActiveFilters();
  if (leaderboardCount) leaderboardCount.textContent = `Showing ${players.length} entries`;
}

function updateLeaderboardRelativeTimes() {
  // Update all last-battle-subtitle elements with fresh relative time calculations
  // This runs every second to keep the "Last played: XX:XX:XX ago" text current
  const subtitles = document.querySelectorAll(".last-battle-subtitle");
  for (const subtitle of subtitles) {
    const timestamp = subtitle.dataset.lastRankedBattleTime || null;
    subtitle.textContent = formatRelativeTime(timestamp);
  }
}

// Vite and the backend start in parallel under `npm run dev`. The frontend
// can become ready a moment before Express begins listening, so an initial
// ECONNREFUSED is a startup race rather than a permanent API failure.
async function fetchJsonWithRetry(url, attempts = 8) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;

      if (![502, 503, 504].includes(response.status) || attempt === attempts) {
        return response;
      }
      lastError = new Error(`Request failed: ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 1000)));
  }

  throw lastError || new Error("Request failed.");
}

// ===== Hydration (fetch + render) =====
async function hydrateLeaderboard() {
  const leaderboardBody = document.querySelector("#leaderboard-body");
  if (!leaderboardBody) {
    console.error("leaderboard-body element not found");
    return;
  }

  console.log("hydrateLeaderboard called");

  let renderedFromCacheFingerprint = null;
  const storagePayload = loadLeaderboardPageFromStorage(
    GET_SEASON_LEADERBOARD_API_LIMIT,
    GET_SEASON_LEADERBOARD_API_OFFSET,
    leaderboardState.currentEraMilestone
  );
  if (storagePayload) {
    console.log("Rendering leaderboard from browser cache");
    leaderboardState.leaderboardData = Array.isArray(storagePayload.players) ? storagePayload.players : [];
    if (!leaderboardState.runeFilterActive) {
      renderLeaderboardRows(
        leaderboardBody,
        applyLeaderboardFilters(leaderboardState.leaderboardData)
      );
    }
    renderedFromCacheFingerprint = fingerprintLeaderboard(leaderboardState.leaderboardData);
  } else if (!leaderboardState.runeFilterActive) {
    leaderboardBody.replaceChildren();
  }

  try {
    const liveModeParam = leaderboardState.liveModeEnabled ? "&liveMode=true" : "";
    const url = `/api/leaderboard?limit=${GET_SEASON_LEADERBOARD_API_LIMIT}&offset=${GET_SEASON_LEADERBOARD_API_OFFSET}&milestone=${leaderboardState.currentEraMilestone}${liveModeParam}`;
    if (leaderboardState.liveModeEnabled) console.log("[LIVE MODE] Bypassing cache, fetching fresh data...");
    console.log("Fetching from:", url);

    const response = await fetchJsonWithRetry(url);
    console.log("Response status:", response.status);

    if (!response.ok) {
      if (!leaderboardState.runeFilterActive) {
        leaderboardBody.innerHTML =
          '<tr><td colspan="4" style="text-align:center; padding:1rem; color:#888;">Failed to load leaderboard</td></tr>';
      }
      return;
    }

    const data = await response.json();
    console.log("Response data:", data);
    saveLeaderboardPageToStorage(
      GET_SEASON_LEADERBOARD_API_LIMIT,
      GET_SEASON_LEADERBOARD_API_OFFSET,
      leaderboardState.currentEraMilestone,
      data
    );

    // BUG FIX (2026-08-19): this used to backfill a missing lastRankedBattleTime
    // from the PREVIOUS poll cycle's value whenever the fresh fetch came back
    // empty. That was written to paper over the old backend behavior, where a
    // failed battle-log fetch dropped the player's team entirely
    // (`team: null`), which caused them to flicker in and out of the activity
    // filter. The backend (server.js's leaderboardEnrichment.js) no longer
    // does that: in live mode it now always reports the true
    // lastRankedBattleTime from THIS cycle's fetch, and explicitly returns
    // `null` (never a stale value) plus `battleTimeFetchFailed: true` when
    // that fetch failed, while still returning the player's last-known TEAM
    // composition from its own long-TTL cache so the row doesn't go blank.
    // No client-side merging is needed anymore: `players` from the response
    // is used as-is. A null lastRankedBattleTime renders as "can't fetch
    // last battle" via formatRelativeTime() below, which already handles it.
    const players = Array.isArray(data.players) ? data.players : [];

    if (leaderboardState.liveModeEnabled) {
      const failedCount = players.filter((p) => p.battleTimeFetchFailed).length;
      if (failedCount > 0) {
        console.log(`[LIVE MODE] ${failedCount}/${players.length} player(s) had a failed battle-time fetch this cycle; showing last-known team with an honest "can't fetch last battle" timestamp for those rows.`);
      }
    }

    leaderboardState.leaderboardData = players;
    console.log("Leaderboard data:", leaderboardState.leaderboardData);

    // A rune filter is showing scan results right now -- keep leaderboardData
    // warm in the background (so clearing the filter has fresh data ready)
    // but don't touch the DOM while those results are on screen.
    if (leaderboardState.runeFilterActive) return;

    const liveFingerprint = fingerprintLeaderboard(leaderboardState.leaderboardData);
    if (liveFingerprint === renderedFromCacheFingerprint) {
      console.log("Live leaderboard data matches cached render; skipping re-render");
      return;
    }

    renderLeaderboardRows(
      leaderboardBody,
      applyLeaderboardFilters(leaderboardState.leaderboardData)
    );

    // update last-updated indicator
    try {
      const updatedText = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (headerLastUpdated) headerLastUpdated.textContent = `Updated ${updatedText}`;
    } catch (e) {}
  } catch (error) {
    console.error("Leaderboard fetch error:", error);
    leaderboardBody.innerHTML =
      '<tr><td colspan="4" style="text-align:center; padding:1rem; color:#f33;">Error loading leaderboard</td></tr>';
  }
}

// ===== Rune filter (Track B) =====
// UX modeled on axie.top's sidebar: a searchable rune picker that, when a
// rune is selected, replaces the normal top-N table with every matching
// player found within the scanned rank range (see LEADERBOARD_MAX_RANK on the
// backend). This is a stub UI -- functional, not styled to match 1:1.
async function loadRuneCatalogIfNeeded() {
  if (leaderboardState.runeCatalogLoaded) return;
  try {
    const response = await fetch("/api/runes");
    if (!response.ok) throw new Error(`Rune catalog request failed: ${response.status}`);
    const data = await response.json();
    leaderboardState.runeCatalog = Array.isArray(data.runes) ? data.runes : [];
    leaderboardState.runeCatalogLoaded = true;
  } catch (error) {
    console.warn("Failed to load rune catalog", error);
  }
}

function renderRuneSuggestions(query) {
  if (!runeSuggestions) return;
  runeSuggestions.replaceChildren();

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    runeSuggestions.hidden = true;
    return;
  }

  const matches = leaderboardState.runeCatalog
    .filter((rune) => rune.name.toLowerCase().includes(trimmed))
    .slice(0, 20);

  if (matches.length === 0) {
    runeSuggestions.hidden = true;
    return;
  }

  for (const rune of matches) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rune-suggestion-item";
    item.innerHTML = `
      ${rune.imageUrl ? `<img src="${rune.imageUrl}" alt="" width="28" height="28" />` : ""}
      <span>${rune.name}</span>
      ${rune.class ? `<span class="rune-class-tag">${rune.class}</span>` : ""}
    `;
    item.addEventListener("click", () => applyRuneFilter(rune));
    runeSuggestions.append(item);
  }

  runeSuggestions.hidden = false;
}

async function applyRuneFilter(rune) {
  leaderboardState.activeRuneId = rune.id;
  leaderboardState.runeFilterActive = true;

  if (runeSearchInput) runeSearchInput.value = rune.name;
  if (runeSuggestions) runeSuggestions.hidden = true;
  if (runeFilterClear) runeFilterClear.hidden = false;

  const leaderboardBody = document.querySelector("#leaderboard-body");
  if (runeFilterStatus) {
    runeFilterStatus.hidden = false;
    runeFilterStatus.textContent = `Scanning top ${200} ranked players for "${rune.name}"...`;
  }
  if (leaderboardBody) leaderboardBody.replaceChildren();

  try {
    const url = `/api/leaderboard/rune/${encodeURIComponent(rune.id)}?milestone=${leaderboardState.currentEraMilestone}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Rune filter request failed: ${response.status}`);
    const data = await response.json();
    const matches = Array.isArray(data.players) ? data.players : [];

    // A rune filter change may have happened again while this request was
    // in flight -- only render if this response is still the active filter.
    if (leaderboardState.activeRuneId !== rune.id) return;

    if (runeFilterStatus) {
      runeFilterStatus.textContent = `${matches.length} player(s) running "${rune.name}" within top ${data.scannedRanks || LEADERBOARD_MAX_RANK}.`;
    }
    if (leaderboardBody) renderLeaderboardRows(leaderboardBody, matches);
  } catch (error) {
    console.error("Rune filter error:", error);
    if (runeFilterStatus) runeFilterStatus.textContent = `Failed to scan for "${rune.name}".`;
    if (leaderboardBody) {
      leaderboardBody.innerHTML =
        '<tr><td colspan="4" style="text-align:center; padding:1rem; color:#f33;">Error loading rune filter results</td></tr>';
    }
  }
}

function clearRuneFilter() {
  leaderboardState.activeRuneId = null;
  leaderboardState.runeFilterActive = false;
  if (runeSearchInput) runeSearchInput.value = "";
  if (runeSuggestions) runeSuggestions.hidden = true;
  if (runeFilterStatus) runeFilterStatus.hidden = true;
  if (runeFilterClear) runeFilterClear.hidden = true;
  renderFilteredLeaderboard();
}

async function syncConfiguredEra() {
  // Return whether callers need to reload leaderboard data after this sync.
  const previousEraMilestone = leaderboardState.currentEraMilestone;
  try {
    const response = await fetchJsonWithRetry("/api/season/current");
    if (!response.ok) throw new Error(`Season resolve failed: ${response.status}`);
    const data = await response.json();
    leaderboardState.currentEraMilestone = String(data.milestone);
    updateEraTabs(leaderboardState.currentEraMilestone);
    if (seasonSelector) seasonSelector.value = String(data.seasonId);
    console.log(
      `[syncConfiguredEra] Resolved ${data.seasonName} - ${data.eraName} (API milestone=${leaderboardState.currentEraMilestone})`
    );
    return previousEraMilestone !== leaderboardState.currentEraMilestone;
  } catch (error) {
    console.error(
      "[syncConfiguredEra] Failed to resolve current season/era; using milestone=3",
      error
    );
    leaderboardState.currentEraMilestone = "3";
    updateEraTabs(leaderboardState.currentEraMilestone);
    return previousEraMilestone !== leaderboardState.currentEraMilestone;
  }
}

const SEASON_ERA_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Every 24 hours

// ===== Entry point =====
// Wires every leaderboard DOM listener and kicks off the initial hydration.
// Called once by main.js at startup. This groups module-load-time side
// effects into an explicit function (rather than firing at import time like
// the original file did at the top level) so import order no longer matters
// for correctness -- main.js controls exactly when this feature "starts."
export function initLeaderboardView() {
  // Wire rank inputs (if present)
  if (rankMinInput) {
    // Validate and clamp min rank to 1..1000. Keep empty input allowed.
    let rankMinMsgTimer = null;
    const showMinMessage = (msg) => {
      if (!rankMinError) return;
      rankMinError.textContent = msg;
      rankMinError.hidden = false;
      rankMinInput.setAttribute("aria-invalid", "true");
      clearTimeout(rankMinMsgTimer);
      rankMinMsgTimer = setTimeout(() => {
        rankMinError.hidden = true;
        rankMinInput.removeAttribute("aria-invalid");
      }, 3000);
    };

    rankMinInput.addEventListener("input", () => {
      const raw = rankMinInput.value.trim();
      if (raw === "") {
        leaderboardState.rankMin = null;
        if (rankMinError) rankMinError.hidden = true;
      } else {
        let value = Number(raw);
        if (!Number.isFinite(value)) {
          leaderboardState.rankMin = null;
          showMinMessage("Enter a whole number (1–1000)");
        } else {
          value = Math.floor(value);
          let clamped = false;
          if (value < 1) { value = 1; clamped = true; }
          if (value > 1000) { value = 1000; clamped = true; }
          leaderboardState.rankMin = value;
          if (clamped) {
            rankMinInput.value = String(value);
            showMinMessage(`Value clamped to ${value}`);
          }
        }
      }
      updateRankFilterLabels();
      renderFilteredLeaderboard();
    });

    rankMinInput.addEventListener("blur", () => {
      // on blur, if empty or invalid, show gentle guidance
      const raw = rankMinInput.value.trim();
      if (raw !== "") {
        const v = Number(raw);
        if (!Number.isFinite(v)) showMinMessage("Enter a number between 1 and 1000");
      }
    });
  }

  if (rankMaxInput) {
    // Validate and clamp max rank to 1..1000. Keep empty input allowed.
    let rankMaxMsgTimer = null;
    const showMaxMessage = (msg) => {
      if (!rankMaxError) return;
      rankMaxError.textContent = msg;
      rankMaxError.hidden = false;
      rankMaxInput.setAttribute("aria-invalid", "true");
      clearTimeout(rankMaxMsgTimer);
      rankMaxMsgTimer = setTimeout(() => {
        rankMaxError.hidden = true;
        rankMaxInput.removeAttribute("aria-invalid");
      }, 3000);
    };

    rankMaxInput.addEventListener("input", () => {
      const raw = rankMaxInput.value.trim();
      if (raw === "") {
        leaderboardState.rankMax = null;
        if (rankMaxError) rankMaxError.hidden = true;
      } else {
        let value = Number(raw);
        if (!Number.isFinite(value)) {
          leaderboardState.rankMax = null;
          showMaxMessage("Enter a whole number (1–1000)");
        } else {
          value = Math.floor(value);
          let clamped = false;
          if (value < 1) { value = 1; clamped = true; }
          if (value > 1000) { value = 1000; clamped = true; }
          leaderboardState.rankMax = value;
          if (clamped) {
            rankMaxInput.value = String(value);
            showMaxMessage(`Value clamped to ${value}`);
          }
        }
      }
      updateRankFilterLabels();
      renderFilteredLeaderboard();
    });

    rankMaxInput.addEventListener("blur", () => {
      const raw = rankMaxInput.value.trim();
      if (raw !== "") {
        const v = Number(raw);
        if (!Number.isFinite(v)) showMaxMessage("Enter a number between 1 and 1000");
      }
    });
  }

  if (rankTopNButton) {
    rankTopNButton.addEventListener("click", () => {
      leaderboardState.rankMin = 1;
      leaderboardState.rankMax = 100;
      if (rankMinInput) rankMinInput.value = "1";
      if (rankMaxInput) rankMaxInput.value = "100";
      updateRankFilterLabels();
      renderFilteredLeaderboard();
    });
  }

  if (lastBattleFilter) {
    const sliderWrapper = document.querySelector(".recency-slider-wrapper");

    const updateBattleWindowFromSlider = () => {
      const preset = getBattleWindowPreset(lastBattleFilter.value);
      leaderboardState.activeBattleWindowMinutes = preset.minutes;

      // Update slider visuals
      const min = Number(lastBattleFilter.min);
      const max = Number(lastBattleFilter.max);
      const value = Number(lastBattleFilter.value);
      const ratio = (value - min) / (max - min);
      const progress = `${ratio * 100}%`;

      if (sliderWrapper) {
        sliderWrapper.style.setProperty("--track-progress", progress);
        sliderWrapper.style.setProperty("--thumb-position", progress);
      }

      updateLeaderboardFilterLabels();
      renderFilteredLeaderboard();
    };

    lastBattleFilter.addEventListener("input", updateBattleWindowFromSlider);
    lastBattleFilter.value = String(DEFAULT_BATTLE_WINDOW_MINUTES);
    leaderboardState.activeBattleWindowMinutes = DEFAULT_BATTLE_WINDOW_MINUTES;
    updateBattleWindowFromSlider();
  }

  if (playerNameSearch && playerNameClear) {
    playerNameClear.addEventListener("click", () => {
      playerNameSearch.value = "";
      playerNameSearch.focus();
    });
  }

  if (resetFiltersButton) {
    resetFiltersButton.addEventListener("click", () => {
      leaderboardState.rankMin = null;
      leaderboardState.rankMax = null;
      if (rankMinInput) rankMinInput.value = "";
      if (rankMaxInput) rankMaxInput.value = "";
      if (playerNameSearch) playerNameSearch.value = "";
      clearRuneFilter();
      updateLeaderboardFilterLabels();
      renderFilteredLeaderboard();
    });
  }

  // rank filter is replaced by sidebar inputs (#rank-min / #rank-max)

  if (liveModeToggle) {
    liveModeToggle.addEventListener("change", () => {
      leaderboardState.liveModeEnabled = liveModeToggle.checked;
      console.log(`[Live Mode] User toggled: checkbox=${liveModeToggle.checked}, liveModeEnabled=${leaderboardState.liveModeEnabled}`);
      updateLiveModeControls();
    });

    // Sync checkbox state with liveModeEnabled variable every 2 seconds
    // This catches any unintended state drift (e.g., DOM mutations resetting checkbox)
    setInterval(() => {
      if (liveModeToggle.checked !== leaderboardState.liveModeEnabled) {
        console.warn(
          `[Live Mode] State drift detected! Checkbox=${liveModeToggle.checked} but liveModeEnabled=${leaderboardState.liveModeEnabled}. Syncing...`
        );
        liveModeToggle.checked = leaderboardState.liveModeEnabled;
        if (!leaderboardState.liveModeEnabled) {
          // If live mode should be off but checkbox is still checked, trigger the change event
          liveModeToggle.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }, 2000);
  }

  if (pollingIntervalSelect) {
    pollingIntervalSelect.addEventListener("change", () => {
      leaderboardState.pollingIntervalSeconds = Number(pollingIntervalSelect.value) || 30;
      if (leaderboardState.liveModeEnabled) startLeaderboardPolling();
    });
  }

  updateLeaderboardFilterLabels();
  updateLiveModeControls();

  setInterval(updateLeaderboardRelativeTimes, 1000);

  // Navigation and button handlers.
  // NOTE: this handler also toggles the meta/team-builder/morph views, which
  // aren't leaderboard-specific -- kept here as one unit (matching the
  // original file) since the leaderboard branch is the only one with real
  // logic (triggering hydration); the others are pure visibility toggles.
  // Worth factoring into a dedicated small "view router" module later if
  // more tabs gain real logic.
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const nav = button.dataset.nav;
      const dashboardLayout = document.querySelector(".dashboard-layout");

      dashboardLayout?.classList.toggle("morph-active", nav === "morph");

      document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.add("hidden");
      });

      document.querySelectorAll(".nav-button").forEach((btn) => {
        btn.classList.toggle("active", btn === button);
      });

      if (nav === "leaderboard") {
        const leaderboardView = document.querySelector("#leaderboard-view");
        if (leaderboardView) {
          leaderboardView.classList.remove("hidden");
          await hydrateLeaderboard();
        }
      } else if (nav === "meta") {
        const metaView = document.querySelector("#meta-view");
        if (metaView) metaView.classList.remove("hidden");
      } else if (nav === "team-builder") {
        const teamBuilderView = document.querySelector("#team-builder-view");
        if (teamBuilderView) teamBuilderView.classList.remove("hidden");
      } else if (nav === "morph") {
        const morphView = document.querySelector("#morph-view");
        if (morphView) morphView.classList.remove("hidden");
      }
    });
  });

  for (const tab of eraTabs) {
    tab.addEventListener("click", () => {
      const milestone = tab.dataset.milestone;
      if (!milestone) return;
      leaderboardState.currentEraMilestone = milestone;
      updateEraTabs(milestone);
      hydrateLeaderboard();
    });
  }

  // ===== TEMPORARY: Compact mode toggle (easy to remove) =====
  if (compactModeToggle && leaderboardTable) {
    const setCompactMode = (compactModeEnabled) => {
      leaderboardState.compactModeEnabled = compactModeEnabled;
      leaderboardTable.classList.toggle("compact-mode", compactModeEnabled);
      compactModeToggle.classList.toggle("active", compactModeEnabled);
      standardModeToggle?.classList.toggle("active", !compactModeEnabled);
      compactModeToggle.setAttribute("aria-pressed", String(compactModeEnabled));
      standardModeToggle?.setAttribute("aria-pressed", String(!compactModeEnabled));
      compactModeToggle.textContent = "Compact";
      compactModeToggle.setAttribute(
        "aria-label",
        compactModeEnabled ? "Switch to standard view" : "Switch to compact view"
      );
    };

    compactModeToggle.addEventListener("click", () => setCompactMode(true));
    standardModeToggle?.addEventListener("click", () => setCompactMode(false));

    compactModeToggle.setAttribute("aria-label", "Switch to compact view");
  }
  // ===== END: Compact mode toggle =====

  if (runeSearchInput) {
    runeSearchInput.addEventListener("input", (e) => {
      loadRuneCatalogIfNeeded().then(() => renderRuneSuggestions(e.target.value));
    });
    runeSearchInput.addEventListener("focus", () => {
      loadRuneCatalogIfNeeded().then(() => renderRuneSuggestions(runeSearchInput.value));
    });
  }

  if (runeFilterClear) {
    runeFilterClear.addEventListener("click", clearRuneFilter);
  }

  document.addEventListener("click", (e) => {
    if (!runeSuggestions || runeSuggestions.hidden) return;
    if (e.target === runeSearchInput || runeSuggestions.contains(e.target)) return;
    runeSuggestions.hidden = true;
  });

  async function startLeaderboardView() {
    // Resolve the era before the first leaderboard request so the initial
    // request does not depend on the fallback era value.
    await syncConfiguredEra();
    await hydrateLeaderboard();
    setInterval(async () => {
      const milestoneChanged = await syncConfiguredEra();
      if (milestoneChanged) await hydrateLeaderboard();
    }, SEASON_ERA_CHECK_INTERVAL_MS);
  }

  // Load leaderboard on startup (wait for DOM to be ready)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log("DOM content loaded, starting leaderboard");
      startLeaderboardView();
    });
  } else {
    console.log("DOM already loaded, starting leaderboard immediately");
    startLeaderboardView();
  }
}
