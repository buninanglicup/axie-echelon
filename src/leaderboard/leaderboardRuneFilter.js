// Rune catalog/search behavior. Rendering result rows is delegated to the
// view through callbacks to avoid circular imports.
import {
  LEADERBOARD_MAX_RANK,
  leaderboardState,
  runeSearchInput,
  runeSuggestions,
  runeFilterStatus,
  runeFilterClear,
  selectedRuneChips,
  pageControls,
  MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE
} from "./leaderboardState.js";
import { getPageItems } from "../pagination.js";

const RUNE_RESCAN_DEBOUNCE_MS = 350;
const RUNE_SCAN_POLL_INTERVAL_MS = 1500;

export function createRuneFilterController({ renderRows, updateActiveFilters, getLeaderboardBody, onClear, onApply, getCombinedMatches }) {
  let selectedRunes = [];
  let scanGeneration = 0;
  let rescanDebounceTimer = null;
  let lastScanMatches = [];
  let runeResultsPage = 1;
  let activeJobId = null;
  let pollTimer = null;

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
      .filter((rune) => !selectedRunes.some((selected) => selected.id === rune.id))
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

  function renderSelectedRuneChips() {
    if (!selectedRuneChips) return;
    selectedRuneChips.replaceChildren();
    for (const rune of selectedRunes) {
      const chip = document.createElement("span");
      chip.className = "selected-rune-chip";

      if (rune.imageUrl) {
        const image = document.createElement("img");
        image.src = rune.imageUrl;
        image.alt = "";
        image.width = 24;
        image.height = 24;
        chip.append(image);
      }

      const label = document.createElement("span");
      label.textContent = rune.name;
      chip.append(label);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "selected-rune-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${rune.name} rune filter`);
      removeButton.addEventListener("click", () => removeRune(rune.id));
      chip.append(removeButton);
      selectedRuneChips.append(chip);
    }
  }

  function buildRuneScanParams() {
    const params = new URLSearchParams();
    params.set("milestone", leaderboardState.currentEraMilestone);
    for (const rune of selectedRunes) params.append("runeId", rune.id);
    const { rankMin, rankMax, playerNameQuery } = leaderboardState;
    if (rankMin) params.set("rankMin", String(rankMin));
    if (rankMax) params.set("rankMax", String(rankMax));
    const trimmedName = (playerNameQuery || "").trim();
    if (trimmedName) params.set("name", trimmedName);
    return params;
  }

  function hideRunePager() {
    if (!pageControls) return;
    pageControls.hidden = true;
    pageControls.replaceChildren();
  }

  function renderRuneResultsPage() {
    const leaderboardBody = getLeaderboardBody();
    if (!leaderboardBody) return;
    const pageInfo = getPageItems(getCombinedMatches?.(lastScanMatches) ?? lastScanMatches, runeResultsPage, MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE);
    runeResultsPage = pageInfo.page;
    renderRows(leaderboardBody, pageInfo.items);
    if (pageControls) {
      if (pageInfo.totalPages <= 1) {
        hideRunePager();
      } else {
        pageControls.hidden = false;
        pageControls.replaceChildren();
        for (let page = 1; page <= pageInfo.totalPages; page += 1) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = String(page);
          if (page === pageInfo.page) {
            button.classList.add("active");
            button.setAttribute("aria-current", "page");
          }
          button.addEventListener("click", () => {
            runeResultsPage = page;
            renderRuneResultsPage();
          });
          pageControls.append(button);
        }
      }
    }
    updateActiveFilters();
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function cancelJob(jobId) {
    if (!jobId) return;
    fetch(`/api/leaderboard/rune-scan/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch((error) => {
      console.warn(`Failed to cancel rune scan job ${jobId}`, error);
    });
  }

  function statusTextForJob(job) {
    const runeNames = selectedRunes.map((rune) => rune.name).join(", ");
    const totalLabel = job.totalCandidates ?? (job.rankMax - job.rankMin + 1);
    if (job.status === "queued") return `Queued to scan top ${totalLabel} ranked players for "${runeNames}"...`;
    if (job.status === "running") {
      const progress = job.totalCandidates ? `${job.processedCount}/${job.totalCandidates} checked` : `${job.processedCount} checked`;
      return `Scanning top ${totalLabel} ranked players for "${runeNames}"... ${progress}, ${job.matches.length} found so far.`;
    }
    if (job.status === "complete") return `${job.matches.length} player(s) running any selected rune within top ${totalLabel}.`;
    if (job.status === "partial") {
      const progress = job.totalCandidates ? `${job.processedCount}/${job.totalCandidates}` : `${job.processedCount}`;
      return `Scan for "${runeNames}" timed out after checking ${progress} players -- showing ${job.matches.length} match(es) found so far. Coverage is incomplete.`;
    }
    if (job.status === "cancelled") return `Scan for "${runeNames}" was cancelled.`;
    return `Failed to scan for the selected runes.`;
  }

  function errorTextForJob(job) {
    if (job.error?.code === "RUNE_SCAN_TIMEOUT") return `The rune scan took too long and was stopped. Try narrowing the rank range.`;
    if (job.error?.code === "LEADERBOARD_UPSTREAM_UNAVAILABLE") return `The leaderboard data source is temporarily unavailable -- try again shortly.`;
    return `Failed to scan for the selected runes.`;
  }

  function applyJobUpdate(job, generation) {
    if (generation !== scanGeneration || !leaderboardState.runeFilterActive) return;
    lastScanMatches = Array.isArray(job.matches) ? job.matches : [];
    if (runeFilterStatus) {
      runeFilterStatus.hidden = false;
      runeFilterStatus.textContent = statusTextForJob(job);
    }
    renderRuneResultsPage();

    if (job.status === "queued" || job.status === "running") {
      pollTimer = setTimeout(() => pollJob(job.jobId, generation), RUNE_SCAN_POLL_INTERVAL_MS);
      return;
    }

    activeJobId = null;
    if (job.status === "failed") {
      const message = errorTextForJob(job);
      if (runeFilterStatus) runeFilterStatus.textContent = message;
      if (lastScanMatches.length === 0) {
        const body = getLeaderboardBody();
        if (body) body.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1rem; color:#f33;">${message}</td></tr>`;
      }
    }
  }

  async function pollJob(jobId, generation) {
    if (generation !== scanGeneration || !leaderboardState.runeFilterActive) return;
    try {
      const response = await fetch(`/api/leaderboard/rune-scan/${encodeURIComponent(jobId)}`);
      if (generation !== scanGeneration || !leaderboardState.runeFilterActive) return;
      if (response.status === 404) {
        activeJobId = null;
        startScan({ isRescan: true });
        return;
      }
      if (!response.ok) throw new Error(`Rune scan poll failed: ${response.status}`);
      applyJobUpdate(await response.json(), generation);
    } catch (error) {
      if (generation !== scanGeneration || !leaderboardState.runeFilterActive) return;
      console.error("Rune scan poll error:", error);
      if (runeFilterStatus) runeFilterStatus.textContent = "Lost connection while scanning -- retrying...";
      pollTimer = setTimeout(() => pollJob(jobId, generation), RUNE_SCAN_POLL_INTERVAL_MS);
    }
  }

  async function startScan({ isRescan = false } = {}) {
    const generation = ++scanGeneration;
    if (onApply) onApply();

    stopPolling();
    cancelJob(activeJobId);
    activeJobId = null;

    lastScanMatches = [];
    runeResultsPage = 1;
    const runeNames = selectedRunes.map((rune) => rune.name).join(", ");
    if (runeFilterStatus) {
      runeFilterStatus.hidden = false;
      runeFilterStatus.textContent = `${isRescan ? "Rescanning" : "Scanning"} top ${LEADERBOARD_MAX_RANK} ranked players for "${runeNames}"...`;
    }
    const leaderboardBody = getLeaderboardBody();
    if (leaderboardBody) leaderboardBody.replaceChildren();
    hideRunePager();

    try {
      const params = buildRuneScanParams();
      const response = await fetch(`/api/leaderboard/rune-scan?${params.toString()}`, { method: "POST" });
      if (generation !== scanGeneration || !leaderboardState.runeFilterActive) return;
      if (!response.ok) {
        let code = null;
        let message = null;
        try {
          const errorBody = await response.json();
          code = errorBody.code || null;
          message = errorBody.error || null;
        } catch {
          // Use the status-based fallback below when the response is not JSON.
        }
        const error = new Error(message || `Rune scan request failed: ${response.status}`);
        error.code = code;
        error.retryAfterSeconds = Number(response.headers.get("retry-after")) || null;
        throw error;
      }
      const job = await response.json();
      if (generation !== scanGeneration || !leaderboardState.runeFilterActive) return;
      activeJobId = job.jobId;
      applyJobUpdate(job, generation);
    } catch (error) {
      console.error("Rune filter error:", error);
      if (generation !== scanGeneration) return;
      const statusText = error.code === "LEADERBOARD_UPSTREAM_UNAVAILABLE"
        ? `The leaderboard data source is temporarily unavailable -- try again shortly.`
        : `Failed to start scan for the selected runes.`;
      if (runeFilterStatus) runeFilterStatus.textContent = statusText;
      if (leaderboardBody) {
        leaderboardBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1rem; color:#f33;">${statusText}</td></tr>`;
      }
    }
  }

  async function applyRuneFilter(rune) {
    if (selectedRunes.some((selected) => selected.id === rune.id)) return;
    selectedRunes = [...selectedRunes, rune];
    leaderboardState.selectedRunes = selectedRunes;
    leaderboardState.activeRuneId = selectedRunes[0]?.id || null;
    leaderboardState.runeFilterActive = true;

    if (runeSearchInput) runeSearchInput.value = "";
    if (runeSuggestions) runeSuggestions.hidden = true;
    if (runeFilterClear) runeFilterClear.hidden = false;
    renderSelectedRuneChips();
    clearTimeout(rescanDebounceTimer);
    await startScan();
  }

  function rescanIfActive() {
    if (!leaderboardState.runeFilterActive || selectedRunes.length === 0) return;
    clearTimeout(rescanDebounceTimer);
    rescanDebounceTimer = setTimeout(() => {
      startScan({ isRescan: true });
    }, RUNE_RESCAN_DEBOUNCE_MS);
  }

  function removeRune(runeId) {
    selectedRunes = selectedRunes.filter((rune) => rune.id !== runeId);
    leaderboardState.selectedRunes = selectedRunes;
    leaderboardState.activeRuneId = selectedRunes[0]?.id || null;
    renderSelectedRuneChips();
    if (selectedRunes.length === 0) {
      clearRuneFilter();
      if (onClear) onClear();
      return;
    }
    leaderboardState.runeFilterActive = true;
    startScan({ isRescan: true });
  }

  function clearRuneFilter() {
    scanGeneration += 1;
    stopPolling();
    cancelJob(activeJobId);
    activeJobId = null;
    selectedRunes = [];
    leaderboardState.selectedRunes = [];
    lastScanMatches = [];
    runeResultsPage = 1;
    scanGeneration += 1;
    clearTimeout(rescanDebounceTimer);
    leaderboardState.activeRuneId = null;
    leaderboardState.runeFilterActive = false;
    if (runeSearchInput) runeSearchInput.value = "";
    if (runeSuggestions) runeSuggestions.hidden = true;
    if (runeFilterStatus) runeFilterStatus.hidden = true;
    if (runeFilterClear) runeFilterClear.hidden = true;
    renderSelectedRuneChips();
    hideRunePager();
  }

  function init() {
    if (runeSearchInput) {
      runeSearchInput.addEventListener("input", (event) => {
        loadRuneCatalogIfNeeded().then(() => renderRuneSuggestions(event.target.value));
      });
      runeSearchInput.addEventListener("focus", () => {
        loadRuneCatalogIfNeeded().then(() => renderRuneSuggestions(runeSearchInput.value));
      });
    }

    if (runeFilterClear) {
      runeFilterClear.addEventListener("click", () => {
        clearRuneFilter();
        if (onClear) onClear();
        else updateActiveFilters();
      });
    }

    document.addEventListener("click", (event) => {
      if (!runeSuggestions || runeSuggestions.hidden) return;
      if (event.target === runeSearchInput || runeSuggestions.contains(event.target)) return;
      runeSuggestions.hidden = true;
    });
  }

  return { clearRuneFilter, rescanIfActive, renderCurrentResults: renderRuneResultsPage, getMatches: () => lastScanMatches, init };
}
