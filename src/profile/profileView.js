import { renderMorphedAxieCached } from "../shared/morphRenderer.js";
import { profileState, loadMoreProfileBattleLogs, loadProfileBattlePage } from "./profileState.js";
import { historicalCoverageText } from "../leaderboard/historicalTeamProvenance.js";
import { coerceCompatibleRune, formatRuneBadgeLabel } from "../leaderboard/runeBadgeUtil.js";
import { createVstarBadge } from "../shared/vstarBadge.js";

// Profile battle history is intentionally scan-first: battle context sits
// between the two participants, while rune/charm details stay in the inspector.

function text(value, fallback = "Not available") { return typeof value === "string" && value.trim() ? value : fallback; }
function formatTimestamp(value) { const date = new Date(value); return !value || Number.isNaN(date.getTime()) ? "Unknown finish time" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function formatRelativeTime(value) {
  const delta = Date.now() - Date.parse(value);
  if (!Number.isFinite(delta) || delta < 0) return null;
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 ? ` ${hours % 24}h` : ""} ago`;
}
function formatDuration(ms) { if (!Number.isFinite(ms) || ms <= 0) return "Duration unavailable"; const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function resultCopy(result) { return result === "win" ? ["Win", "profile-result-win"] : result === "loss" ? ["Loss", "profile-result-loss"] : result === "draw" ? ["Draw", "profile-result-draw"] : ["Result unknown", "profile-result-unknown"]; }
const GAME_MODE_LABELS = { ranked: "Ranked", challenge: "Challenge", practice: "Casual", haunted: "Arcade" };
function gameModeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return { normalized, label: GAME_MODE_LABELS[normalized] || (normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Unknown") };
}
function shortenUserID(userID) { return userID?.length > 14 ? `${userID.slice(0, 8)}…${userID.slice(-5)}` : text(userID, "Player"); }
function shortenRoninAddress(address) { return address?.length === 42 ? `${address.slice(0, 6)}…${address.slice(-4)}` : text(address, "—"); }

// The VSTAR badge and the recent win/loss strip both anchor to the player
// name heading rather than living in a separate column, so a profile reads as
// one identity card instead of name + rating + form as disconnected pieces.
// Both helpers are idempotent: re-running renderProfileBattleLogPanel (e.g.
// switching profiles) reuses the wrapper/row already inserted into the DOM
// instead of nesting a new one each time.
function ensureNameRatingSlot(profileHeading) {
  if (!profileHeading) return null;
  let row = profileHeading.parentElement;
  if (!row || !row.classList.contains("profile-name-rating-row")) {
    const wrapper = document.createElement("div"); wrapper.className = "profile-name-rating-row";
    profileHeading.replaceWith(wrapper);
    wrapper.append(profileHeading);
    row = wrapper;
  }
  let slot = row.querySelector(".profile-name-rating-slot");
  if (!slot) { slot = document.createElement("span"); slot.className = "profile-name-rating-slot"; row.append(slot); }
  return { row, slot };
}

function ensureRecentFormRow(nameRow) {
  if (!nameRow) return null;
  let form = nameRow.nextElementSibling;
  if (!form || !form.classList.contains("profile-recent-form")) {
    form = document.createElement("div"); form.className = "profile-recent-form";
    nameRow.insertAdjacentElement("afterend", form);
  }
  return form;
}

function renderRecentForm(container, items) {
  container.replaceChildren();
  const recent = items.slice(0, 10);
  if (!recent.length) { container.hidden = true; return; }
  container.hidden = false;
  const label = document.createElement("span"); label.className = "profile-recent-form-label"; label.textContent = `Last ${recent.length} games`;
  const dots = document.createElement("div"); dots.className = "profile-recent-form-dots";
  let wins = 0, losses = 0, draws = 0;
  for (const entry of recent) {
    const variant = entry.result === "win" ? "win" : entry.result === "loss" ? "loss" : entry.result === "draw" ? "draw" : "unknown";
    if (variant === "win") wins++; else if (variant === "loss") losses++; else if (variant === "draw") draws++;
    const dot = document.createElement("span"); dot.className = `profile-form-dot profile-form-dot--${variant}`;
    const resultLabel = variant === "win" ? "Win" : variant === "loss" ? "Loss" : variant === "draw" ? "Draw" : "Result unknown";
    const detail = `${resultLabel} vs ${text(entry.opponent?.name, "Opponent")}`;
    dot.dataset.tooltip = detail; dot.setAttribute("aria-label", detail); dot.setAttribute("tabindex", "0");
    dots.append(dot);
  }
  const record = document.createElement("span"); record.className = "profile-recent-form-record"; record.textContent = draws ? `${wins}W-${losses}L-${draws}D` : `${wins}W-${losses}L`;
  container.setAttribute("aria-label", `Last ${recent.length} games: ${wins} wins, ${losses} losses${draws ? `, ${draws} draws` : ""}`);
  container.append(label, dots, record);
}
function copyIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
  const front = document.createElementNS("http://www.w3.org/2000/svg", "rect"); front.setAttribute("x", "9"); front.setAttribute("y", "9"); front.setAttribute("width", "10"); front.setAttribute("height", "10"); front.setAttribute("rx", "1.5");
  const back = document.createElementNS("http://www.w3.org/2000/svg", "path"); back.setAttribute("d", "M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16H9");
  icon.append(front, back);
  return icon;
}
function copyConfirmationIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
  const check = document.createElementNS("http://www.w3.org/2000/svg", "path"); check.setAttribute("d", "m5 12 4.5 4.5L19 7");
  icon.append(check);
  return icon;
}
function showAxieVisualUnavailable(morph) {
  morph.replaceChildren(); morph.classList.add("is-unavailable");
  const icon = document.createElement("span"); icon.className = "profile-axie-unavailable-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "◇";
  const label = document.createElement("span"); label.textContent = "Visual unavailable";
  morph.append(icon, label);
}
function inspectIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
  const lens = document.createElementNS("http://www.w3.org/2000/svg", "circle"); lens.setAttribute("cx", "10.5"); lens.setAttribute("cy", "10.5"); lens.setAttribute("r", "5.5");
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "path"); handle.setAttribute("d", "m15 15 4.5 4.5");
  icon.append(lens, handle);
  return icon;
}
function formatImpact(impact) {
  if (!Number.isFinite(impact?.vstarBefore) || !Number.isFinite(impact?.vstarAfter)) return "VSTAR unavailable";
  const delta = Number.isFinite(impact.vstarDelta) ? ` (${impact.vstarDelta > 0 ? "+" : ""}${impact.vstarDelta})` : "";
  return `${impact.vstarBefore} → ${impact.vstarAfter} VSTAR${delta}`;
}
function impactTitle(impact) {
  if (!Number.isFinite(impact?.vstarDelta)) return "";
  const details = [`VSTAR: ${impact.vstarBefore} → ${impact.vstarAfter}`];
  if (Number.isFinite(impact.eloDelta)) details.push(`Elo: ${impact.eloBefore} → ${impact.eloAfter}`);
  return details.join("\n");
}

function createRatingDeltaChip(impact) {
  if (!Number.isFinite(impact?.vstarAfter) || !Number.isFinite(impact?.vstarDelta)) return null;
  const chip = document.createElement("span"); chip.className = "profile-delta-chip";
  chip.append(createVstarBadge({ value: impact.vstarAfter, delta: impact.vstarDelta, variant: "compact" }));
  return chip;
}

function createStatusPill(result, resultClass) {
  const pill = document.createElement("span"); pill.className = `profile-status-pill profile-battle-result ${resultClass}`;
  const icon = document.createElement("span"); icon.className = "profile-battle-result-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = result === "Win" ? "✓" : result === "Loss" ? "×" : "?";
  pill.append(icon, document.createTextNode(result));
  return pill;
}

function appendRatingSummary(container, label, impact, { identity = false, title = "", href = "", showDelta = true, variant = "" } = {}) {
  const summary = document.createElement("div"); summary.className = `profile-rating-summary${variant ? ` ${variant}` : ""}`;
  const heading = label ? document.createElement(href ? "a" : "span") : null;
  if (heading) { heading.className = identity ? "profile-rating-player-name" : "profile-rating-label"; heading.textContent = label; heading.title = title; if (href) { heading.classList.add("profile-opponent-link"); heading.href = href; } }
  const transition = document.createElement("span"); transition.className = "profile-rating-transition";
  const delta = document.createElement("span"); delta.className = "profile-rating-delta";
  if (Number.isFinite(impact?.vstarBefore) && Number.isFinite(impact?.vstarAfter)) {
    transition.textContent = `${impact.vstarBefore} → ${impact.vstarAfter}`;
    if (Number.isFinite(impact.vstarDelta)) transition.classList.add(impact.vstarDelta >= 0 ? "profile-impact-positive" : "profile-impact-negative");
    if (showDelta) {
      const chip = createRatingDeltaChip(impact);
      if (chip) delta.append(chip);
    }
    summary.title = impactTitle(impact);
  } else {
    transition.textContent = "VSTAR unavailable";
    transition.classList.add("profile-impact-unknown");
  }
  if (heading) summary.append(heading);
  summary.append(transition);
  if (delta.textContent) summary.append(delta);
  container.append(summary);
}

function createRatingTrend(entries) {
  const values = entries
    .slice()
    .reverse()
    .filter((entry) => String(entry?.gameMode || "").toLowerCase() === "ranked")
    .map((entry) => entry?.player?.impact?.vstarAfter)
    .filter(Number.isFinite);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 104;
  const height = 28;
  const inset = 2;
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = inset + ((width - inset * 2) * index) / (values.length - 1);
    const y = height - inset - ((value - min) / range) * (height - inset * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const change = values.at(-1) - values[0];
  const trend = document.createElement("div"); trend.className = "profile-rating-trend";
  trend.setAttribute("role", "img");
  trend.setAttribute("aria-label", `Rating trend across ${values.length} recent battles: ${values[0]} to ${values.at(-1)} VSTAR, ${change >= 0 ? "+" : ""}${change}.`);
  trend.title = trend.getAttribute("aria-label");
  const label = document.createElement("span"); label.className = "profile-rating-trend-label"; label.textContent = `${values[0]} → ${values.at(-1)}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("profile-rating-sparkline"); svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); line.setAttribute("points", points); line.setAttribute("fill", "none"); line.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(line);
  trend.append(label, svg);
  return { trend, change, battles: values.length };
}

