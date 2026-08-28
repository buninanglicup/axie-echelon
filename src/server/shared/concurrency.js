// Shared limiter for all battle-log callers. Keeping this at the server
// boundary prevents the leaderboard, rune scanner, and background refreshes
// from multiplying their own independent concurrency limits.
export const BATTLELOG_FETCH_CONCURRENCY = Number(process.env.BATTLELOG_FETCH_CONCURRENCY || 4);

let activeBattleLogRequests = 0;
const highPriorityQueue = [];
const lowPriorityQueue = [];

function drainBattleLogQueue() {
  while (activeBattleLogRequests < BATTLELOG_FETCH_CONCURRENCY) {
    const next = highPriorityQueue.shift() || lowPriorityQueue.shift();
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