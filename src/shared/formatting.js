// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old main.js,
// no logic changes.

// Format relative time with human-readable labels
// Handles various duration ranges: minutes, hours, and days
// Returns a clear unavailable state for missing/invalid timestamps
export function formatRelativeTime(timestamp) {
  if (!timestamp) return "Played: —";
  const now = Date.now();
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return "Played —";

  const deltaMs = Math.max(0, now - then);
  const totalSeconds = Math.floor(deltaMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours === 0 && totalMinutes < 60) {
    if (totalMinutes === 0) return `Played: ${seconds}secs ago`;
    return `Played: ${totalMinutes}m ${seconds}secs ago`;
  }

  if (hours < 24) {
    return `Played: ${hours}h ${minutes}m ago`;
  }

  // For durations >= 24 hours, show days with proper singularization (1 day vs X days)
  const days = Math.floor(hours / 24);
  if (days === 1) return "Played: yesterday";
  return `Played ${days}d ago`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character]
  );
}
