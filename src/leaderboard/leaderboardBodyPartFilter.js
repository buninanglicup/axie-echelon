import bodyPartMappingData from "../data/body-part-mapping-candidate.json";
import {
  LEADERBOARD_MAX_RANK,
  leaderboardState,
  bodyPartSearchInput,
  bodyPartSuggestions,
  bodyPartFilterStatus,
  bodyPartFilterClear,
  selectedBodyPartChips,
  pageControls,
  MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE
} from "./leaderboardState.js";
import { getPageItems } from "../pagination.js";

const BODY_PART_RESCAN_DEBOUNCE_MS = 350;
const BODY_PART_SCAN_POLL_INTERVAL_MS = 1500;

function getCandidateBodyParts() {
  const canonicalParts = new Map();
  for (const mapping of bodyPartMappingData.mappings || []) {
    if (mapping.status !== "candidate" || !mapping.canonicalName) continue;
    const key = mapping.canonicalName.toLowerCase();
    const existing = canonicalParts.get(key) || { name: mapping.canonicalName, variants: [] };
    for (const variant of mapping.variants || []) {
      if (variant?.name && !existing.variants.includes(variant.name)) existing.variants.push(variant.name);
    }
    canonicalParts.set(key, existing);
  }
  return [...canonicalParts.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function createBodyPartFilterController({ renderRows, updateActiveFilters, getLeaderboardBody, onClear, onApply, getCombinedMatches }) {
  let selectedBodyParts = [];
  let scanGeneration = 0;
  let rescanDebounceTimer = null;
  let lastScanMatches = [];
  let resultsPage = 1;
  let activeJobId = null;
  let pollTimer = null;

  function renderSuggestions(query) {
    if (!bodyPartSuggestions) return;
    bodyPartSuggestions.replaceChildren();
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      bodyPartSuggestions.hidden = true;
      return;
    }
    const matches = leaderboardState.bodyPartCatalog
      .filter((part) => !selectedBodyParts.some((selected) => selected.name === part.name))
      .filter((part) => part.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 20);
    for (const part of matches) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "rune-suggestion-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-label", `Select body part ${part.name}`);
      const name = document.createElement("span");
      name.textContent = part.name;
      item.append(name);
      item.addEventListener("click", () => applyBodyPart(part));
      bodyPartSuggestions.append(item);
    }
    bodyPartSuggestions.hidden = matches.length === 0;
  }

  function renderChips() {
    if (!selectedBodyPartChips) return;
    selectedBodyPartChips.replaceChildren();
    for (const part of selectedBodyParts) {
      const chip = document.createElement("span");
      chip.className = "selected-rune-chip";
      const label = document.createElement("span");
      label.textContent = part.name;
      chip.append(label);
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "selected-rune-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${part.name} body-part filter`);
      removeButton.addEventListener("click", () => removeBodyPart(part.name));
      chip.append(removeButton);
      selectedBodyPartChips.append(chip);
    }
  }

  function buildScanParams() {
    const params = new URLSearchParams({ milestone: leaderboardState.currentEraMilestone });
    for (const part of selectedBodyParts) params.append("bodyPartName", part.name);
    if (leaderboardState.rankMin) params.set("rankMin", String(leaderboardState.rankMin));
    if (leaderboardState.rankMax) params.set("rankMax", String(leaderboardState.rankMax));
    const name = (leaderboardState.playerNameQuery || "").trim();
    if (name) params.set("name", name);
    return params;
  }

  function hidePager() {
    if (!pageControls) return;
    pageControls.hidden = true;
    pageControls.replaceChildren();
  }

  function renderResultsPage() {
    const body = getLeaderboardBody();
    if (!body) return;
    const pageInfo = getPageItems(getCombinedMatches?.(lastScanMatches) ?? lastScanMatches, resultsPage, MAXIMUM_PLAYERS_DISPLAYED_PER_PAGE);
    resultsPage = pageInfo.page;
    renderRows(body, pageInfo.items);
    if (pageControls && pageInfo.totalPages > 1) {
      pageControls.hidden = false;
      pageControls.replaceChildren();
      for (let page = 1; page <= pageInfo.totalPages; page += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = String(page);
        if (page === pageInfo.page) button.setAttribute("aria-current", "page");
        button.classList.toggle("active", page === pageInfo.page);
        button.addEventListener("click", () => {
          resultsPage = page;
          renderResultsPage();
        });
        pageControls.append(button);
      }
    } else {
      hidePager();
    }
    updateActiveFilters();
  }

  function stopPolling() {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function cancelJob(jobId) {
    if (!jobId) return;
    fetch(`/api/leaderboard/body-part-scan/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => {});
  }

  function statusText(job) {
    const names = selectedBodyParts.map((part) => part.name).join(", ");
    const total = job.totalCandidates ?? (job.rankMax - job.rankMin + 1);
    if (job.status === "queued") return `Queued to scan ${total} ranked players for ${names}.`;
    if (job.status === "running") return `Scanning ${total} ranked players for ${names}: ${job.processedCount}/${job.totalCandidates ?? "?"} checked, ${job.matches.length} found.`;
    if (job.status === "complete") return `${job.matches.length} player(s) match any selected body part.`;
    if (job.status === "partial") return `Coverage is incomplete: ${job.processedCount}/${job.totalCandidates ?? "?"} checked; showing ${job.matches.length} match(es).`;
    if (job.status === "cancelled") return "Body-part scan cancelled.";
    return "Body-part scan failed.";
  }

  function renderMessage(message) {
    const body = getLeaderboardBody();
    if (!body) return;
    body.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.style.cssText = "text-align:center; padding:1rem; color:#f99;";
    cell.textContent = message;
    row.append(cell);
    body.append(row);
  }

  function applyJobUpdate(job, generation) {
    if (generation !== scanGeneration || !leaderboardState.bodyPartFilterActive) return;
    lastScanMatches = Array.isArray(job.matches) ? job.matches : [];
    if (bodyPartFilterStatus) {
      bodyPartFilterStatus.hidden = false;
      bodyPartFilterStatus.textContent = statusText(job);
    }
    renderResultsPage();
    if (job.status === "queued" || job.status === "running") {
      pollTimer = setTimeout(() => pollJob(job.jobId, generation), BODY_PART_SCAN_POLL_INTERVAL_MS);
      return;
    }
    activeJobId = null;
    if (job.status === "failed" && lastScanMatches.length === 0) renderMessage("Failed to scan for the selected body parts.");
  }

  async function pollJob(jobId, generation) {
    if (generation !== scanGeneration || !leaderboardState.bodyPartFilterActive) return;
    try {
      const response = await fetch(`/api/leaderboard/body-part-scan/${encodeURIComponent(jobId)}`);
      if (generation !== scanGeneration || !leaderboardState.bodyPartFilterActive) return;
      if (response.status === 404) return startScan({ isRescan: true });
      if (!response.ok) throw new Error(`Body-part scan poll failed: ${response.status}`);
      applyJobUpdate(await response.json(), generation);
    } catch (error) {
      if (generation !== scanGeneration || !leaderboardState.bodyPartFilterActive) return;
      if (bodyPartFilterStatus) bodyPartFilterStatus.textContent = "Lost connection while scanning — retrying...";
      pollTimer = setTimeout(() => pollJob(jobId, generation), BODY_PART_SCAN_POLL_INTERVAL_MS);
    }
  }

  async function startScan({ isRescan = false } = {}) {
    const generation = ++scanGeneration;
    onApply?.();
    stopPolling();
    cancelJob(activeJobId);
    activeJobId = null;
    lastScanMatches = [];
    resultsPage = 1;
    if (bodyPartFilterStatus) {
      bodyPartFilterStatus.hidden = false;
      bodyPartFilterStatus.textContent = `${isRescan ? "Rescanning" : "Scanning"} selected body parts...`;
    }
    getLeaderboardBody()?.replaceChildren();
    hidePager();
    try {
      const response = await fetch(`/api/leaderboard/body-part-scan?${buildScanParams()}`, { method: "POST" });
      if (generation !== scanGeneration || !leaderboardState.bodyPartFilterActive) return;
      if (!response.ok) throw new Error(`Body-part scan request failed: ${response.status}`);
      const job = await response.json();
      if (generation !== scanGeneration || !leaderboardState.bodyPartFilterActive) return;
      activeJobId = job.jobId;
      applyJobUpdate(job, generation);
    } catch (error) {
      if (generation !== scanGeneration) return;
      if (bodyPartFilterStatus) bodyPartFilterStatus.textContent = "Failed to start body-part scan.";
      renderMessage("Failed to start body-part scan.");
    }
  }

  async function applyBodyPart(part) {
    if (selectedBodyParts.some((selected) => selected.name === part.name)) return;
    selectedBodyParts = [...selectedBodyParts, part];
    leaderboardState.selectedBodyPartNames = selectedBodyParts.map((selected) => selected.name);
    leaderboardState.bodyPartFilterActive = true;
    if (bodyPartSearchInput) bodyPartSearchInput.value = "";
    if (bodyPartSuggestions) bodyPartSuggestions.hidden = true;
    if (bodyPartFilterClear) bodyPartFilterClear.hidden = false;
    renderChips();
    clearTimeout(rescanDebounceTimer);
    await startScan();
  }

  function rescanIfActive() {
    if (!leaderboardState.bodyPartFilterActive || selectedBodyParts.length === 0) return;
    clearTimeout(rescanDebounceTimer);
    rescanDebounceTimer = setTimeout(() => startScan({ isRescan: true }), BODY_PART_RESCAN_DEBOUNCE_MS);
  }

  function removeBodyPart(name) {
    selectedBodyParts = selectedBodyParts.filter((part) => part.name !== name);
    leaderboardState.selectedBodyPartNames = selectedBodyParts.map((part) => part.name);
    renderChips();
    if (selectedBodyParts.length === 0) {
      clearBodyPartFilter();
      onClear?.();
    } else {
      startScan({ isRescan: true });
    }
  }

  function clearBodyPartFilter() {
    scanGeneration += 1;
    stopPolling();
    cancelJob(activeJobId);
    activeJobId = null;
    clearTimeout(rescanDebounceTimer);
    selectedBodyParts = [];
    leaderboardState.selectedBodyPartNames = [];
    leaderboardState.bodyPartFilterActive = false;
    lastScanMatches = [];
    resultsPage = 1;
    if (bodyPartSearchInput) bodyPartSearchInput.value = "";
    if (bodyPartSuggestions) bodyPartSuggestions.hidden = true;
    if (bodyPartFilterStatus) bodyPartFilterStatus.hidden = true;
    if (bodyPartFilterClear) bodyPartFilterClear.hidden = true;
    renderChips();
    hidePager();
  }

  function init() {
    leaderboardState.bodyPartCatalog = getCandidateBodyParts();
    bodyPartSearchInput?.addEventListener("input", (event) => renderSuggestions(event.target.value));
    bodyPartSearchInput?.addEventListener("focus", () => renderSuggestions(bodyPartSearchInput.value));
    bodyPartFilterClear?.addEventListener("click", () => {
      clearBodyPartFilter();
      onClear?.();
    });
    document.addEventListener("click", (event) => {
      if (!bodyPartSuggestions || bodyPartSuggestions.hidden) return;
      if (event.target === bodyPartSearchInput || bodyPartSuggestions.contains(event.target)) return;
      bodyPartSuggestions.hidden = true;
    });
  }

  return { clearBodyPartFilter, rescanIfActive, renderCurrentResults: renderResultsPage, getMatches: () => lastScanMatches, init };
}
