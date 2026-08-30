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

// ===== NEXT RANKED ACTIVITY ESTIMATE (session-based cadence heuristic) =====
//
// Goal: given a player's recent ranked-battle {startedAt, endedAt} pairs,
// estimate when we expect them to start their next ranked battle, based on
// their historical break patterns.
//
// *** What this IS ***
// A recency-weighted average of the PAUSE (idle time) between the player's most
// recent SAME-SESSION ranked battles. Pause = next battle start - previous battle end.
// The most recent pause is weighted 2x over the older one. This is a practical
// heuristic for understanding player behavior patterns during grinding.
//
// *** What this is NOT ***
// - NOT a live-match detection system. We observe completed ranked matches only.
// - NOT session-aware across breaks. A player who pauses for sessionGapThresholdMs+
//   resets to a fresh session on their next battle -- older battles before the pause
//   are deliberately excluded, not averaged in.
// - NOT available outside live mode. recentRankedBattles is only ever populated
//   by the live enrichment pipeline (see leaderboardEnrichment.js server-side).
//
// *** Prediction States (3-phase lifecycle) ***
// - unknown: fewer than 2 same-session, non-surrender battles
// - before_due: prediction time is still in the future
// - expected_game: predicted start has passed, but the expected game window
//   (predictedStart + effectiveMatchDurationMs) has not closed yet
// - overdue: the entire expected game window has elapsed without observing
//   a new completed ranked match
//
// *** Self-correcting behavior ***
// Every live poll re-fetches recentRankedBattles fresh. The moment a new battle
// lands, timestamps change and the prediction recalculates automatically from
// the latest endedAt. No separate staleness check is needed.
//
// *** Session vs. Prediction logic ***
// - RANKED_SESSION_GAP_THRESHOLD_MS (20 min): session boundary. When a pause
//   exceeds this, older battles are excluded from pause averaging.
// - effectiveMatchDurationMs: default 5 min when average data is missing.
//   This prevents "overdue" from triggering immediately when global stats
//   are not yet available.
// - POLLING_STALE_MULTIPLIER (2.5×): data freshness signal, separate from
//   prediction validation.

// Excludes battles under minValidMatchDurationMs (surrenders/early exits)
// from pause calculation entirely, using the same threshold applied server-side
// to the global average. A 60s surrender is not meaningful "break" data.
export function computeAvgPauseMs(recentRankedBattles, sessionGapThresholdMs, minValidMatchDurationMs) {
  if (!Array.isArray(recentRankedBattles) || recentRankedBattles.length === 0) return null;

  const valid = recentRankedBattles
    .map((b) => ({ startMs: Date.parse(b.startedAt), endMs: Date.parse(b.endedAt) }))
    .filter((b) => !Number.isNaN(b.startMs) && !Number.isNaN(b.endMs) && b.endMs > b.startMs)
    .filter((b) => (b.endMs - b.startMs) >= minValidMatchDurationMs) // drop surrenders
    .sort((a, b) => b.endMs - a.endMs); // newest-first, never trust caller ordering

  if (valid.length < 2) return null;

  // Session-trim: walk backward from the newest battle, stop at the first
  // pause >= sessionGapThresholdMs. Battles before that gap belong to a
  // different session and must not feed the pause average.
  const sessionBattles = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const pauseMs = sessionBattles[sessionBattles.length - 1].startMs - valid[i].endMs;
    if (pauseMs >= sessionGapThresholdMs) break;
    sessionBattles.push(valid[i]);
  }

  if (sessionBattles.length < 2) return null;

  const pauseRecent = sessionBattles[0].startMs - sessionBattles[1].endMs;
  if (sessionBattles.length === 2) return pauseRecent > 0 ? pauseRecent : null;

  const pauseOlder = sessionBattles[1].startMs - sessionBattles[2].endMs;
  const weighted = (2 * pauseRecent + pauseOlder) / 3;
  return weighted > 0 ? weighted : null;
}

