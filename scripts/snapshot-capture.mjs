import { access, constants, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import "dotenv/config";
import { SnapshotRepository } from "../src/server/snapshots/snapshotRepository.js";
import { freezeSeasonCandidates } from "../src/server/snapshots/candidateFreezer.js";
import { captureArchivalBattleLogs } from "../src/server/snapshots/archivalBattleLogWorker.js";
import { fetchArchivalBattleLogs } from "../src/server/snapshots/archivalBattleLogClient.js";
import { LEADERBOARD_MAX_RANK } from "../src/server/leaderboard/leaderboardConstants.js";
import { requireSnapshotApiKey } from "../src/server/snapshots/snapshotCapturePreflight.js";

const execFileAsync = promisify(execFile);
const RANK_MIN = 1;
const RANK_MAX = LEADERBOARD_MAX_RANK;
const repository = new SnapshotRepository();

function usage() {
  console.error(
    "Usage:\n" +
    "  node scripts/snapshot-capture.mjs start --season 19 --milestone 4 [--dry-run]\n" +
    "  node scripts/snapshot-capture.mjs status --season 19 --milestone 4 --capture <id>\n" +
    "  node scripts/snapshot-capture.mjs resume --season 19 --milestone 4 --capture <id>\n"
  );
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, dryRun: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[key] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const season = Number(options.season);
  const milestone = Number(options.milestone);
  if (!Number.isInteger(season) || season < 1) throw new Error("--season must be a positive integer.");
  if (!Number.isInteger(milestone) || milestone < 1 || milestone > 4) throw new Error("--milestone must be 1, 2, 3, or 4.");
  if (options.command !== "start" && options.command !== "status" && options.command !== "resume") {
    throw new Error(`Unknown command: ${options.command || "(missing command)"}`);
  }
  if ((options.command === "status" || options.command === "resume") && !options.capture) {
    throw new Error(`--capture is required for ${options.command}.`);
  }
  return { ...options, season, milestone };
}

async function preflight() {
  const root = path.resolve("data", "snapshots");
  await execFileAsync("git", ["check-ignore", "--no-index", "-q", "data/snapshots/"]);
  await mkdir(root, { recursive: true });
  await access(root, constants.W_OK);
  return root;
}

function requireCredentials() {
  return requireSnapshotApiKey(process.env.AXIE_ECHELON_API_KEY);
}

function printStatus(manifest) {
  const { candidateScope, progress, battleLogSummary } = manifest;
  console.log(JSON.stringify({
    captureId: manifest.captureId,
    scopeKey: manifest.scopeKey,
    revision: manifest.revision,
    status: manifest.status,
    candidateScope,
    progress,
    battleLogSummary,
    createdAt: manifest.createdAt,
    completedAt: manifest.completedAt,
    cancelledAt: manifest.cancelledAt
  }, null, 2));
}

async function readCapture(options) {
  return repository.readManifest({
    seasonId: options.season,
    milestone: String(options.milestone),
    captureId: options.capture,
    scopeKey: `season:${options.season}:milestone:${options.milestone}`
  });
}

async function dryRun(options) {
  await preflight();
  const apiKey = requireCredentials();
  const controller = new AbortController();
  const apiUrl = process.env.MAVIS_API_URL || "https://api-gateway.skymavis.com";
  const response = await fetch(
    `${apiUrl}/origins/v2/season-leaderboards?limit=1&offset=0&milestone=${options.milestone}`,
    { headers: { "x-api-key": apiKey }, signal: controller.signal }
  );
  if (!response.ok) throw new Error(`Dry-run candidate availability check failed: ${response.status}`);
  const payload = await response.json();
  const available = Array.isArray(payload?._items) ? payload._items.length : 0;
  const probeCandidate = payload?._items?.[0];
  if (!probeCandidate?.userID) throw new Error("Dry-run candidate availability check returned no usable user ID.");
  const battleLogProbe = await fetchArchivalBattleLogs({
    userId: probeCandidate.userID,
    apiUrl,
    apiKey
  });
  console.log(JSON.stringify({
    dryRun: true,
    season: options.season,
    milestone: options.milestone,
    scopeKey: `season:${options.season}:milestone:${options.milestone}`,
    rankRange: `${RANK_MIN}-${RANK_MAX}`,
    firstPageCandidates: available,
    estimatedLeaderboardPages: Math.ceil(RANK_MAX / 100),
    estimatedBattleLogRequests: RANK_MAX,
    battleLogProbe: {
      httpStatus: battleLogProbe.httpStatus,
      requestedLimit: battleLogProbe.requestedLimit,
      battleLogsFetchedCount: battleLogProbe.normalized.battleLogsFetchedCount,
      eraCoverage: battleLogProbe.normalized.eraCoverage
    },
    storesBattleLogs: false
  }, null, 2));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "status") {
    printStatus(await readCapture(options));
    return;
  }
  await preflight();
  const apiKey = requireCredentials();
  if (options.command === "start" && options.dryRun) {
    await dryRun(options);
    return;
  }
  let manifest;
  if (options.command === "start") {
    manifest = await repository.createCapture({
      seasonId: options.season,
      milestone: options.milestone,
      candidateScope: { rankStart: RANK_MIN, rankEnd: RANK_MAX, configuredCeiling: RANK_MAX }
    });
  } else {
    manifest = await readCapture(options);
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    manifest = await freezeSeasonCandidates({ repository, manifest, rankMin: RANK_MIN, rankMax: RANK_MAX, apiKey, signal: controller.signal });
    if (manifest.status === "cancelled" || manifest.status === "failed") {
      printStatus(manifest);
      return;
    }
    manifest = await captureArchivalBattleLogs({ repository, manifest, signal: controller.signal });
    printStatus(manifest);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

run().catch((error) => {
  usage();
  console.error(`Snapshot capture failed: ${error.message}`);
  process.exitCode = 1;
});
