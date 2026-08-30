# Live Ranked-Activity Prediction Heuristic

## Overview

The Live Mode prediction system estimates when a player will likely start their next ranked battle, based on their historical break patterns between completed matches.

**Key principle:** We observe completed ranked matches only. We do NOT detect live in-progress matches. The system uses historical timing patterns to build expectations about when a player is likely to be grinding.

---

## The Heuristic: How It Works

### Step 1: Extract Recent Battles

The backend (leaderboardEnrichment.js) fetches the player's most recent ranked battles and provides:
- `recentRankedBattles`: array of up to 3 completed battles with `{startedAt, endedAt}`
- Sorted newest → oldest

Example:
```
G1: 8:19:48 PM → 8:23:00 PM (3m 12s duration)
G2: 8:11:32 PM → 8:16:50 PM (5m 18s duration)
G3: 8:07:17 PM → 8:10:17 PM (3m 0s duration)
```

### Step 2: Calculate Pause Times (Breaks Between Games)

For each consecutive pair, calculate the **pause** = time between one game ending and the next starting:

```
Pause between G1 and G2 = G1.startedAt - G2.endedAt
                         = 8:19:48 - 8:16:50
                         = 2m 58s

Pause between G2 and G3 = G2.startedAt - G3.endedAt
                         = 8:11:32 - 8:10:17
                         = 1m 15s
```

**Why not just use the end-to-end gap?**
- End-to-end gap includes the next game's duration as if it were idle time
- Example: G1 end (8:23:00) to G2 end (8:16:50) would be wrong
- Pause = actual break time, which is what players control

### Step 3: Filter Out Surrenders

Battles shorter than 60 seconds are excluded (surrenders, disconnects, practice matches).
- Reason: A 30-second surrender isn't a meaningful "break" signal
- Only real matches (≥60s) feed into the pause average

### Step 4: Session Boundary Check

If any pause between consecutive games ≥ 20 minutes, that marks a **session boundary**.
- Games before the 20-minute gap belong to a different session
- Only the current session's games are averaged

Example:
```
G1: 8:19 PM → 8:23 PM, pause 2m 58s to G2 ✓ same session
G2: 8:11 PM → 8:16 PM, pause 1m 15s to G3 ✓ same session
G3: 8:07 PM → 8:10 PM, pause 4h 20m to G4 ✗ new session
    ↑ This is > 20 min, so G4+ start a fresh session
```

In this case, only G1, G2, G3 are averaged. Older games are ignored.

### Step 5: Calculate Weighted Pause Average

With 2+ games in the current session:
```
avgPauseMs = (2 × mostRecentPause + olderPause) / 3
```

Why the 2× weight?
- The most recent pause is the freshest signal of what the player is currently doing
- Older patterns matter but less so

Example:
```
Pause G1→G2: 2m 58s (most recent, weight 2×)
Pause G2→G3: 1m 15s (older, weight 1×)

avgPauseMs = (2 × 178s + 75s) / 3
           = 431 / 3
           = ~143.7 seconds
           ≈ 2m 24s
```

### Step 6: Predict Next Game Start

```
predictedStart = lastGameEndTime + avgPauseMs
               = 8:23:00 PM + 2m 24s
               = 8:25:24 PM
```

### Step 7: Get Expected Game Duration

Use one of:
1. **Actual average** (from global stats): median of all completed ranked matches
2. **Default**: 5 minutes (if global stats not yet available)

Example:
```
effectiveMatchDurationMs = avgMatchDurationMs ?? DEFAULT_MATCH_DURATION_MS
                         = avgMatchDurationMs ?? (5 * 60 * 1000)
```

### Step 8: Calculate Expected Window End

```
predictedEnd = predictedStart + effectiveMatchDurationMs
             = 8:25:24 PM + 5m
             = 8:30:24 PM
```

This is the boundary for the prediction window.

---

## The State Machine: 3-State Lifecycle

The UI shows exactly 3 states based on the current time relative to the prediction window.

### State A: Before Predicted Start

**Condition:**
```
now < predictedStart
```

**Display:**
```
Next game ~2m 15s
```

**Calculation:**
```
timeUntilNextGame = predictedStart - now
```

**Meaning:**
> "Based on historical patterns, we expect the player to start another game soon. Countdown: 2m 15s."

