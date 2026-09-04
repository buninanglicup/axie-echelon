// Shared limiter for all battle-log callers. Keeping this at the server
// boundary prevents the leaderboard, rune scanner, and background refreshes
// from multiplying their own independent concurrency limits.
export const BATTLELOG_FETCH_CONCURRENCY = Number(process.env.BATTLELOG_FETCH_CONCURRENCY || 4);

// Fairness policy (2026-09-04): high-priority work is still preferred under
// normal load -- if the low-priority queue is empty, or the starvation
// counter below hasn't been hit yet, a free slot always goes to
// high-priority work first, same as before.
//
// The problem this fixes: the previous drain logic was
// `highPriorityQueue.shift() || lowPriorityQueue.shift()`, which always
// drained high-priority first with no fairness bound at all. Under
// sustained high-priority traffic (the high-priority queue never actually
// going empty), a low-priority task could wait forever -- not just be
// delayed, genuinely starved, since the low-priority branch was only ever
// reached when the high-priority queue happened to be empty.
//
// Fix: track how many consecutive slots have gone to high-priority work
// while at least one low-priority task is waiting. Once that count reaches
// LOW_PRIORITY_STARVATION_LIMIT, the next slot is forced to low-priority
// regardless of what's waiting in the high-priority queue, and the counter
// resets. This bounds how long any single low-priority task can be
// delayed by continuous high-priority arrivals to a fixed number of
// concurrency slots, not to queue depth or wall-clock time.
//
// This module has no idea what a "rune scan" is and shouldn't -- it's a
// generic priority semaphore. Any caller of withBattleLogSlot benefits
// from this fix equally.
export const LOW_PRIORITY_STARVATION_LIMIT = Number(process.env.LOW_PRIORITY_STARVATION_LIMIT || 4);

let activeBattleLogRequests = 0;
const highPriorityQueue = [];
const lowPriorityQueue = [];

// Consecutive slots dispatched to high-priority work while a low-priority
// task was waiting. Reset to 0 whenever a low-priority task is dispatched.
// Left to grow while no low-priority task is waiting -- harmless, since it
// only matters relative to the limit above and gets reset the next time it
// does matter.
let consecutiveHighPriorityDispatches = 0;

function takeNextQueuedTask() {
  const shouldForceLowPriority =
    lowPriorityQueue.length > 0 && consecutiveHighPriorityDispatches >= LOW_PRIORITY_STARVATION_LIMIT;

  if (shouldForceLowPriority || highPriorityQueue.length === 0) {
    if (lowPriorityQueue.length > 0) {
      consecutiveHighPriorityDispatches = 0;
      return lowPriorityQueue.shift();
    }
  }

  if (highPriorityQueue.length > 0) {
    consecutiveHighPriorityDispatches += 1;
    return highPriorityQueue.shift();
  }

  return lowPriorityQueue.shift() || null;
}

function drainBattleLogQueue() {
  while (activeBattleLogRequests < BATTLELOG_FETCH_CONCURRENCY) {
    const next = takeNextQueuedTask();
    if (!next) return;
    activeBattleLogRequests += 1;
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeBattleLogRequests -= 1;
        drainBattleLogQueue();
      });
  }
}

export async function mapWithConcurrency(items, worker, concurrency = 4) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export function withBattleLogSlot(task, priority = "high") {
  return new Promise((resolve, reject) => {
    const queue = priority === "low" ? lowPriorityQueue : highPriorityQueue;
    queue.push({ task, resolve, reject });
    drainBattleLogQueue();
  });
}