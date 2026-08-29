// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old main.js,
// no logic changes.

// Format relative time with human-readable labels.
// Handles various duration ranges: minutes, hours, and days.
// When live polling fails, the caller can opt into an explicit status message
// instead of the generic "no data" placeholder.
export function formatRelativeTime(timestamp, options = {}) {
  const {
    unavailableLabel = "Played: —",
    failedLabel = "Can't fetch last battle"
  } = options;

  if (!timestamp) {
    return unavailableLabel;
  }

  const now = Date.now();
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) {
    return failedLabel;
  }

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
// ===== NEXT RANKED ACTIVITY ESTIMATE (session-based cadence heuristic) =====
//
// Goal: given a player's recent ranked-battle end-timestamps, estimate
// roughly when they're likely to be in a ranked battle again -- so a
// viewer can time their own play around active/grinding players.
//
// *** What this IS ***
// A simple recency-weighted average of the gaps between the player's most
// recent SAME-SESSION ranked battles (see RANKED_SESSION_GAP_THRESHOLD_MS
// in leaderboard/leaderboardState.js for the session cutoff). The most
// recent gap is weighted 2x over the older one. This is a heuristic for
// spotting "is this player mid-grind right now," not a statistical model.
//
// *** What this is NOT ***
// - NOT a start-time prediction. extractBattleTimestamp() in
//   battleLogClient.js pulls from endedAt/createdAt-style fields, so these
//   are battle END times. The estimate is best read as "next ranked
//   ACTIVITY," not "next match starts at."
// - NOT session-aware across a break. A player who pauses for 20+ minutes
//   resets to a fresh session on their next battle -- old battles before
//   the pause are deliberately excluded, not averaged in.
// - NOT available outside live mode. recentRankedBattleTimes is only ever
//   populated by the live-mode branch of leaderboardEnrichment.js; the
//   feature is intentionally invisible when live mode is off.
//
// *** Output states (see formatNextActivityEstimate below) ***
// - Unknown: fewer than 2 same-session timestamps (0 or 1 recent ranked
//   battle). Not enough data for a gap -- shown honestly rather than guessed.
// - Countdown: predicted time is still in the future.
// - Overdue: predicted time has passed; the "overdue by" duration keeps
//   growing, which doubles as a soft signal that the player's session may
//   have ended (a manual grace period is left to the viewer's judgment).

export function estimateNextRankedActivity(recentRankedBattleTimes, sessionGapThresholdMs) {
  if (!Array.isArray(recentRankedBattleTimes) || recentRankedBattleTimes.length === 0) return null;

  // Never trust API ordering or exact duplicates -- normalize first.
  const parsedTimes = [...new Set(recentRankedBattleTimes)]
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a); // newest first

  if (parsedTimes.length < 2) return null;

  // Trim to the current session: walk backward from the newest battle,
  // stop at the first gap >= sessionGapThresholdMs. Anything before that
  // gap belongs to a different session and must not feed the estimate.
  const sessionTimes = [parsedTimes[0]];
  for (let i = 1; i < parsedTimes.length; i++) {
    const gapMs = sessionTimes[sessionTimes.length - 1] - parsedTimes[i];
    if (gapMs >= sessionGapThresholdMs) break;
    sessionTimes.push(parsedTimes[i]);
  }

  if (sessionTimes.length < 2) return null; // only 1 battle survived trimming

  const mostRecentEnd = sessionTimes[0];
  const recentGapMs = sessionTimes[0] - sessionTimes[1];
  const weightedGapMs = sessionTimes.length === 2
    ? recentGapMs
    : (2 * recentGapMs + (sessionTimes[1] - sessionTimes[2])) / 3;

  if (!Number.isFinite(weightedGapMs) || weightedGapMs <= 0) return null;
  return mostRecentEnd + weightedGapMs;
}

// Renders estimateNextRankedActivity()'s output as one of two states --
// see the header comment above for why there's no third "any moment now"
// state: the raw overdue duration is more useful to the viewer as-is.
export function formatNextActivityEstimate(predictedTimestampMs) {
  if (predictedTimestampMs === null || predictedTimestampMs === undefined) {
    return "Est. next activity: Unknown";
  }
  const deltaMs = predictedTimestampMs - Date.now();
  const totalSeconds = Math.floor(Math.abs(deltaMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return deltaMs >= 0
    ? `Est. next activity: ~${minutes}m ${seconds}s`
    : `Overdue by ${minutes}m ${seconds}s`;
}