// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old main.js,
// no logic changes.
import { getPageItems } from "../pagination.js";
import { renderMorphedAxieCached } from "../shared/morphRenderer.js";
import { escapeHtml } from "../shared/formatting.js";
import {
  axieLookupState,
  AXIES_PER_PAGE,
  ALL_TAGS,
  form,
  input,
  label,
  status,
  results,
  pagination,
  filterButton,
  clearButton,
  filterPanel,
  collectibleFilters,
  evolvedRange,
  evolvedValue,
  filterApply,
  filterReset,
  filterClose,
  showOnlyCollectiblesInput
} from "./axieLookupState.js";

function buildFilterChips() {
  if (!collectibleFilters) return;
  collectibleFilters.replaceChildren();
  for (const tag of ALL_TAGS) {
    const id = `filter-${tag}`;
    const wrapper = document.createElement("label");
    wrapper.className = "filter-chip";
    wrapper.innerHTML = `\n      <input type="checkbox" id="${id}" data-tag="${tag}" />\n      <span>${tag}</span>\n    `;
    const checkbox = wrapper.querySelector("input");
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) axieLookupState.activeTags.add(tag);
      else axieLookupState.activeTags.delete(tag);
    });
    collectibleFilters.append(wrapper);
  }
}

function updateFilterAvailability() {
  if (!filterButton) return;

  const enabled = axieLookupState.currentMode === "address";
  filterButton.disabled = !enabled;
  filterButton.title = enabled
    ? "Filters are available in Ronin address mode"
    : "Filters are only active in Ronin address mode";
  filterButton.classList.toggle("disabled", !enabled);

  if (!enabled && filterPanel) {
    filterPanel.setAttribute("aria-hidden", "true");
  }
}

function getVerifiedCollectibleTags(axie) {
  const tags = Array.isArray(axie?.collectibleTags) ? axie.collectibleTags : [];
  const title = String(axie?.title || "").toLowerCase();
  const collection = String(axie?.collection || "").toLowerCase();

  return tags.filter((tag) => {
    if (tag === "Morphed") return false;
    if (tag === "Origin") return title.includes("origin") || collection.includes("origin");
    if (tag === "MEO") return title.includes("meo") || collection.includes("meo");
    if (tag === "Agamogenesis") return collection.includes("agamo") || collection.includes("agamogenesis");
    return true;
  });
}

function applyFilters(items) {
  let list = Array.isArray(items) ? items.slice() : [];

  // Do not apply collectible or tag filters to direct Axie ID lookups.
  if (axieLookupState.currentMode !== "address") {
    return list;
  }

  // default: show only collectibles
  if (axieLookupState.showOnlyCollectibles) {
    list = list.filter((a) => getVerifiedCollectibleTags(a).length > 0);
  }

  // tag filters (OR semantics)
  if (axieLookupState.activeTags.size > 0) {
    list = list.filter((a) => {
      const ct = getVerifiedCollectibleTags(a);
      for (const t of ct) if (axieLookupState.activeTags.has(t)) return true;
      return false;
    });
  }

  // evolved parts filter (disabled slider; placeholder heuristic)
  if (axieLookupState.minEvolvedParts > 0) {
    list = list.filter((a) => {
      const parts = Array.isArray(a.parts) ? a.parts : [];
      let evolved = 0;
      for (const p of parts) {
        const stage = Number(p.part_stage || p.stage || 0);
        if (stage > 0) evolved += 1;
      }
      return evolved >= axieLookupState.minEvolvedParts;
    });
  }

  return list;
}

function buildMorphSummary(axie, previewFailed = false) {
  if (!axie?.genesMetamorph) {
    return "Morph preview unavailable; no morphed parts were returned.";
  }

  const parts = Array.isArray(axie.parts) ? axie.parts : [];
  const labels = parts
    .map((part) => {
      const name = String(part?.name || "").trim();
      const details = [part?.class, part?.type].filter(Boolean).join(" / ");
      return details ? `${name} (${details})` : name;
    })
    .filter(Boolean)
    .slice(0, 8);

  if (labels.length > 0) {
    if (previewFailed) {
      return `Morph preview unavailable. Meta Morph part(s): ${labels.join(", ")}`;
    }

    return `Meta Morph part(s): ${labels.join(", ")}`;
  }

  return previewFailed
    ? "Morph preview unavailable; morph part details unavailable"
    : "Meta Morph detected; detailed part metadata unavailable (visual preview shown)";
}

