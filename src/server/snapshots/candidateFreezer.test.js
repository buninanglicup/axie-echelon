import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SnapshotRepository } from "./snapshotRepository.js";
import { buildSeasonalLeaderboardUrl, freezeSeasonCandidates } from "./candidateFreezer.js";

async function createRepository() {
  return new SnapshotRepository(await mkdtemp(path.join(os.tmpdir(), "axie-candidate-")));
}

function response(items, total = null, status = 200) {
  return new Response(JSON.stringify({
    _items: items,
    ...(total === null ? {} : { _meta: { total } })
  }), { status });
}

function items(startRank, count) {
  return Array.from({ length: count }, (_, index) => ({
    topRank: startRank + index,
    userID: `user-${startRank + index}`,
    name: `Player ${startRank + index}`,
    vstar: 2000 - startRank - index
  }));
}

test("freezes seasonal pages only and records candidate metadata", async () => {
  const repository = await createRepository();
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 4 });
  const requested = [];
  const result = await freezeSeasonCandidates({
    repository,
    manifest,
    rankMax: 150,
    fetchImpl: async (url) => {
      requested.push(new URL(url));
      const target = new URL(url);
      return response(items(Number(target.searchParams.get("offset")) + 1, Number(target.searchParams.get("limit"))), 17);
    },
    apiUrl: "https://example.test",
    apiKey: "test-key"
  });

  assert.equal(requested.length, 2);
  assert.equal(requested[0].pathname, "/origins/v2/season-leaderboards");
  assert.equal(requested[0].searchParams.get("milestone"), "4");
  assert.equal(requested[0].searchParams.get("limit"), "100");
  assert.equal(result.candidateScope.pagesFetched, 2);
  assert.equal(result.candidateScope.frozenCandidateCount, 150);
  assert.equal(result.candidateScope.upstreamReportedTotal, 17);
  assert.equal(result.progress.pendingPlayers, 150);
});

test("resumes after a cancelled page boundary without refetching completed pages", async () => {
  const repository = await createRepository();
  const manifest = await repository.createCapture({ seasonId: 19, milestone: 1 });
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls === 1) {
      controller.abort();
      return response(items(1, 100));
    }
    return response(items(101, 100));
  };

  const cancelled = await freezeSeasonCandidates({
    repository, manifest, rankMax: 200, fetchImpl, apiUrl: "https://example.test", signal: controller.signal
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.candidateScope.pagesFetched, 1);

  const resumed = await freezeSeasonCandidates({
    repository, manifest: cancelled, rankMax: 200, fetchImpl, apiUrl: "https://example.test", signal: new AbortController().signal
  });
  assert.equal(resumed.candidateScope.pagesFetched, 2);
  assert.equal(calls, 2);
});

test("rejects non-season scopes before making an upstream request", async () => {
  const repository = await createRepository();
  const manifest = { seasonId: 19, milestone: 4, scopeKey: "offseason:19" };
  await assert.rejects(
    freezeSeasonCandidates({ repository, manifest, fetchImpl: () => { throw new Error("must not fetch"); } }),
    /seasonal snapshot scope/
  );
});

test("builds the seasonal endpoint with numeric milestone", () => {
  const url = new URL(buildSeasonalLeaderboardUrl({
    apiUrl: "https://example.test", seasonId: 19, milestone: 2, limit: 100, offset: 300
  }));
  assert.equal(url.pathname, "/origins/v2/season-leaderboards");
  assert.equal(url.searchParams.get("milestone"), "2");
  assert.equal(url.searchParams.get("offset"), "300");
});
