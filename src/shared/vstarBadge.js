// Reusable VSTAR badge. `progress` is a normalized 0..1 value supplied by a
// rank-threshold source when one is available; it is intentionally optional.
export function createVstarBadge({ value, delta = null, progress = null, variant = "full", deltaDescription = "from the previous battle" } = {}) {
  const badge = document.createElement("span");
  badge.className = `vstar-badge vstar-badge-${variant}`;
  const compactDelta = variant === "compact" && Number.isFinite(delta);
  const icon = document.createElement("span"); icon.className = "vstar-badge-icon"; icon.setAttribute("aria-hidden", "true");
  const valueNode = document.createElement("span"); valueNode.className = "vstar-badge-value";
  valueNode.textContent = compactDelta ? String(Math.abs(delta)) : (Number.isFinite(value) ? String(value) : "—");
  if (variant !== "compact") badge.append(icon, valueNode);
  if (Number.isFinite(delta)) {
    const deltaNode = document.createElement("span"); deltaNode.className = `vstar-badge-delta ${delta >= 0 ? "is-positive" : "is-negative"}`;
    // The explicit sign is a non-colour direction cue. Keep `+0` too so a
    // formatter change cannot silently turn a delta into colour-only meaning.
    deltaNode.textContent = compactDelta ? (delta >= 0 ? "+" : "−") : `${delta >= 0 ? "+" : ""}${delta}`;
    badge.append(deltaNode);
  }
  // Dense battle rows use the explicit, consistent order: + ✦ 20 / − ✦ 20.
  if (variant === "compact") badge.append(icon, valueNode);
  if (variant === "full") {
    const progressTrack = document.createElement("span"); progressTrack.className = "vstar-badge-progress";
    const progressFill = document.createElement("span"); progressFill.className = "vstar-badge-progress-fill";
    if (Number.isFinite(progress)) progressFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    else progressTrack.classList.add("is-unavailable");
    progressTrack.append(progressFill); badge.append(progressTrack);
  }
  const description = compactDelta
    ? `${delta >= 0 ? "+" : "−"} VSTAR ${Math.abs(delta)} ${deltaDescription}`
    : Number.isFinite(delta) ? `VSTAR ${value} (${delta > 0 ? "+" : ""}${delta} ${deltaDescription})` : `VSTAR ${value}`;
  // Compact deltas are self-explanatory inline values; keep their accessible
  // name without adding a redundant hover tooltip.
  badge.setAttribute("aria-label", description);
  return badge;
}
