import { renderMorphedAxieCached } from "../shared/morphRenderer.js";
import { profileState, loadProfileBattlePage } from "./profileState.js";
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
function shortenUserID(userID) { return userID?.length > 14 ? `${userID.slice(0, 8)}…${userID.slice(-5)}` : text(userID, "Player"); }
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

function appendRatingSummary(container, label, impact, { identity = false, title = "", href = "" } = {}) {
  const summary = document.createElement("div"); summary.className = "profile-rating-summary";
  const heading = label ? document.createElement(href ? "a" : "span") : null;
  if (heading) { heading.className = identity ? "profile-rating-player-name" : "profile-rating-label"; heading.textContent = label; heading.title = title; if (href) { heading.classList.add("profile-opponent-link"); heading.href = href; } }
  const transition = document.createElement("span"); transition.className = "profile-rating-transition";
  const delta = document.createElement("span"); delta.className = "profile-rating-delta";
  if (Number.isFinite(impact?.vstarBefore) && Number.isFinite(impact?.vstarAfter)) {
    transition.textContent = `${impact.vstarBefore} → ${impact.vstarAfter}`;
    delta.append(createVstarBadge({ value: impact.vstarAfter, delta: impact.vstarDelta, variant: "compact" }));
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
  const title = document.createElement("h3"); title.textContent = fighter.axieID ? `Axie #${fighter.axieID}` : "Axie build";
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
  if (genes) renderMorphedAxieCached(morph, genes, { snapshot: true }).catch(() => { morph.textContent = "Axie visual unavailable"; });
  else morph.textContent = "Axie visual unavailable";
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
    const slot = document.createElement(charm?.imageUrl ? "img" : "span");
    slot.className = `profile-charm-slot${charmID ? " is-equipped" : ""}${charm?.imageUrl ? " profile-charm-image" : ""}`;
    if (charm?.imageUrl) {
      slot.src = charm.imageUrl;
      slot.alt = `${label}: ${charm.name || charmID}`;
      slot.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "profile-charm-slot is-equipped";
        fallback.textContent = shortLabel;
        fallback.title = `${label}: ${charm.name || charmID}`;
        slot.replaceWith(fallback);
      });
    } else slot.textContent = shortLabel;
    slot.title = charmID ? `${label}: ${charm?.name || charmID}${charm?.description ? `\n${charm.description}` : ""}` : `${label}: no charm equipped`;
    slot.setAttribute("aria-label", slot.title); slots.append(slot);
  }
  container.append(slots);
}

function appendAxies(container, team, className = "profile-axies", { showCharms = false, inspectorContext = null } = {}) {
  const axies = document.createElement("div"); axies.className = className;
  for (const fighter of team?.fighters || []) {
    const axie = document.createElement(inspectorContext ? "button" : "div"); axie.className = "profile-axie";
    if (inspectorContext) { axie.type = "button"; axie.title = "Inspect Axie build"; axie.onclick = () => openBuildInspector(team.fighters, team.fighters.indexOf(fighter), inspectorContext); }
    const morph = document.createElement("div"); morph.className = "profile-axie-morph";
    const fighterID = document.createElement("span"); fighterID.className = "profile-axie-name"; fighterID.textContent = fighter.axieID ? `#${fighter.axieID}` : "Unknown Axie";
    axie.append(morph, fighterID);
    const rune = coerceCompatibleRune(fighter);
    if (rune) {
      const runeLabel = formatRuneBadgeLabel(rune) || rune.id;
      const badge = document.createElement(rune.imageUrl ? "img" : "span");
      badge.className = `profile-rune-badge${rune.imageUrl ? "" : " profile-rune-badge-text"}`;
      badge.title = `Rune: ${runeLabel}`; badge.setAttribute("aria-label", `Rune: ${runeLabel}`);
      if (rune.imageUrl) { badge.src = rune.imageUrl; badge.alt = `Rune: ${runeLabel}`; badge.addEventListener("error", () => badge.remove()); }
      else badge.textContent = runeLabel.slice(0, 2).toUpperCase();
      axie.append(badge);
    }
    if (showCharms) appendCharmSlots(axie, fighter.charms);
    axies.append(axie);
    const genes = fighter.genes_metamorph || fighter.genes;
    if (genes) renderMorphedAxieCached(morph, genes, { snapshot: true }).catch(() => { morph.textContent = "Axie visual unavailable"; });
    else morph.textContent = "Axie visual unavailable";
  }
  if (!team?.fighters?.length) axies.textContent = "Team unavailable";
  container.append(axies);
}

function appendTeam(container, { team, inspectorContext }) {
  const section = document.createElement("section"); section.className = "profile-team-card";
  appendAxies(section, team, "profile-axies", { inspectorContext });
  container.append(section);
}

function appendParticipantSummary(container, { name, nameTitle = "", href = "", impact }) {
  const participant = document.createElement("div"); participant.className = "profile-team-identity";
  const heading = document.createElement(href ? "a" : "span"); heading.className = "profile-team-name"; heading.textContent = name; heading.title = nameTitle;
  if (href) { heading.href = href; heading.classList.add("profile-opponent-link"); }
  participant.append(heading);
  appendRatingSummary(participant, "", impact);
  container.append(participant);
}