**Example Timeline:**
```
8:23:00 PM — G1 ends
8:25:24 PM — Predicted start
─────────────────────────
8:24:00 PM (now)
→ Next game ~1m 24s
```

---

### State B: Expected Game (Inside Prediction Window)

**Condition:**
```
predictedStart ≤ now < predictedStart + effectiveMatchDurationMs
```

**Display:**
```
Expected game · 2m 15s elapsed
```

**Calculation:**
```
elapsedSincePrediction = now - predictedStart
```

**Meaning:**
> "The predicted start time has arrived. We are currently within the expected game duration window. We have not yet observed a new completed ranked match."

**Important:** This does NOT mean the player is confirmed to be in a match.
- We have no live-match signal
- This is the observation window: "the time when we expect them to be grinding"

**Example Timeline:**
```
8:23:00 PM — G1 ends, avgPause = 2m 24s
8:25:24 PM — Predicted start (now)
8:30:24 PM — Predicted end (start + 5m)
─────────────────────────────────
8:25:24 PM (now)
→ Expected game · 0m 0s elapsed

8:26:00 PM (now)
→ Expected game · 0m 36s elapsed

8:27:30 PM (now)
→ Expected game · 2m 6s elapsed

8:29:59 PM (now)
→ Expected game · 4m 35s elapsed
```

The timer counts up continuously (not reset per poll), giving a live sense of how long we've been waiting.

---

### State C: Overdue (Prediction Window Closed)

**Condition:**
```
now ≥ predictedStart + effectiveMatchDurationMs
```

**Display:**
```
Next game overdue · 2m 15s
```

**Calculation:**
```
overdueDuration = now - (predictedStart + effectiveMatchDurationMs)
```

**Meaning:**
> "We expected a new completed ranked match to appear by now, but haven't observed one. The predicted start time plus the typical match duration has passed. Either the player stopped grinding, or they're taking a longer break than usual."

**Example Timeline:**
```
8:23:00 PM — G1 ends
8:25:24 PM — Predicted start
8:30:24 PM — Predicted end (now we can say "overdue")
─────────────────────────────────
8:30:24 PM (now)
→ Next game overdue · 0m 0s

8:32:00 PM (now)
→ Next game overdue · 1m 36s

8:37:15 PM (now)
→ Next game overdue · 6m 51s
```

---

### State D: Unknown (No Prediction)

**Condition:**
```
avgPauseMs is null
  OR fewer than 2 valid (≥60s) same-session battles exist
  OR latest game timestamp is invalid
```

**Display:**
```
Next game unknown · Last played 10m ago
```

**Meaning:**
> "We have insufficient historical data to estimate a break pattern. Wait for more battles or better statistics."

---

## Constants & Thresholds

Located in `src/leaderboard/leaderboardState.js`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `MIN_VALID_MATCH_DURATION_MS` | 60s | Minimum match duration to include in pause average (filters surrenders) |
| `RANKED_SESSION_GAP_THRESHOLD_MS` | 20 min | Break time that marks start of a new session |
| `DEFAULT_MATCH_DURATION_MS` | 5 min | Fallback game duration when global average is missing |
| `POLLING_STALE_MULTIPLIER` | 2.5× | Data freshness gate (separate from prediction state) |

---

## Important Distinctions

### Session Logic vs. Prediction Logic

**Session Logic:**
- Answers: "Is this still the same grinding session?"
- Uses: RANKED_SESSION_GAP_THRESHOLD_MS (20 min)
- Purpose: Decide which games to average in pause calculation

**Prediction Logic:**
- Answers: "When should we expect the next completed game?"
- Uses: predictedStart, effectiveMatchDurationMs
- Purpose: Show UI state (before_due → expected_game → overdue)

### Observed vs. Predicted

| Type | Source | Example |
|------|--------|---------|
| **Observed** | Latest completed game | `Last played 57s ago` |
| **Predicted** | Heuristic calculation | `Expected game · 2m 15s elapsed` |

These are calculated independently.

### Data Freshness vs. Prediction State

**Polling Stale Check:**
- If no new data for 2.5× polling interval → show "Polling stale"
- This is about data currency, not prediction validity
- Independent from the 3-state prediction machine

---

## Example Walkthrough

### Scenario: Player "5Pips"

