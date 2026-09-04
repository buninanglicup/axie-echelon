// Rune catalog/search behavior. Rendering result rows is delegated to the
// view through callbacks to avoid circular imports.
import { LEADERBOARD_MAX_RANK, leaderboardState, runeSearchInput, runeSuggestions, runeFilterStatus, runeFilterClear } from "./leaderboardState.js";

export function createRuneFilterController({ renderRows, updateActiveFilters, getLeaderboardBody, onClear, onApply }) {
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
    if (onApply) onApply();

    if (runeSearchInput) runeSearchInput.value = rune.name;
    if (runeSuggestions) runeSuggestions.hidden = true;
    if (runeFilterClear) runeFilterClear.hidden = false;

    const leaderboardBody = getLeaderboardBody();
    if (runeFilterStatus) {
      runeFilterStatus.hidden = false;
      runeFilterStatus.textContent = `Scanning top ${LEADERBOARD_MAX_RANK} ranked players for "${rune.name}"...`;
    }
    if (leaderboardBody) leaderboardBody.replaceChildren();

    try {
      const url = `/api/leaderboard/rune/${encodeURIComponent(rune.id)}?milestone=${leaderboardState.currentEraMilestone}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Rune filter request failed: ${response.status}`);
      const data = await response.json();
      const matches = Array.isArray(data.players) ? data.players : [];

      if (leaderboardState.activeRuneId !== rune.id) return;

      if (runeFilterStatus) {
        runeFilterStatus.textContent = `${matches.length} player(s) running "${rune.name}" within top ${data.scannedRanks || LEADERBOARD_MAX_RANK}.`;
      }
      if (leaderboardBody) {
        renderRows(leaderboardBody, matches);
        updateActiveFilters();
      }
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

  return { clearRuneFilter, init };
}