function appendBattleLog(container, entry, userID, resolvedPlayerName) {
  const log = document.createElement("article"); log.className = "profile-battle-log-entry";
  const summary = document.createElement("div"); summary.className = "profile-battle-summary";
  const [result, resultClass] = resultCopy(entry.result);
  const resultItem = document.createElement("span"); resultItem.className = `profile-battle-result ${resultClass}`; resultItem.textContent = result; summary.append(resultItem);
  const context = document.createElement("span"); context.className = "profile-battle-context";
  context.textContent = [formatRelativeTime(entry.timestamp) || formatTimestamp(entry.timestamp), text(entry.gameMode, "Unknown"), formatDuration(entry.durationMs), entry.turns ? `${entry.turns} turns` : null].filter(Boolean).join(" · ");
  context.title = formatTimestamp(entry.timestamp);
  if (entry.endReason) context.title = `Battle ended: ${entry.endReason}`;
  summary.append(context);
  const opponentID = entry.opponent?.userID;
  const opponentName = text(entry.opponent?.name, opponentID ? shortenUserID(opponentID) : "Opponent unavailable");
  const playerName = text(entry.player?.name, resolvedPlayerName);
  const participants = document.createElement("div"); participants.className = "profile-battle-participants";
  appendParticipantSummary(participants, { name: playerName, nameTitle: userID, impact: entry.player?.impact });
  participants.append(summary);
  appendParticipantSummary(participants, { name: opponentName, nameTitle: opponentID || "", href: opponentID ? `/profile/${encodeURIComponent(opponentID)}` : "", impact: entry.opponent?.impact });
  const teams = document.createElement("div"); teams.className = "profile-battle-log-teams";
  appendTeam(teams, { team: entry.team, inspectorContext: "Player team" });
  const versus = document.createElement("div"); versus.className = "profile-battle-versus"; versus.textContent = "VS"; teams.append(versus);
  appendTeam(teams, { team: entry.opponent?.team, inspectorContext: "Opponent team" });
  log.append(participants, teams);
  if (entry.provenance?.source === "historical-snapshot") { const note = document.createElement("p"); note.className = "profile-retention-note"; note.textContent = `Archived evidence: one observed battle, not full history. ${historicalCoverageText(entry.provenance.coverage)}`; log.append(note); }
  container.append(log);
}

export async function renderProfileBattleLogPanel(container, userID, leaderboardScope = null) {
  ensureBuildInspector();
  container.replaceChildren(); const loading = document.createElement("p"); loading.className = "profile-loading"; loading.textContent = "Loading latest 20 observed battle logs…"; container.append(loading);
  await loadProfileBattlePage(userID, leaderboardScope); container.replaceChildren();
  const profileHeading = document.getElementById("profile-player-name");
  const profileID = document.getElementById("profile-player-id");
  const copyIdButton = document.getElementById("profile-copy-id");
  const resolvedPlayerName = text(profileState.items.find((item) => item?.player?.name)?.player?.name, shortenUserID(userID));
  if (profileHeading) { profileHeading.textContent = resolvedPlayerName; profileHeading.title = resolvedPlayerName; }
  if (profileID) { profileID.textContent = userID; profileID.title = userID; }
  if (copyIdButton) {
    copyIdButton.onclick = async () => {
      try { await navigator.clipboard.writeText(userID); copyIdButton.textContent = "Copied"; }
      catch { copyIdButton.textContent = "Copy unavailable"; }
      window.setTimeout(() => { copyIdButton.textContent = "Copy ID"; }, 1500);
    };
  }
  if (profileState.error) { const error = document.createElement("p"); error.className = "profile-error"; error.textContent = `Could not load battle logs: ${profileState.error}`; container.append(error); return; }
  const heading = document.createElement("p"); heading.className = "profile-retention-note";
  const isHistorical = profileState.items[0]?.provenance?.source === "historical-snapshot";
  heading.textContent = isHistorical ? "One ranked battle is available for this era." : `${profileState.items.length} most recent ranked battles`;
  if (profileState.retention?.note) heading.title = profileState.retention.note;
  container.append(heading);
  if (!profileState.items.length) { const empty = document.createElement("p"); empty.className = "profile-empty"; empty.textContent = "No battles were returned for this player."; container.append(empty); return; }
  const latest = document.createElement("section"); latest.className = "profile-latest-team";
  const latestCopy = document.createElement("div"); latestCopy.className = "profile-latest-team-copy";
  const latestHeading = document.createElement("div"); latestHeading.className = "profile-latest-team-heading"; latestHeading.textContent = "Latest ranked team";
  const latestContext = document.createElement("p"); latestContext.className = "profile-latest-team-context";
  const firstBattle = profileState.items[0];
  latestContext.textContent = ["Latest battle", formatRelativeTime(firstBattle.timestamp), resultCopy(firstBattle.result)[0]].filter(Boolean).join(" · ");
  if (Number.isFinite(firstBattle.player?.impact?.vstarAfter)) latestContext.append(" ", createVstarBadge({ value: firstBattle.player.impact.vstarAfter, delta: firstBattle.player.impact.vstarDelta, variant: "full" }));
  latestCopy.append(latestHeading, latestContext); latest.append(latestCopy); appendAxies(latest, firstBattle.team, "profile-axies profile-latest-axies", { showCharms: true }); container.append(latest);
  const historyHeading = document.createElement("div"); historyHeading.className = "profile-battle-history-heading"; historyHeading.textContent = "Battle history"; container.append(historyHeading);
  const logs = document.createElement("div"); logs.className = "profile-battle-log-list"; for (const entry of profileState.items) appendBattleLog(logs, entry, userID, resolvedPlayerName); container.append(logs);
}