const CHARM_SLOTS = [["eyes", "Eyes", "E"], ["ears", "Ears", "E"], ["mouth", "Mouth", "M"], ["horn", "Horn", "H"], ["back", "Back", "B"], ["tail", "Tail", "T"]];
let inspectorState = null;

function closeBuildInspector() {
  document.getElementById("profile-build-inspector-overlay")?.classList.remove("is-open");
  document.getElementById("profile-build-inspector")?.classList.remove("is-open");
}

function renderBuildInspector() {
  const drawer = document.getElementById("profile-build-inspector");
  if (!drawer || !inspectorState) return;
  const { fighters, index, context } = inspectorState;
  const fighter = fighters[index];
  drawer.replaceChildren();
  const header = document.createElement("header"); header.className = "build-inspector-header";
  const heading = document.createElement("div");
  const contextLine = document.createElement("div"); contextLine.className = "build-inspector-context"; contextLine.textContent = context;
  const title = document.createElement("h3");
  if (fighter.axieID) {
    const marketplaceLink = document.createElement("a"); marketplaceLink.className = "build-inspector-axie-link";
    marketplaceLink.href = `https://app.axieinfinity.com/marketplace/axies/${encodeURIComponent(fighter.axieID)}/`;
    marketplaceLink.target = "_blank"; marketplaceLink.rel = "noopener noreferrer";
    marketplaceLink.title = `View Axie #${fighter.axieID} on the marketplace (opens in a new tab)`;
    marketplaceLink.textContent = `Axie #${fighter.axieID} ↗`; title.append(marketplaceLink);
  } else title.textContent = "Axie build";
  heading.append(contextLine, title);
  const close = document.createElement("button"); close.className = "build-inspector-close"; close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", "Close Axie build inspector"); close.onclick = closeBuildInspector;
  header.append(heading, close);
  const body = document.createElement("div"); body.className = "build-inspector-body";
  const stepper = document.createElement("div"); stepper.className = "build-inspector-stepper";
  const previous = document.createElement("button"); previous.type = "button"; previous.textContent = "‹ Previous"; previous.onclick = () => { inspectorState.index = (inspectorState.index + fighters.length - 1) % fighters.length; renderBuildInspector(); };
  const counter = document.createElement("span"); counter.textContent = `${index + 1} / ${fighters.length}`;
  const next = document.createElement("button"); next.type = "button"; next.textContent = "Next ›"; next.onclick = () => { inspectorState.index = (inspectorState.index + 1) % fighters.length; renderBuildInspector(); };
  stepper.append(previous, counter, next);
  const hero = document.createElement("section"); hero.className = "build-inspector-hero";
  const morph = document.createElement("div"); morph.className = "build-inspector-morph";
  const details = document.createElement("div"); details.className = "build-inspector-details";
  const rune = coerceCompatibleRune(fighter);
  if (rune) {
    const runeInfo = document.createElement("div"); runeInfo.className = "build-inspector-rune";
    if (rune.imageUrl) { const image = document.createElement("img"); image.src = rune.imageUrl; image.alt = ""; image.addEventListener("error", () => image.remove()); runeInfo.append(image); }
    const runeText = document.createElement("span"); runeText.textContent = formatRuneBadgeLabel(rune) || rune.id || "Rune"; runeText.title = `Rune: ${runeText.textContent}`; runeInfo.append(runeText); details.append(runeInfo);
  }
  if (!details.childElementCount) { const unavailable = document.createElement("p"); unavailable.className = "build-inspector-unavailable"; unavailable.textContent = "Rune unavailable"; details.append(unavailable); }
  hero.append(morph, details);
  const genes = fighter.genes_metamorph || fighter.genes;
  if (genes) renderMorphedAxieCached(morph, genes, { snapshot: true }).catch(() => showAxieVisualUnavailable(morph));
  else showAxieVisualUnavailable(morph);
  const equipment = document.createElement("section");
  const equipmentHeading = document.createElement("h4"); equipmentHeading.textContent = "Equipped charms"; equipment.append(equipmentHeading);
  const matrix = document.createElement("div"); matrix.className = "build-inspector-matrix";
  for (const [key, label] of CHARM_SLOTS) {
    const charm = fighter.charms?.[key];
    const row = document.createElement("div"); row.className = "build-inspector-part-row";
    const slot = document.createElement("span"); slot.className = "build-inspector-part-label"; slot.textContent = label;
    const charmInfo = document.createElement("div"); charmInfo.className = "build-inspector-charm";
    if (charm?.imageUrl) { const image = document.createElement("img"); image.src = charm.imageUrl; image.alt = ""; image.addEventListener("error", () => image.remove()); charmInfo.append(image); }
    const charmText = document.createElement("span"); charmText.textContent = charm?.name || (charm?.id ? charm.id : "No charm equipped"); charmText.title = charm?.description || charm?.id || ""; charmInfo.append(charmText);
    row.append(slot, charmInfo); matrix.append(row);
  }
  equipment.append(matrix); body.append(stepper, hero, equipment); drawer.append(header, body);
}

