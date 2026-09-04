import assert from "node:assert/strict";
import { test } from "node:test";

import { withBattleLogSlot, BATTLELOG_FETCH_CONCURRENCY, LOW_PRIORITY_STARVATION_LIMIT } from "./concurrency.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("queued low-priority work eventually runs under sustained high-priority arrivals", async () => {
  const totalHighTasks = BATTLELOG_FETCH_CONCURRENCY * 6;
  const lowDeferred = createDeferred();
  const allHighSettled = createDeferred();
  let lowDispatched = false;
  let highSpawnedCount = 0;
  let highCompletedCount = 0;
  let highCompletedBeforeLow = 0;

  function spawnHighPriorityTask() {
    if (highSpawnedCount >= totalHighTasks) return;
    highSpawnedCount += 1;
    withBattleLogSlot(() => {
      if (!lowDispatched) highCompletedBeforeLow += 1;
      spawnHighPriorityTask();
    }, "high").finally(() => {
      highCompletedCount += 1;
      if (highCompletedCount === totalHighTasks) allHighSettled.resolve();
    });
  }

  for (let index = 0; index < BATTLELOG_FETCH_CONCURRENCY; index += 1) spawnHighPriorityTask();

  const lowPromise = withBattleLogSlot(() => {
    lowDispatched = true;
    lowDeferred.resolve();
  }, "low");

  for (let index = 0; index < BATTLELOG_FETCH_CONCURRENCY * 2; index += 1) spawnHighPriorityTask();

  await lowDeferred.promise;
  assert.ok(lowDispatched, "low-priority task should have been dispatched");
  assert.ok(
    highCompletedBeforeLow <= LOW_PRIORITY_STARVATION_LIMIT,
    `expected low-priority work within ${LOW_PRIORITY_STARVATION_LIMIT} high-priority dispatches, ` +
      `but ${highCompletedBeforeLow} completed first`
  );

  await lowPromise;
  await allHighSettled.promise;
});

test("high-priority work is still preferred when no low-priority task is waiting", async () => {
  const dispatchOrder = [];

  await Promise.all([
    withBattleLogSlot(() => dispatchOrder.push("high-1"), "high"),
    withBattleLogSlot(() => dispatchOrder.push("high-2"), "high")
  ]);

  assert.deepEqual(dispatchOrder, ["high-1", "high-2"]);
});