**Observed Games:**
```
G1: 8:19:48 PM → 8:23:00 PM (3m 12s)
G2: 8:11:32 PM → 8:16:50 PM (5m 18s)
G3: 8:07:17 PM → 8:10:17 PM (3m 0s)
```

**Pause Calculation:**
```
Pause G1→G2 = 8:19:48 - 8:16:50 = 2m 58s ✓ (≥60s)
Pause G2→G3 = 8:11:32 - 8:10:17 = 1m 15s ✓ (≥60s)

Session check: 2m 58s < 20 min ✓, 1m 15s < 20 min ✓
→ All games in same session

avgPauseMs = (2 × 178s + 75s) / 3 = 143.7s ≈ 2m 24s
```

**Prediction:**
```
predictedStart = 8:23:00 + 2m 24s = 8:25:24 PM
effectiveMatchDuration = 5m (default, no global stats yet)
predictedEnd = 8:25:24 + 5m = 8:30:24 PM
```

**Display Timeline:**

```
8:24:00 PM (now)
State A: Before predicted start
Display: Next game ~1m 24s · Last played 57s ago

─────────────────

8:25:30 PM (now)
State B: Expected game window
Display: Expected game · 0m 6s elapsed · Last played 2m 30s ago

─────────────────

8:28:00 PM (now)
State B: Still expected game window
Display: Expected game · 2m 36s elapsed · Last played 5m ago

─────────────────

8:30:30 PM (now)
State C: Overdue
Display: Next game overdue · 0m 6s · Last played 7m 30s ago
→ (Prediction window closed; no new game observed)
```

---

## When to Recalculate

The prediction recalculates **every second** on the frontend (during the tick that updates relative times).

**Why automatic recalculation is self-correcting:**

If a new game lands:
- `recentRankedBattles` changes (new G1, old G1 becomes G2, etc.)
- `lastGameEndTime` updates
- `avgPauseMs` recalculates from new data
- `predictedStart` shifts based on new times
- UI state updates automatically

No need for separate "stale detection" — the data update IS the invalidation signal.

---

## Design Rationale

### Why 3 States?

**Before/Expected/Overdue** mirrors human intuition:

1. **Before:** "Waiting for them to start grinding" (future event)
2. **Expected:** "They should be grinding now" (observation window)
3. **Overdue:** "They should have finished by now" (prediction miss)

This gives viewers insight into prediction confidence without claiming to detect live matches.

### Why Not "In Match"?

We have no live-match signal. Showing "In match" would be false confidence.
- We only see completed matches via API
- The "expected_game" state acknowledges: "prediction says it should be happening"
- But we don't claim to know it's actually happening

### Why Default 5 Minutes?

- Typical Axie Infinity ranked match: 3–7 minutes
- 5 minutes is a reasonable middle ground
- Prevents "immediate overdue" when global stats are missing
- Eventually replaced with real data as it accumulates

### Why 20-Minute Session Boundary?

- Detects real breaks (lunch, break, context switch)
- Shorter than "daily activity" (which would be hours)
- Long enough to filter noise (brief AFK moments)
- Players rarely pause 15–20 min intentionally mid-grind

---

## Testing & Validation

To validate this heuristic against actual player behavior:

1. **Watch the "Expected game" timer**
   - If it counts up to 4–5 min regularly without a new game, prediction is accurate
   - If a new game appears within 1–2 min, prediction was conservative (good)

2. **Check "Overdue" states**
   - Do players eventually grind again? → prediction was correct
   - Do they disappear? → prediction was correct (they stopped)

3. **Adjust if needed**
   - If "Expected game" often lasts 10+ min, increase DEFAULT_MATCH_DURATION_MS
   - If session boundary is wrong, adjust RANKED_SESSION_GAP_THRESHOLD_MS

---

## Files Involved

| File | Role |
|------|------|
| `src/shared/formatting.js` | `computeAvgPauseMs()`, `predictNextActivity()`, formatters |
| `src/leaderboard/leaderboardState.js` | Constants (threshold, defaults) |
| `src/leaderboard/leaderboardRenderer.js` | "Last played" calculation, state display |
| `src/server/leaderboard/battleLogClient.js` | Fetch recent battles from backend |
| `src/server/leaderboard/leaderboardEnrichment.js` | Compute global avg match duration |