function openBuildInspector(fighters, index, context) {
  if (!fighters?.length) return;
  inspectorState = { fighters, index, context };
  renderBuildInspector();
  document.getElementById("profile-build-inspector-overlay")?.classList.add("is-open");
  document.getElementById("profile-build-inspector")?.classList.add("is-open");
}

function ensureBuildInspector() {
  if (document.getElementById("profile-build-inspector")) return;
  const overlay = document.createElement("div"); overlay.id = "profile-build-inspector-overlay"; overlay.className = "build-inspector-overlay"; overlay.onclick = closeBuildInspector;
  const drawer = document.createElement("aside"); drawer.id = "profile-build-inspector"; drawer.className = "build-inspector"; drawer.setAttribute("aria-label", "Axie build inspector");
  document.body.append(overlay, drawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBuildInspector();
  });
}

function appendCharmSlots(container, charms) {
  const slots = document.createElement("div"); slots.className = "profile-charm-slots"; slots.setAttribute("aria-label", "Equipped charms");
  for (const [key, label, shortLabel] of CHARM_SLOTS) {
    const charm = charms?.[key];
    const charmID = typeof charm?.id === "string" ? charm.id : "";
    const slot = document.createElement("button"); slot.type = "button";
    slot.className = `profile-charm-slot${charmID ? " is-equipped" : ""}${charm?.imageUrl ? " profile-charm-image" : ""}`;
    const detail = charmID ? `${label}: ${charm?.name || charmID}${charm?.description ? `\n${charm.description}` : ""}` : `${label}: no charm equipped`;
    if (charm?.imageUrl) {
      const image = document.createElement("img"); image.className = "profile-charm-art"; image.src = charm.imageUrl; image.alt = "";
      image.addEventListener("load", () => {
        // Every remote charm is rendered inside the same square viewport. This
        // guard records unusual source ratios for QA without special-casing an
        // individual asset; CSS still prevents it from escaping the viewport.
        const ratio = image.naturalWidth / image.naturalHeight;
        slot.classList.toggle("has-unusual-art-ratio", !Number.isFinite(ratio) || ratio < 0.75 || ratio > 1.33);
      });
      image.addEventListener("error", () => { image.remove(); slot.textContent = shortLabel; });
      slot.append(image);
    } else slot.textContent = shortLabel;
    slot.dataset.detail = detail; slot.setAttribute("aria-label", detail); slot.setAttribute("aria-expanded", "false");
    slot.onclick = () => {
      const isVisible = slot.classList.toggle("is-details-visible");
      slot.setAttribute("aria-expanded", String(isVisible));
    };
    slots.append(slot);
  }
  container.append(slots);
}

