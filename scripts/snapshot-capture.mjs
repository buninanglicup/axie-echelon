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
import { runSnapshotCaptureDryRun } from "../src/server/snapshots/snapshotCaptureDryRun.js";
import { reclassifySnapshot } from "../src/server/snapshots/snapshotReclassifier.js";
import { LEADERBOARD_MAX_RANK } from "../src/server/leaderboard/leaderboardConstants.js";
import { requireSnapshotApiKey } from "../src/server/snapshots/snapshotCapturePreflight.js";
import { getConfiguredEraWindow } from "../src/eraResolver.js";

const execFileAsync = promisify(execFile);
const RANK_MIN = 1;
const RANK_MAX = LEADERBOARD_MAX_RANK;
const repository = new SnapshotRepository();

function usage() {
  console.error(
    "Usage:\n" +
    "  node scripts/snapshot-capture.mjs start --season 19 --milestone 4 [--dry-run] [--candidates-only]\n" +
    "  node scripts/snapshot-capture.mjs status --season 19 --milestone 4 --capture <id>\n" +
    "  node scripts/snapshot-capture.mjs resume --season 19 --milestone 4 --capture <id>\n" +
    "  node scripts/snapshot-capture.mjs accept --season 19 --milestone 4 --capture <id>\n" +
    "  node scripts/snapshot-capture.mjs reclassify --season 19 --milestone 4 --capture <id>\n"
  );
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, dryRun: false, candidatesOnly: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--candidates-only") options.candidatesOnly = true;
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
  if (!new Set(["start", "status", "resume", "accept", "reclassify"]).has(options.command)) {
    throw new Error(`Unknown command: ${options.command || "(missing command)"}`);
  }
  if ((options.command === "status" || options.command === "resume" || options.command === "accept" || options.command === "reclassify") && !options.capture) {
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

function printStatus(manifest, index = null) {
  const { candidateScope, progress, battleLogSummary } = manifest;
  console.log(JSON.stringify({
    captureId: manifest.captureId,
    scopeKey: manifest.scopeKey,
    revision: manifest.revision,
    accepted: index?.acceptedCaptureId === manifest.captureId,
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

function getConfiguredWindow(options) {
  const eraWindow = getConfiguredEraWindow(options.milestone);
  if (eraWindow.seasonId !== options.season) {
    throw new Error(`Configured season ${eraWindow.seasonId} does not match --season ${options.season}.`);
  }
  return eraWindow;
}

async function dryRun(options) {
  await preflight();
  const apiKey = requireCredentials();
  const eraWindow = getConfiguredWindow(options);
  const apiUrl = process.env.MAVIS_API_URL || "https://api-gateway.skymavis.com";
  const dryRunReport = await runSnapshotCaptureDryRun({
    options, apiKey, apiUrl, eraWindow, fetchImpl: fetch, battleLogProbe: fetchArchivalBattleLogs
  });
  console.log(JSON.stringify(dryRunReport, null, 2));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "status") {
    const manifest = await readCapture(options);
    printStatus(manifest, await repository.readIndex(manifest));
    return;
  }
  if (options.command === "accept") {
    await preflight();
    const manifest = await repository.acceptCapture(await readCapture(options));
    printStatus(manifest, await repository.readIndex(manifest));
    return;
  }
  if (options.command === "reclassify") {
    await preflight();
    const sourceManifest = await readCapture(options);
    const eraWindow = getConfiguredWindow(options);
    const manifest = await reclassifySnapshot({ repository, sourceManifest, eraWindow });
    printStatus(manifest, await repository.readIndex(manifest));
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
    const eraWindow = getConfiguredWindow(options);
    // Reject --candidates-only if an accepted capture already exists
    if (options.candidatesOnly) {
      const ref = { seasonId: options.season, milestone: String(options.milestone), scopeKey: `season:${options.season}:milestone:${options.milestone}` };
      const index = await repository.readIndex(ref);
      if (index?.acceptedCaptureId) {
        throw new Error(`Cannot start --candidates-only capture: an accepted capture already exists (${index.acceptedCaptureId}). Historical snapshots are immutable; explicit replacement is not yet implemented.`);
      }
    }
    manifest = await repository.createCapture({
      seasonId: options.season,
      milestone: options.milestone,
      eraName: eraWindow.eraName,
      eraStartedAt: eraWindow.eraStartedAt,
      eraEndedAt: eraWindow.eraEndedAt,
      hasTeamEvidence: !options.candidatesOnly,
      candidateScope: { rankStart: RANK_MIN, rankEnd: RANK_MAX, configuredCeiling: RANK_MAX }
    });
  } else {
    manifest = await readCapture(options);
  }
  // Recover a completed capture whose staging-to-captures rename was blocked
  // by a transient filesystem lock, without trying to mutate its evidence.
  if (options.command === "resume" && manifest.status === "completed") {
    manifest = await repository.publishCapture(manifest);
    printStatus(manifest, await repository.readIndex(manifest));
    return;
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
    // Skip battle-log capture in candidates-only mode and publish directly
    if (manifest.hasTeamEvidence !== false) {
      manifest = await captureArchivalBattleLogs({ repository, manifest, signal: controller.signal });
    } else {
      manifest = await repository.publishCapture(manifest);
      console.log(JSON.stringify({ message: "Candidates-only snapshot published (no team evidence); requires explicit manual acceptance" }, null, 2));
    }
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