// Combines the per-player pause average with a default or observed average
// match duration to produce a prediction lifecycle.
//
// avgMatchDurationMs may be null (when not enough global data exists yet);
// in that case, this function uses a sensible DEFAULT_MATCH_DURATION_MS
// rather than treating missing data as "immediate overdue."
//
// States:
// - "unknown": insufficient data for a prediction
// - "before_due": predicted start is in the future
// - "expected_game": predicted start has passed, but the expected game window hasn't closed yet
// - "overdue": the entire expected game window (start + duration) has passed
export function predictNextActivity(recentRankedBattles, avgMatchDurationMs, sessionGapThresholdMs, minValidMatchDurationMs, defaultMatchDurationMs = 5 * 60 * 1000) {
  // The pause estimate is intentionally derived from the player's own recent
  // same-session cadence, not from a global fallback, because the frontend can
  // only make a useful estimate when it sees the player's last few ranked matches.
  const avgPauseMs = computeAvgPauseMs(recentRankedBattles, sessionGapThresholdMs, minValidMatchDurationMs);
  if (avgPauseMs === null) return { state: "unknown" };

  const lastEndedAt = Date.parse(recentRankedBattles[0].endedAt);
  if (Number.isNaN(lastEndedAt)) return { state: "unknown" };

  const predictedStart = lastEndedAt + avgPauseMs;
  // Use actual average duration if available; otherwise use the default.
  // This prevents "overdue" from triggering immediately when duration data is missing.
  const effectiveMatchDurationMs = avgMatchDurationMs ?? defaultMatchDurationMs;
  const predictedEnd = predictedStart + effectiveMatchDurationMs;
  const now = Date.now();

  if (now < predictedStart) return { state: "before_due", predictedStart, predictedEnd };
  if (now < predictedEnd) return { state: "expected_game", predictedStart, predictedEnd };
  return { state: "overdue", predictedStart, predictedEnd };
}

// Renders predictNextActivity()'s result. This is the verbose format used for
// fallback/non-live displays. The compact formatter is used in Live Mode.
export function formatActivityEstimate(result) {
  if (!result || result.state === "unknown") return "Est. next activity: Unknown";

  const now = Date.now();

  if (result.state === "before_due") {
    return `Est. next activity: ~${msToClock(result.predictedStart - now)}`;
  }
  if (result.state === "expected_game") {
    return `Expected game · ${msToClock(now - result.predictedStart)} elapsed`;
  }
  // overdue
  return `Next game overdue · ${msToClock(now - result.predictedEnd)}`;
}

// Compact format for live heuristic validation: prediction state combined
// with "Last played X ago" for single-line status display.
// lastPlayedLabel should be the human-readable format like "57s ago" or "10m ago"
export function formatActivityEstimateCompact(result, lastPlayedLabel = "—") {
  let prediction = "Unknown";

  if (result && result.state !== "unknown") {
    const now = Date.now();

    if (result.state === "before_due") {
      // Prediction is in the future
      const timeUntilPredictedStart = result.predictedStart - now;
      prediction = `Next game ~${msToClock(timeUntilPredictedStart)}`;
    } else if (result.state === "expected_game") {
      // Predicted start has passed, waiting for the game to complete or be observed
      const timeElapsedSincePredictedStart = now - result.predictedStart;
      prediction = `Expected game · ${msToClock(timeElapsedSincePredictedStart)} elapsed`;
    } else if (result.state === "overdue") {
      // Expected game window has fully passed without observing a new completed match
      const timeElapsedSincePredictedEnd = now - result.predictedEnd;
      prediction = `Next game overdue · ${msToClock(timeElapsedSincePredictedEnd)}`;
    }
  } else {
    prediction = "Next game unknown";
  }

  return `${prediction} · Last played ${lastPlayedLabel}`;
}

function msToClock(deltaMs) {
  // Keep the clock representation coarse on purpose: the prediction is a
  // heuristic, not a precise stopwatch, so the UI only needs minute/second
  // resolution and a rough sense of whether the player is due soon or overdue.
  const totalSeconds = Math.floor(Math.abs(deltaMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
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