function appendAxies(container, team, className = "profile-axies", { showCharms = false, inspectorContext = null, linkAxieIDs = false } = {}) {
  const axies = document.createElement("div"); axies.className = className;
  for (const fighter of team?.fighters || []) {
    const axie = document.createElement("div"); axie.className = "profile-axie";
    if (inspectorContext) {
      const inspect = document.createElement("button"); inspect.type = "button"; inspect.className = "profile-axie-inspect";
      const inspectLabel = `Inspect ${fighter.axieID ? `Axie #${fighter.axieID}` : "Axie"} build`;
      inspect.dataset.tooltip = inspectLabel; inspect.setAttribute("aria-label", inspectLabel);
      inspect.onclick = () => openBuildInspector(team.fighters, team.fighters.indexOf(fighter), inspectorContext);
      inspect.append(inspectIcon()); axie.append(inspect);
    }
    const morph = document.createElement("div"); morph.className = "profile-axie-morph";
    // Battle cards are inspector buttons, so only the non-interactive latest
    // team renders the Axie ID as a marketplace link.
    const fighterID = document.createElement(linkAxieIDs && fighter.axieID ? "a" : "span"); fighterID.className = "profile-axie-name";
    if (linkAxieIDs && fighter.axieID) {
      fighterID.classList.add("profile-axie-marketplace-link");
      fighterID.href = `https://app.axieinfinity.com/marketplace/axies/${encodeURIComponent(fighter.axieID)}/`;
      fighterID.target = "_blank"; fighterID.rel = "noopener noreferrer";
      fighterID.title = `View Axie #${fighter.axieID} on the marketplace (opens in a new tab)`;
      fighterID.setAttribute("aria-label", `View Axie #${fighter.axieID} on the Axie Marketplace, opens in a new tab`);
      fighterID.textContent = `#${fighter.axieID} ↗`;
    } else fighterID.textContent = fighter.axieID ? `#${fighter.axieID}` : "Unknown Axie";
    axie.append(morph, fighterID);
    const rune = coerceCompatibleRune(fighter);
    if (rune) {
      const runeLabel = formatRuneBadgeLabel(rune) || rune.id;
      const runeHost = document.createElement(inspectorContext ? "span" : "button"); runeHost.className = "profile-rune-tooltip";
      if (!inspectorContext) {
        runeHost.type = "button"; runeHost.dataset.detail = `Rune: ${runeLabel}`; runeHost.setAttribute("aria-label", `Rune: ${runeLabel}`); runeHost.setAttribute("aria-expanded", "false");
        runeHost.onclick = () => runeHost.setAttribute("aria-expanded", String(runeHost.classList.toggle("is-details-visible")));
      }
      const badge = document.createElement(rune.imageUrl ? "img" : "span");
      badge.className = `profile-rune-badge${rune.imageUrl ? "" : " profile-rune-badge-text"}`;
      badge.setAttribute("aria-label", `Rune: ${runeLabel}`);
      if (rune.imageUrl) { badge.src = rune.imageUrl; badge.alt = ""; badge.addEventListener("error", () => badge.remove()); }
      else badge.textContent = runeLabel.slice(0, 2).toUpperCase();
      runeHost.append(badge); axie.append(runeHost);
    }
    if (showCharms) appendCharmSlots(axie, fighter.charms);
    axies.append(axie);
    const genes = fighter.genes_metamorph || fighter.genes;
    if (genes) renderMorphedAxieCached(morph, genes, { snapshot: true }).catch(() => showAxieVisualUnavailable(morph));
    else showAxieVisualUnavailable(morph);
  }
  if (!team?.fighters?.length) axies.textContent = "Team unavailable";
  container.append(axies);
}

