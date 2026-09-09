// PHASE 1 FILE SPLIT (2026-08-19).
// This file used to be ~1740 lines containing leaderboard state/rendering/
// filters/live mode/rune filter AND the axie-lookup feature (ID/address
// search, pagination, collectible filters) all mixed together at module
// scope. It's now a thin entry point: the page-reload-detection debug
// scaffolding (unchanged, kept verbatim) plus wiring the two feature
// views. All business logic lives under src/leaderboard/, src/axieLookup/,
// and src/shared/ (code used by both features).
import { initLeaderboardView } from "./leaderboard/leaderboardView.js";
import { initAxieLookupView } from "./axieLookup/axieLookupView.js";
import { renderProfileBattleLogPanel } from "./profile/profileView.js";

function initMobileNavigation() {
  const toggle = document.getElementById("top-nav-toggle");
  const navigation = document.getElementById("top-nav");
  if (!toggle || !navigation) return;
  const close = () => {
    navigation.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a.nav-button")) close();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 600) close();
  });
}

function initDarkTooltips() {
  const tooltip = document.createElement("div");
  tooltip.className = "app-tooltip";
  tooltip.id = "app-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  const normalize = (element) => {
    if (!(element instanceof Element) || !element.hasAttribute("title") || element.dataset.detail) return;
    const message = element.getAttribute("title");
    if (!message) return;
    element.dataset.tooltip = message;
    element.removeAttribute("title");
  };
  const normalizeTree = (root) => {
    if (!(root instanceof Element || root instanceof Document)) return;
    if (root instanceof Element) normalize(root);
    root.querySelectorAll?.("[title]").forEach(normalize);
  };
  normalizeTree(document);

  let activeTarget = null;
  const hide = () => {
    if (activeTarget) activeTarget.removeAttribute("aria-describedby");
    activeTarget = null;
    tooltip.hidden = true;
  };
  const show = (target) => {
    const message = target?.dataset?.tooltip;
    if (!message || target.hasAttribute("disabled")) return;
    activeTarget = target;
    tooltip.textContent = message;
    tooltip.hidden = false;
    target.setAttribute("aria-describedby", tooltip.id);
    const rect = target.getBoundingClientRect();
    const margin = 8;
    const top = Math.min(window.innerHeight - tooltip.offsetHeight - margin, rect.bottom + margin);
    const left = Math.max(margin, Math.min(window.innerWidth - tooltip.offsetWidth - margin, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  };
  document.addEventListener("pointerover", (event) => show(event.target.closest?.("[data-tooltip]")));
  document.addEventListener("pointerout", (event) => { if (event.target.closest?.("[data-tooltip]") === activeTarget) hide(); });
  document.addEventListener("focusin", (event) => show(event.target.closest?.("[data-tooltip]")));
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) normalizeTree(node);
  }).observe(document.body, { childList: true, subtree: true });
}

// ===== PAGE RELOAD DETECTION =====
// Track if this is a fresh page load (for debugging live mode resets)
const pageLoadTime = Date.now();
const isPageReload = sessionStorage.getItem("pageLoadTime") !== null;
sessionStorage.setItem("pageLoadTime", String(pageLoadTime));

if (isPageReload) {
  const lastLoadTime = Number(sessionStorage.getItem("pageLoadTime") || 0);
  const timeSinceLastLoad = pageLoadTime - lastLoadTime;
  console.warn(
    `[PAGE RELOAD DETECTED] Page reloaded. Previous load was ${timeSinceLastLoad}ms ago.`
  );
}

window.addEventListener("beforeunload", () => {
  console.warn("[UNLOAD EVENT] Page is about to unload/reload");
});

window.addEventListener("pagehide", () => {
  console.warn("[PAGEHIDE EVENT] Page visibility is being hidden (may be reload or navigation)");
});

// Log any fetch errors that might indicate backend connection issues
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).catch(error => {
    console.error("[FETCH ERROR]", args[0], error);
    throw error;
  });
};

// ===== END PAGE RELOAD DETECTION =====

// Profiles are routed full-page views; they intentionally bypass the normal
// dashboard panel toggles while reusing the same application shell.
function initProfilePageIfNeeded() {
  const profileMatch = window.location.pathname.match(/^\/profile\/([^/?#]+)/);
  if (!profileMatch) return;

  const profileId = decodeURIComponent(profileMatch[1]);
  const profilePanel = document.getElementById("profile-panel");
  const profileView = document.getElementById("profile-view");
  const sidePanel = document.querySelector(".side-panel");
  const leaderboardView = document.getElementById("leaderboard-view");
  const dashboardLayout = document.querySelector(".dashboard-layout");

  if (profileView) profileView.classList.remove("hidden");
  dashboardLayout?.classList.add("profile-active");
  if (sidePanel) sidePanel.hidden = true;
  if (leaderboardView) leaderboardView.classList.add("hidden");
  if (profilePanel) {
    renderProfileBattleLogPanel(profilePanel, profileId);
  }

  // The normal navigation handler only swaps panels; a profile is a routed
  // full-width view, so return to the root route instead of leaving the
  // profile layout active behind a narrow leaderboard column.
  document.querySelector('[data-nav="leaderboard"]')?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.assign("/");
  }, true);
}

initAxieLookupView();
initLeaderboardView();
initProfilePageIfNeeded();
initMobileNavigation();
initDarkTooltips();