function addAxieCard(axie) {
  const card = document.createElement("article");
  card.className = "axie-card";

  const morphSummary = buildMorphSummary(axie);

  const marketplaceUrl = `https://app.axieinfinity.com/marketplace/axies/${axie.id}/`;
  const battleLogUrl = axie.accountId ? `https://axie.top/profile/${axie.accountId}` : null;

  card.innerHTML = `
    <h2><a class="axie-link" href="${marketplaceUrl}" target="_blank" rel="noopener noreferrer">Axie #${escapeHtml(axie.id)}</a></h2>

    ${battleLogUrl ? `<p style="margin:6px 0 8px;"><a class="axie-link" href="${battleLogUrl}" target="_blank" rel="noopener noreferrer">Open Battle Logs</a></p>` : ''}

    <p class="meta">
      ${escapeHtml(axie.name || "")}
    </p>

    <p class="meta">
      ${escapeHtml(axie.title || "")}
      ${escapeHtml(axie.class || "")}
    </p>

    <p class="meta collectible-type">
      Collectible type: ${escapeHtml(axie.collectibleType || "Not collectible")}
    </p>

    <p class="meta">
      ${escapeHtml(morphSummary)}
    </p>

    <div class="images">
      <div class="image-box">
        <small>Original parts</small>
        <img
          src="${axie.standardImageUrl}"
          alt="Original Axie ${escapeHtml(axie.id)}"
          loading="lazy"
          width="360"
          height="180"
        />
      </div>

      <div class="image-box">
        <small>Morphed parts</small>
        <div class="morph-target"></div>
      </div>
    </div>
  `;

  results.append(card);

  const target = card.querySelector(".morph-target");
  if (!axie.genesMetamorph) {
    target.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:180px; padding:1rem; text-align:center; color:#334155;">
        <span>${escapeHtml(buildMorphSummary(axie))}</span>
      </div>
    `;
    return;
  }

  target.classList.add("is-loading");

  renderMorphedAxieCached(target, axie.renderGenes, { snapshot: true })
    .catch((error) => {
      console.warn(`Axie preview render failed for #${axie.id}`, error);

      const morphText = buildMorphSummary(axie, true);

      target.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:180px; padding:1rem; text-align:center; color:#334155;">
          <strong style="display:block; margin-bottom:0.5rem; color:#1d4ed8;">Morph preview unavailable</strong>
          <span>${escapeHtml(morphText)}</span>
        </div>
      `;
    })
    .finally(() => {
      target.classList.remove("is-loading");
    });
}

// ===== Client-paginated results (Axie ID mode) =====
function renderPage(page) {
  axieLookupState.currentPage = page;

  const pageData = getPageItems(
    axieLookupState.currentResults,
    axieLookupState.currentPage,
    AXIES_PER_PAGE
  );

  // apply client-side filters to paginated items
  const filteredItems = applyFilters(pageData.items || []);

  results.replaceChildren();
  results.append(pagination);

  const pageLabel = document.createElement("p");
  pageLabel.className = "page-status";
  pageLabel.id = "results-header";
  pageLabel.setAttribute("aria-live", "polite");

  const displayedCount = filteredItems.length;

  if (pageData.totalItems > AXIES_PER_PAGE) {
    pageLabel.textContent = `Showing ${pageData.page === 1 ? 1 : (pageData.page - 1) * AXIES_PER_PAGE + 1}-${Math.min(pageData.page * AXIES_PER_PAGE, pageData.totalItems)} of ${pageData.totalItems} Axies • Page ${pageData.page} of ${pageData.totalPages} • Displaying ${displayedCount} after filters.`;
  } else {
    pageLabel.textContent = `${pageData.totalItems} Axie${pageData.totalItems === 1 ? "" : "s"} found.` + (displayedCount !== pageData.totalItems ? ` ${displayedCount} displayed after filters.` : "");
  }

  results.append(pageLabel);

  if (displayedCount === 0) {
    const note = document.createElement('p');
    note.className = 'meta';
    note.textContent = 'No items match the active filters. Try disabling "Show only collectibles" or clearing filters.';
    results.append(note);
  }

  for (const axie of filteredItems) {
    addAxieCard(axie);
  }

  renderPagination(pageData);
}

function scrollToResults() {
  document.querySelector("#results-header")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pageSet = new Set([1, totalPages, currentPage]);
  for (const page of [currentPage - 1, currentPage + 1]) {
    if (page > 1 && page < totalPages) pageSet.add(page);
  }

  if (currentPage <= 3) {
    for (let page = 2; page <= 4; page += 1) pageSet.add(page);
  } else if (currentPage >= totalPages - 2) {
    for (let page = totalPages - 3; page < totalPages; page += 1) pageSet.add(page);
  }

  return [...pageSet].sort((left, right) => left - right);
}

function renderPaginationControls(currentPage, totalPages, onPageChange) {
  pagination.replaceChildren();
  if (totalPages <= 1) return;

  const navBar = document.createElement("div");
  navBar.className = "pagination-bar";

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.className = "pagination-nav";
  prevButton.textContent = "←";
  prevButton.setAttribute("aria-label", "Previous page");
  prevButton.title = "Previous page";
  prevButton.disabled = currentPage === 1;
  prevButton.addEventListener("click", () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  });
  navBar.append(prevButton);

  const pageLabel = document.createElement("div");
  pageLabel.className = "pagination-page-label";
  pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  pageLabel.setAttribute("aria-live", "polite");
  navBar.append(pageLabel);

  const pageNumbers = document.createElement("div");
  pageNumbers.className = "page-numbers";

  let previousPage = 0;
  for (const page of getPaginationItems(currentPage, totalPages)) {
    if (page - previousPage > 1) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "pagination-ellipsis";
      ellipsis.textContent = "…";
      ellipsis.setAttribute("aria-hidden", "true");
      pageNumbers.append(ellipsis);
    }

    const pageButton = document.createElement("button");
    pageButton.type = "button";
    pageButton.textContent = String(page);
    pageButton.className = page === currentPage
      ? "pagination-page-button active"
      : "pagination-page-button";
    pageButton.setAttribute("aria-label", `Page ${page}`);
    if (page === currentPage) pageButton.setAttribute("aria-current", "page");
    pageButton.addEventListener("click", () => {
      if (page !== currentPage) onPageChange(page);
    });
    pageNumbers.append(pageButton);
    previousPage = page;
  }

  navBar.append(pageNumbers);

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "pagination-nav";
  nextButton.textContent = "→";
  nextButton.setAttribute("aria-label", "Next page");
  nextButton.title = "Next page";
  nextButton.disabled = currentPage === totalPages;
  nextButton.addEventListener("click", () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  });
  navBar.append(nextButton);

  pagination.append(navBar);
}

function renderPagination(pageData) {
  const totalPages = Math.max(1, Number(pageData.totalPages || 1));
  const currentPage = Number(pageData.page || 1);
  renderPaginationControls(currentPage, totalPages, (page) => {
    renderPage(page);
    scrollToResults();
  });
}

// ===== Server-paginated results (Ronin address mode) =====
async function renderPageFromServer(page, body) {
  axieLookupState.currentPage = page;

  results.replaceChildren();
  results.append(pagination);

  const pageLabel = document.createElement("p");
  pageLabel.className = "page-status";
  pageLabel.id = "results-header";
  pageLabel.setAttribute("aria-live", "polite");

  const totalItems = Number(body.totalItems || 0);
  const pageSize = Number(body.pageSize || AXIES_PER_PAGE);
  const filteredItems = applyFilters(Array.isArray(body.axies) ? body.axies : []);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPageNumber = Number(page || body.page || 1);
  const safePage = Math.min(currentPageNumber, totalPages);
  const showingStart = filteredItems.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const showingEnd = Math.min(safePage * pageSize, filteredItems.length);
  const pageItems = filteredItems.slice(showingStart - 1, showingEnd);
  const displayedCount = pageItems.length;

  pageLabel.textContent = filteredItems.length > 0
    ? `Showing ${showingStart}-${showingEnd} of ${filteredItems.length} matching Axies • Page ${safePage} of ${totalPages}`
    : `No Axies match the active filters out of ${totalItems}.`;

  results.append(pageLabel);

  if (body.morphDataNotice) {
    const notice = document.createElement("p");
    notice.className = "meta";
    notice.textContent = body.morphDataNotice;
    results.append(notice);
  }

  if (displayedCount === 0) {
    const note = document.createElement('p');
    note.className = 'meta';
    note.textContent = 'No items match the active filters. Try disabling "Show only collectibles" or clearing filters.';
    results.append(note);
  }

  for (const axie of pageItems) {
    addAxieCard(axie);
  }

  renderServerPagination({ page: safePage, totalPages });
}

function renderServerPagination(body) {
  const totalPages = Math.max(1, Number(body.totalPages || 1));
  const currentPage = Number(body.page || 1);
  renderPaginationControls(currentPage, totalPages, async (page) => {
    await loadPage(page);
    scrollToResults();
  });
}

async function loadPage(page) {
  if (axieLookupState.lastServerResponse) {
    await renderPageFromServer(page, axieLookupState.lastServerResponse);
    return;
  }

  const value = encodeURIComponent(input.value.trim());
  const endpoint = `/api/address/${value}?page=${page}&limit=${AXIES_PER_PAGE}`;
  const response = await fetch(endpoint);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }

  axieLookupState.currentResults = body.axies || [];
  axieLookupState.lastServerResponse = body;
  await renderPageFromServer(page, body);
}

// ===== Entry point =====
// Wires every axie-lookup DOM listener. Called once by main.js at startup.
export function initAxieLookupView() {
  buildFilterChips();

  if (filterButton) {
    filterButton.addEventListener("click", () => {
      if (axieLookupState.currentMode !== "address") return;
      const isHidden = filterPanel.getAttribute("aria-hidden") === "true";
      filterPanel.setAttribute("aria-hidden", String(!isHidden));
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      axieLookupState.currentResults = [];
      axieLookupState.currentPage = 1;
      status.textContent = "";
      status.className = "status";
      results.replaceChildren();
      results.append(pagination);
      input.value = "";
      axieLookupState.lastServerResponse = null;
    });
  }

  if (filterClose) filterClose.addEventListener("click", () => filterPanel.setAttribute("aria-hidden", "true"));
  if (filterReset)
    filterReset.addEventListener("click", () => {
      axieLookupState.activeTags.clear();
      for (const tag of ALL_TAGS) {
        const el = document.querySelector(`#filter-${tag}`);
        if (el) el.checked = false;
      }
      axieLookupState.minEvolvedParts = 0;
      if (evolvedRange) evolvedRange.value = "0";
      if (evolvedValue) evolvedValue.textContent = "0";
    });

  if (filterApply)
    filterApply.addEventListener("click", () => {
      filterPanel.setAttribute("aria-hidden", "true");
      if (axieLookupState.currentMode === "address" && axieLookupState.lastServerResponse) {
        renderPageFromServer(1, axieLookupState.lastServerResponse);
      } else {
        renderPage(1);
      }
    });

  if (evolvedRange) evolvedRange.addEventListener("input", (e) => {
    evolvedValue.textContent = e.target.value;
    axieLookupState.minEvolvedParts = Number(e.target.value);
  });

  if (showOnlyCollectiblesInput) {
    showOnlyCollectiblesInput.addEventListener("change", (e) => {
      axieLookupState.showOnlyCollectibles = Boolean(e.target.checked);
    });
  }

  document.querySelectorAll(".mode").forEach((button) => {
    button.addEventListener("click", () => {
      axieLookupState.mode = button.dataset.mode;

      document.querySelectorAll(".mode").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      label.textContent =
        axieLookupState.mode === "id" ? "Axie ID" : "Ronin address";

      input.placeholder =
        axieLookupState.mode === "id"
          ? "e.g. 585 2270 2488"
          : "0x...";

      input.value = "";
      axieLookupState.currentPage = 1;
      axieLookupState.currentResults = [];
      axieLookupState.currentMode = axieLookupState.mode;
      axieLookupState.lastServerResponse = null;
      results.replaceChildren();
      results.append(pagination);
      status.textContent = "";
      status.className = "status";

      updateFilterAvailability();
    });
  });

  updateFilterAvailability();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    axieLookupState.currentMode = axieLookupState.mode;
    status.textContent = "Loading...";
    status.className = "status";

    try {
      const rawValue = input.value.trim();
      if (!rawValue) {
        throw new Error("Please enter one or more Axie IDs or a Ronin address.");
      }

      if (axieLookupState.mode === "address") {
        results.replaceChildren();
        results.append(pagination);
        axieLookupState.currentPage = 1;
        axieLookupState.currentResults = [];
        axieLookupState.lastServerResponse = null;

        const value = encodeURIComponent(rawValue);
        const endpoint = `/api/address/${value}?page=1&limit=${AXIES_PER_PAGE}`;
        const response = await fetch(endpoint);
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Request failed.");
        }

        axieLookupState.currentResults = body.axies || [];
        axieLookupState.currentPage = 1;
        axieLookupState.lastServerResponse = body;
        renderPageFromServer(1, body);
        return;
      }

      const ids = rawValue
        .split(/[,\s]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token, index, self) => self.indexOf(token) === index);

      if (ids.length === 0) {
        throw new Error("Please enter one or more valid Axie IDs.");
      }

      const fetchedAxies = [];
      for (const id of ids) {
        const value = encodeURIComponent(id);
        const response = await fetch(`/api/axie/${value}`);
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || `Failed to fetch Axie ${id}.`);
        }

        fetchedAxies.push(body.axie);
      }

      if (fetchedAxies.length === 0) {
        throw new Error("No Axies were returned.");
      }

      axieLookupState.currentResults = axieLookupState.currentResults.concat(fetchedAxies);
      axieLookupState.currentPage = 1;
      results.replaceChildren();
      results.append(pagination);
      renderPage(1);
    } catch (error) {
      status.textContent = error.message;
      status.className = "status error";
    }
  });
}