function appendTeam(container, { label, team, inspectorContext, impact, showRating = true }) {
  const section = document.createElement("section"); section.className = `profile-team-card profile-team-card--${label === "You" ? "self" : "opponent"}`;
  const heading = document.createElement("div"); heading.className = "profile-team-label"; heading.textContent = label;
  section.append(heading);
  const axieIDs = (team?.fighters || []).map((fighter) => fighter.axieID ? `Axie #${fighter.axieID}` : "unknown Axie");
  const squad = document.createElement("div"); squad.className = "profile-team-squad"; squad.setAttribute("aria-label", `${label}: ${axieIDs.join(", ") || "team unavailable"}`);
  appendAxies(squad, team, "profile-axies", { inspectorContext }); section.append(squad);
  if (showRating && Number.isFinite(impact?.vstarBefore) && Number.isFinite(impact?.vstarAfter)) {
    appendRatingSummary(section, "", impact, { showDelta: false, variant: "profile-team-rating" });
  }
  container.append(section);
}

function appendBattleLog(container, entry, userID, resolvedPlayerName) {
  const log = document.createElement("article"); log.className = "profile-battle-log-entry";
  const summary = document.createElement("div"); summary.className = "profile-battle-summary";
  const [result, resultClass] = resultCopy(entry.result);
  const main = document.createElement("div"); main.className = "profile-battle-summary-main";
  main.append(createStatusPill(result, resultClass));
  const opponentID = entry.opponent?.userID;
  const opponentRoninAddress = entry.opponent?.roninAddress || null;
  const opponentName = text(entry.opponent?.name, opponentID ? shortenUserID(opponentID) : "Opponent unavailable");
  const playerName = text(entry.player?.name, resolvedPlayerName);
  const deltaChip = createRatingDeltaChip(entry.player?.impact);
  if (deltaChip) main.append(deltaChip);
  const versus = document.createElement("span"); versus.className = "profile-battle-opponent"; versus.append("vs ");
  const opponent = document.createElement(opponentID ? "a" : "span"); opponent.textContent = opponentName;
  if (opponentID) { opponent.href = `/profile/${encodeURIComponent(opponentID)}`; opponent.className = "profile-opponent-link"; }
  if (opponentRoninAddress) {
    opponent.dataset.tooltip = opponentRoninAddress;
    opponent.setAttribute("aria-label", `${opponentName}. Ronin address: ${opponentRoninAddress}`);
  } else {
    opponent.dataset.tooltip = "Opponent Ronin address unavailable";
    opponent.setAttribute("aria-label", `${opponentName}. Ronin address unavailable`);
  }
  versus.append(opponent);
  if (opponentRoninAddress) {
    const copyOpponentAddress = document.createElement("button");
    copyOpponentAddress.type = "button";
    copyOpponentAddress.className = "profile-copy-opponent-ronin profile-copy-icon";
    copyOpponentAddress.append(copyIcon());
    copyOpponentAddress.dataset.tooltip = "Copy ronin address";
    copyOpponentAddress.setAttribute("aria-label", `Copy ${opponentName}'s Ronin address`);
    copyOpponentAddress.onclick = async () => {
      try {
        await navigator.clipboard.writeText(opponentRoninAddress);
        copyOpponentAddress.replaceChildren(copyConfirmationIcon()); copyOpponentAddress.dataset.tooltip = "Copied";
      } catch { copyOpponentAddress.dataset.tooltip = "Copy unavailable"; }
      window.setTimeout(() => { copyOpponentAddress.replaceChildren(copyIcon()); copyOpponentAddress.dataset.tooltip = "Copy ronin address"; }, 1500);
    };
    versus.append(copyOpponentAddress);
  }
  main.append(versus);
  const metadataSeparator = () => { const separator = document.createElement("span"); separator.className = "profile-meta-separator"; separator.setAttribute("aria-hidden", "true"); separator.textContent = "·"; return separator; };
  const modeInfo = gameModeLabel(entry.gameMode);
  if (modeInfo.normalized !== "ranked") {
    main.append(metadataSeparator());
    const mode = document.createElement("span"); mode.className = "profile-battle-mode profile-battle-meta"; mode.textContent = modeInfo.label; main.append(mode);
  }
  main.append(metadataSeparator());
  const context = document.createElement("span"); context.className = "profile-battle-context profile-battle-meta"; context.textContent = formatRelativeTime(entry.timestamp) || formatTimestamp(entry.timestamp); context.dataset.tooltip = formatTimestamp(entry.timestamp); main.append(context);
  const secondaryDetails = [Number.isFinite(entry.durationMs) && entry.durationMs > 0 ? formatDuration(entry.durationMs) : null, entry.turns ? `${entry.turns} turns` : null].filter(Boolean);
  if (secondaryDetails.length) {
    main.append(metadataSeparator());
    const details = document.createElement("span"); details.className = "profile-battle-details profile-battle-meta"; details.textContent = secondaryDetails.join(" · ");
    if (entry.endReason) details.dataset.tooltip = `Battle ended: ${entry.endReason}`;
    main.append(details);
  }
  const detailsToggle = document.createElement("button"); detailsToggle.type = "button"; detailsToggle.className = "profile-battle-details-toggle"; detailsToggle.textContent = "Details"; detailsToggle.setAttribute("aria-expanded", "false"); detailsToggle.onclick = () => { const expanded = log.classList.toggle("is-expanded"); detailsToggle.setAttribute("aria-expanded", String(expanded)); detailsToggle.textContent = expanded ? "Hide details" : "Details"; };
  summary.append(main, detailsToggle);
  const teams = document.createElement("div"); teams.className = "profile-battle-log-teams";
  const isRankedBattle = String(entry.gameMode || "").toLowerCase() === "ranked";
  appendTeam(teams, { label: "You", team: entry.team, inspectorContext: "Your team", impact: entry.player?.impact, showRating: isRankedBattle });
  const teamVersus = document.createElement("div"); teamVersus.className = "profile-battle-versus"; teamVersus.textContent = "VS"; teams.append(teamVersus);
  appendTeam(teams, { label: "Opponent", team: entry.opponent?.team, inspectorContext: "Opponent team", impact: entry.opponent?.impact, showRating: isRankedBattle });
  log.append(summary, teams);
  if (entry.provenance?.source === "historical-snapshot") { const note = document.createElement("p"); note.className = "profile-retention-note"; note.textContent = `Archived evidence: one observed battle, not full history. ${historicalCoverageText(entry.provenance.coverage)}`; log.append(note); }
  container.append(log);
}

export async function renderProfileBattleLogPanel(container, userID, leaderboardScope = null) {
  ensureBuildInspector();
  document.getElementById("profile-latest-team-header")?.replaceChildren();
  document.getElementById("profile-latest-team-copy-header")?.replaceChildren();
  container.replaceChildren(); const loading = document.createElement("p"); loading.className = "profile-loading"; loading.textContent = "Loading latest 20 observed battle logs…"; container.append(loading);
  await loadProfileBattlePage(userID, leaderboardScope); container.replaceChildren();
  const resolvedUserID = profileState.userID || userID;
  const profileHeading = document.getElementById("profile-player-name");
  const profileRoninAddress = document.getElementById("profile-ronin-address");
  const copyRoninButton = document.getElementById("profile-copy-ronin");
  const profileClientID = document.getElementById("profile-client-id");
  const copyClientIDButton = document.getElementById("profile-copy-client-id");
  const resolvedPlayerName = text(profileState.items.find((item) => item?.player?.name)?.player?.name, shortenUserID(resolvedUserID));
  if (profileHeading) { profileHeading.textContent = resolvedPlayerName; profileHeading.dataset.tooltip = resolvedPlayerName; }
  const ownerRoninAddress = profileState.roninAddress;
  if (profileRoninAddress) {
    profileRoninAddress.textContent = ownerRoninAddress ? `Ronin address: ${shortenRoninAddress(ownerRoninAddress)}` : "Ronin address unavailable";
    profileRoninAddress.dataset.tooltip = ownerRoninAddress || "Ronin address unavailable";
    profileRoninAddress.setAttribute("aria-label", ownerRoninAddress ? `Ronin address: ${ownerRoninAddress}` : "Ronin address unavailable");
    profileRoninAddress.setAttribute("tabindex", "0");
  }
  if (copyRoninButton) {
    copyRoninButton.disabled = !ownerRoninAddress;
    copyRoninButton.onclick = async () => {
      if (!ownerRoninAddress) return;
      try { await navigator.clipboard.writeText(ownerRoninAddress); copyRoninButton.replaceChildren(copyConfirmationIcon()); copyRoninButton.dataset.tooltip = "Copied"; }
      catch { copyRoninButton.dataset.tooltip = "Copy unavailable"; }
      window.setTimeout(() => { copyRoninButton.replaceChildren(copyIcon()); copyRoninButton.dataset.tooltip = "Copy ronin address"; }, 1500);
    };
  }
  if (profileClientID) {
    profileClientID.textContent = resolvedUserID ? `Client ID: ${shortenUserID(resolvedUserID)}` : "Client ID unavailable";
    profileClientID.dataset.tooltip = resolvedUserID || "Client ID unavailable";
    profileClientID.setAttribute("aria-label", resolvedUserID ? `Client ID: ${resolvedUserID}` : "Client ID unavailable");
    profileClientID.setAttribute("tabindex", "0");
  }
  if (copyClientIDButton) {
    copyClientIDButton.disabled = !resolvedUserID;
    copyClientIDButton.onclick = async () => {
      if (!resolvedUserID) return;
      try { await navigator.clipboard.writeText(resolvedUserID); copyClientIDButton.replaceChildren(copyConfirmationIcon()); copyClientIDButton.dataset.tooltip = "Copied"; }
      catch { copyClientIDButton.dataset.tooltip = "Copy unavailable"; }
      window.setTimeout(() => { copyClientIDButton.replaceChildren(copyIcon()); copyClientIDButton.dataset.tooltip = "Copy client ID"; }, 1500);
    };
  }
  if (profileState.error) { const error = document.createElement("p"); error.className = "profile-error"; error.textContent = `Could not load battle logs: ${profileState.error}`; container.append(error); return; }
  if (!profileState.items.length) { const empty = document.createElement("p"); empty.className = "profile-empty"; empty.textContent = "No battles were returned for this player."; container.append(empty); return; }
  const latestCopy = document.createElement("div"); latestCopy.className = "profile-latest-team-copy";
  const firstBattle = profileState.items[0];
  const isLatestRanked = String(firstBattle.gameMode || "").toLowerCase() === "ranked";
  const ratingTrend = isLatestRanked ? createRatingTrend(profileState.items) : null;
  const ratingOverview = document.createElement("div"); ratingOverview.className = "profile-rating-overview";
  const { row: nameRow, slot: nameRatingSlot } = ensureNameRatingSlot(profileHeading) || {};
  if (nameRatingSlot) {
    nameRatingSlot.replaceChildren();
    if (isLatestRanked && Number.isFinite(firstBattle.player?.impact?.vstarAfter)) {
      const currentRating = document.createElement("span"); currentRating.className = "profile-current-rating";
      currentRating.append(createVstarBadge({ value: firstBattle.player.impact.vstarAfter, variant: "full" }));
      nameRatingSlot.append(currentRating);
    }
  }
  const recentFormRow = ensureRecentFormRow(nameRow);
  if (recentFormRow) renderRecentForm(recentFormRow, profileState.items);
  if (ratingTrend) {
    const trendChange = document.createElement("span"); trendChange.className = `profile-trend-change${ratingTrend.change >= 0 ? " is-positive" : " is-negative"}`;
    trendChange.textContent = `${ratingTrend.change > 0 ? "+" : ""}${ratingTrend.change}`;
    trendChange.title = `${trendChange.textContent} VSTAR across ${ratingTrend.battles} recent battles`;
    ratingTrend.trend.querySelector("svg")?.before(trendChange);
    ratingOverview.append(ratingTrend.trend);
  }
  latestCopy.append(ratingOverview);
  // The current composition shares the header row with player identity rather
  // than relying on a negative offset from the content section below.
  const latestTeamHeader = document.getElementById("profile-latest-team-header");
  if (latestTeamHeader) {
    const latestHeading = document.createElement("div"); latestHeading.className = "profile-latest-team-heading"; latestHeading.textContent = "Latest ranked team";
    latestTeamHeader.append(latestHeading);
    appendAxies(latestTeamHeader, firstBattle.team, "profile-axies profile-latest-axies", { showCharms: true, linkAxieIDs: true });
  }
  document.getElementById("profile-latest-team-copy-header")?.append(latestCopy);
  const filterState = { result: "all", mode: "all", opponent: "", date: "all" };
  function matchesMode(entry) { return filterState.mode === "all" || String(entry.gameMode || "").toLowerCase() === filterState.mode; }
  function matchesResult(entry) { return filterState.result === "all" || entry.result === filterState.result; }
  function matchesOpponent(entry) {
    if (!filterState.opponent) return true;
    const name = String(entry.opponent?.name || "").toLowerCase();
    return name.includes(filterState.opponent);
  }
  function matchesDateRange(entry) {
    if (filterState.date === "all") return true;
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) return false;
    const now = Date.now();
    if (filterState.date === "today") {
      const battleDate = new Date(timestamp), today = new Date(now);
      return battleDate.getFullYear() === today.getFullYear() && battleDate.getMonth() === today.getMonth() && battleDate.getDate() === today.getDate();
    }
    if (filterState.date === "7d") return now - timestamp <= 7 * 24 * 60 * 60 * 1000;
    return true;
  }
  // "Scoped" = every filter except Result, used for the record chip so it reads as a stable
  // "your record under this search/mode/date scope" reference even while Result narrows the list below.
  function scopedItems() { return profileState.items.filter((entry) => matchesMode(entry) && matchesOpponent(entry) && matchesDateRange(entry)); }

  const filters = document.createElement("div"); filters.className = "profile-battle-filters";
  const filtersRow1 = document.createElement("div"); filtersRow1.className = "profile-battle-filters-row profile-battle-filters-row-1";
  const filtersLeft = document.createElement("div"); filtersLeft.className = "profile-battle-filters-left";
  const historyHeading = document.createElement("div"); historyHeading.className = "profile-battle-history-heading"; historyHeading.textContent = "Battle history";
  const resultCountChip = document.createElement("span"); resultCountChip.className = "profile-result-count-chip";
  filtersLeft.append(historyHeading, resultCountChip);

  const searchWrap = document.createElement("div"); searchWrap.className = "profile-battle-search";
  searchWrap.append(inspectIcon());
  const searchInput = document.createElement("input"); searchInput.type = "text"; searchInput.className = "profile-battle-search-input";
  searchInput.placeholder = "Search opponent…"; searchInput.setAttribute("aria-label", "Search battles by opponent name");
  const searchClear = document.createElement("button"); searchClear.type = "button"; searchClear.className = "profile-battle-search-clear";
  searchClear.textContent = "×"; searchClear.setAttribute("aria-label", "Clear opponent search"); searchClear.hidden = true;
  searchWrap.append(searchInput, searchClear);
  filtersRow1.append(filtersLeft, searchWrap);

  const filtersRow2 = document.createElement("div"); filtersRow2.className = "profile-battle-filters-row profile-battle-filters-right";
  filters.append(filtersRow1, filtersRow2);
  container.append(filters);

  const logs = document.createElement("div"); logs.className = "profile-battle-log-list"; container.append(logs);

  function updateResultCountChip() {
    const scoped = scopedItems();
    const wins = scoped.filter((entry) => entry.result === "win").length;
    const losses = scoped.filter((entry) => entry.result === "loss").length;
    const winsEl = document.createElement("span"); winsEl.className = "profile-result-count-wins"; winsEl.textContent = `${wins}W`;
    const sep = document.createElement("span"); sep.className = "profile-result-count-sep"; sep.setAttribute("aria-hidden", "true"); sep.textContent = "–";
    const lossesEl = document.createElement("span"); lossesEl.className = "profile-result-count-losses"; lossesEl.textContent = `${losses}L`;
    resultCountChip.setAttribute("aria-label", `${wins} wins, ${losses} losses`);
    resultCountChip.replaceChildren(winsEl, sep, lossesEl);
  }

  function renderFilteredLogs() {
    logs.replaceChildren();
    const filtered = scopedItems().filter(matchesResult);
    if (!filtered.length) {
      const empty = document.createElement("p"); empty.className = "profile-empty"; empty.textContent = "No battles match the selected filters.";
      logs.append(empty);
      return;
    }
    for (const entry of filtered) appendBattleLog(logs, entry, resolvedUserID, resolvedPlayerName);
  }

  let searchDebounce = null;
  searchInput.oninput = () => {
    searchClear.hidden = !searchInput.value;
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      filterState.opponent = searchInput.value.trim().toLowerCase();
      updateResultCountChip();
      renderFilteredLogs();
    }, 200);
  };
  searchClear.onclick = () => {
    searchInput.value = ""; searchClear.hidden = true; filterState.opponent = "";
    updateResultCountChip(); renderFilteredLogs(); searchInput.focus();
  };

  const RESULT_FILTER_OPTIONS = [
    { value: "all", label: "All", variant: "neutral" },
    { value: "win", label: "Wins", variant: "win" },
    { value: "loss", label: "Losses", variant: "loss" },
    { value: "draw", label: "Draws", variant: "draw" },
  ];
  const MODE_FILTER_OPTIONS = [
    { value: "all", label: "All" },
    { value: "ranked", label: "Ranked" },
    { value: "challenge", label: "Challenge" },
    { value: "practice", label: "Casual" },
    { value: "haunted", label: "Arcade" },
  ];
  const DATE_FILTER_OPTIONS = [
    { value: "all", label: "All time" },
    { value: "7d", label: "7 days" },
    { value: "today", label: "Today" },
  ];

  function createSegmentedControl(options, groupLabel, defaultVariant, getSelected, onSelect) {
    const group = document.createElement("div"); group.className = "profile-segmented"; group.setAttribute("role", "group"); group.setAttribute("aria-label", groupLabel);
    const buttons = [];
    function refresh() {
      const selected = getSelected();
      for (const button of buttons) {
        const isActive = button.dataset.value === selected;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      }
    }
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "profile-segmented-option";
      button.dataset.value = option.value; button.dataset.variant = option.variant || defaultVariant;
      button.textContent = option.label;
      button.onclick = () => { onSelect(option.value); refresh(); };
      buttons.push(button); group.append(button);
    }
    refresh();
    return group;
  }

  filtersRow2.append(
    createSegmentedControl(RESULT_FILTER_OPTIONS, "Filter by result", "neutral", () => filterState.result, (value) => { filterState.result = value; renderFilteredLogs(); }),
    createSegmentedControl(MODE_FILTER_OPTIONS, "Filter by game mode", "mode", () => filterState.mode, (value) => { filterState.mode = value; updateResultCountChip(); renderFilteredLogs(); }),
    createSegmentedControl(DATE_FILTER_OPTIONS, "Filter by date range", "mode", () => filterState.date, (value) => { filterState.date = value; updateResultCountChip(); renderFilteredLogs(); }),
  );

  updateResultCountChip();
  renderFilteredLogs();

  const pagination = document.createElement("div"); pagination.className = "profile-pagination";
  const loadMore = document.createElement("button"); loadMore.type = "button"; loadMore.className = "profile-load-more";
  const status = document.createElement("span"); status.className = "profile-pagination-status";
  const renderPagination = () => {
    pagination.replaceChildren();
    if (!profileState.pagination?.hasNext) {
      status.textContent = `Showing ${profileState.items.length} battles`;
      pagination.append(status);
      return;
    }
    loadMore.disabled = false;
    loadMore.textContent = "Load more battles";
    status.textContent = `${profileState.items.length} battles loaded`;
    pagination.append(loadMore, status);
  };
  loadMore.onclick = async () => {
    loadMore.disabled = true; loadMore.textContent = "Loading…";
    profileState.error = null;
    await loadMoreProfileBattleLogs(leaderboardScope);
    if (profileState.error) {
      loadMore.disabled = false; loadMore.textContent = "Try again";
      status.textContent = `Could not load more: ${profileState.error}`;
      pagination.replaceChildren(loadMore, status);
      return;
    }
    updateResultCountChip();
    renderFilteredLogs();
    renderPagination();
  };
  renderPagination();
  container.append(pagination);
}