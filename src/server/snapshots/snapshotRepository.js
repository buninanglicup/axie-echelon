import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, open, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SNAPSHOT_MILESTONES = new Set(["1", "2", "3", "4"]);
const SNAPSHOT_STATUSES = new Set(["queued", "running", "partial", "completed", "failed", "cancelled"]);
const SNAPSHOT_COVERAGE = new Set(["complete", "partial", "unknown"]);
const manifestQueues = new Map();

function assertMilestone(milestone) {
  const normalized = String(milestone);
  if (!SNAPSHOT_MILESTONES.has(normalized)) throw new Error("A snapshot requires milestone 1 through 4.");
  return normalized;
}

function assertScopeKey(scopeKey, seasonId, milestone) {
  const expected = `season:${seasonId}:milestone:${milestone}`;
  if (scopeKey !== expected) throw new Error(`Snapshot scopeKey must be ${expected}.`);
}

function sanitizeFailure(failure) {
  return {
    status: Number.isInteger(failure?.status) ? failure.status : null,
    code: typeof failure?.code === "string" ? failure.code.slice(0, 120) : "SNAPSHOT_CAPTURE_FAILED",
    message: typeof failure?.message === "string" ? failure.message.slice(0, 500) : "Snapshot capture failed",
    retryable: Boolean(failure?.retryable)
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Snapshot manifest must be an object.");
  if (typeof manifest.scopeKey !== "string" || !manifest.scopeKey) throw new Error("Snapshot manifest requires scopeKey.");
  if (typeof manifest.captureId !== "string" || !manifest.captureId || /[\\/]/.test(manifest.captureId)) {
    throw new Error("Snapshot manifest requires a safe captureId.");
  }
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) throw new Error("Snapshot manifest requires a positive revision.");
  if (!Number.isInteger(manifest.seasonId) || manifest.seasonId < 1) throw new Error("Snapshot manifest requires a positive seasonId.");
  const milestone = assertMilestone(manifest.milestone);
  assertScopeKey(manifest.scopeKey, manifest.seasonId, milestone);
  if (!SNAPSHOT_STATUSES.has(manifest.status)) throw new Error(`Invalid snapshot status: ${manifest.status}.`);
  if (!SNAPSHOT_COVERAGE.has(manifest.battleLogSummary?.eraCoverage)) throw new Error("Invalid snapshot era coverage.");
  return { ...manifest, milestone };
}

async function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function scopeDirectory(rootDir, seasonId, milestone) {
  return path.join(rootDir, `season-${seasonId}-milestone-${milestone}`);
}

function playerFileId(userId) {
  if (typeof userId !== "string" || !userId) throw new Error("Snapshot records require a user ID.");
  return createHash("sha256").update(userId, "utf8").digest("hex");
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export class SnapshotRepository {
  constructor(rootDir = path.resolve("data", "snapshots"), { lockMaxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
    this.rootDir = rootDir;
    this.lockMaxAgeMs = lockMaxAgeMs;
  }

  getScopeDirectory(manifest) {
    return scopeDirectory(this.rootDir, manifest.seasonId, manifest.milestone);
  }

  async getCaptureDirectory(manifest) {
    const scope = this.getScopeDirectory(manifest);
    const published = path.join(scope, "captures", manifest.captureId);
    if (await exists(published)) return published;
    return path.join(scope, "staging", manifest.captureId);
  }

  async withManifestLock(manifest, operation) {
    const scope = this.getScopeDirectory(manifest);
    await mkdir(scope, { recursive: true });
    const lockPath = path.join(scope, `.${manifest.captureId}.lock`);
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lockAgeMs = Date.now() - (await stat(lockPath)).mtimeMs;
      if (lockAgeMs <= this.lockMaxAgeMs) throw new Error(`Snapshot capture ${manifest.captureId} is already locked.`);
      await rm(lockPath);
      handle = await open(lockPath, "wx");
    }
    try {
      await handle.writeFile(JSON.stringify({ captureId: manifest.captureId, pid: process.pid, startedAt: new Date().toISOString() }));
      return await operation();
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }

  async createCapture(input) {
    const seasonId = Number(input?.seasonId);
    if (!Number.isInteger(seasonId) || seasonId < 1) throw new Error("A snapshot requires a positive seasonId.");
    const milestone = assertMilestone(input?.milestone);
    const scopeKey = input?.scopeKey || `season:${seasonId}:milestone:${milestone}`;
    assertScopeKey(scopeKey, seasonId, milestone);
    const scope = scopeDirectory(this.rootDir, seasonId, milestone);
    const indexPath = path.join(scope, "index.json");
    let existingIndex = null;
    if (await exists(indexPath)) existingIndex = JSON.parse(await readFile(indexPath, "utf8"));
    const priorCaptures = Array.isArray(existingIndex?.captures) ? existingIndex.captures : [];
    const latestCapture = priorCaptures.reduce((latest, capture) =>
      !latest || capture.revision > latest.revision ? capture : latest,
    null);
    const captureId = input?.captureId || `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    const candidateScope = input?.candidateScope || {
      rankStart: 1, rankEnd: 1000, configuredCeiling: 1000,
      upstreamReportedTotal: null, pagesFetched: 0, frozenCandidateCount: 0
    };
    const manifest = validateManifest({
      schemaVersion: 1, scopeKey, captureId,
      revision: Number.isInteger(input?.revision) ? input.revision : (latestCapture?.revision || 0) + 1,
      parentCaptureId: input?.parentCaptureId || latestCapture?.captureId || null,
      seasonId, milestone, eraName: input?.eraName || `Era ${milestone}`,
      eraStartedAt: input?.eraStartedAt ?? null, eraEndedAt: input?.eraEndedAt ?? null,
      candidateScope,
      progress: { pendingPlayers: 0, completedPlayers: 0, failedPlayers: 0, attemptedPlayers: 0 },
      battleLogSummary: {
        battleLogsFetchedCount: 0, rankedBattlesInEraCount: 0,
        oldestBattleReturnedAt: null, newestBattleReturnedAt: null,
        missingTimestampCount: 0, eraCoverage: "unknown"
      },
      status: "queued", capturedAt: null, startedAt: null, completedAt: null,
      cancelledAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    const directory = path.join(this.getScopeDirectory(manifest), "staging", captureId);
    await mkdir(directory, { recursive: true });
    await writeJsonAtomically(path.join(directory, "manifest.json"), manifest);
    await this.updateIndex(manifest);
    return manifest;
  }

  async readManifest(manifest) {
    const directory = await this.getCaptureDirectory(manifest);
    return validateManifest(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")));
  }

  async updateManifest(manifest, changes) {
    const queueKey = `${manifest.scopeKey}:${manifest.captureId}`;
    const previous = manifestQueues.get(queueKey) || Promise.resolve();
    const operation = previous.then(async () => {
      return this.withManifestLock(manifest, async () => {
        const current = await this.readManifest(manifest);
        if (current.status === "completed") throw new Error("Completed snapshots are immutable.");
        const next = validateManifest({ ...current, ...changes, updatedAt: new Date().toISOString() });
        const directory = await this.getCaptureDirectory(current);
        await writeJsonAtomically(path.join(directory, "manifest.json"), next);
        await this.updateIndex(next);
        return next;
      });
    });
    manifestQueues.set(queueKey, operation.catch(() => {}));
    return operation;
  }

  async updateIndex(manifest, accepted = false) {
    const scope = this.getScopeDirectory(manifest);
    const indexPath = path.join(scope, "index.json");
    let index = { schemaVersion: 1, scopeKey: manifest.scopeKey, captures: [], acceptedCaptureId: null };
    if (await exists(indexPath)) index = JSON.parse(await readFile(indexPath, "utf8"));
    const summary = {
      captureId: manifest.captureId, revision: manifest.revision, status: manifest.status,
      createdAt: manifest.createdAt, completedAt: manifest.completedAt || null
    };
    const captures = index.captures.filter((entry) => entry.captureId !== manifest.captureId);
    captures.push(summary);
    index.captures = captures.sort((a, b) => a.revision - b.revision);
    if (accepted) index.acceptedCaptureId = manifest.captureId;
    await writeJsonAtomically(indexPath, index);
  }

  async readIndex(manifest) {
    const indexPath = path.join(this.getScopeDirectory(manifest), "index.json");
    if (!(await exists(indexPath))) return null;
    return JSON.parse(await readFile(indexPath, "utf8"));
  }

  async acceptCapture(manifest) {
    const current = await this.readManifest(manifest);
    if (current.status !== "completed") throw new Error("Only completed captures can be accepted.");
    await this.updateIndex(current, true);
    return current;
  }

  async publishCapture(manifest) {
    const current = await this.readManifest(manifest);
    if (current.status === "completed") return current;
    const staging = path.join(this.getScopeDirectory(current), "staging", current.captureId);
    const published = path.join(this.getScopeDirectory(current), "captures", current.captureId);
    const next = validateManifest({ ...current, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await writeJsonAtomically(path.join(staging, "manifest.json"), next);
    await mkdir(path.dirname(published), { recursive: true });
    await rename(staging, published);
    await this.updateIndex(next);
    return next;
  }

  async writeCandidatePage(manifest, pageNumber, rawPayload, normalizedPayload) {
    const current = await this.readManifest(manifest);
    if (current.status === "completed") throw new Error("Completed snapshots are immutable.");
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error("Candidate page number must be positive.");
    const directory = path.join(await this.getCaptureDirectory(current), "candidate-pages");
    const prefix = String(pageNumber).padStart(4, "0");
    const rawPath = path.join(directory, `${prefix}.raw.json`);
    if (await exists(rawPath)) throw new Error(`Candidate page ${pageNumber} is already written.`);
    await writeJsonAtomically(rawPath, rawPayload);
    await writeJsonAtomically(path.join(directory, `${prefix}.normalized.json`), normalizedPayload);
  }

  async writeBattleLog(manifest, userId, record) {
    const current = await this.readManifest(manifest);
    if (current.status === "completed") throw new Error("Completed snapshots are immutable.");
    const id = playerFileId(userId);
    const directory = path.join(await this.getCaptureDirectory(current), "battle-logs");
    const rawPath = path.join(directory, `${id}.raw.json`);
    const normalizedPath = path.join(directory, `${id}.normalized.json`);
    if (await exists(rawPath) || await exists(normalizedPath)) throw new Error(`Battle-log record for ${userId} is already written.`);
    const rawResponse = record?.rawResponse ?? null;
    const checksum = record?.checksum || createHash("sha256").update(JSON.stringify(rawResponse), "utf8").digest("hex");
    const capturedAt = record?.capturedAt || new Date().toISOString();
    try {
      // The raw record is the completion marker. Write the normalized view
      // first so a raw record always has its matching application-facing view.
      await writeJsonAtomically(normalizedPath, {
        userID: userId,
        capturedAt,
        ...(record?.normalized || {})
      });
      await writeJsonAtomically(rawPath, { userID: userId, checksum, capturedAt, status: record?.status || "fetched", httpStatus: record?.httpStatus ?? null, requestedLimit: record?.requestedLimit ?? 20, rawResponse });
    } catch (error) {
      if (!(await exists(rawPath))) await rm(normalizedPath, { force: true });
      throw error;
    }
  }

  async writeFailure(manifest, userId, failure, attempt = 1) {
    const current = await this.readManifest(manifest);
    if (current.status === "completed") throw new Error("Completed snapshots are immutable.");
    const id = playerFileId(userId);
    const directory = path.join(await this.getCaptureDirectory(current), "failures");
    await writeJsonAtomically(path.join(directory, `${id}-attempt-${String(attempt).padStart(3, "0")}.json`), { userID: userId, capturedAt: new Date().toISOString(), failure: sanitizeFailure(failure) });
  }

  async listStagingCaptures(seasonId, milestone) {
    const directory = path.join(scopeDirectory(this.rootDir, seasonId, assertMilestone(milestone)), "staging");
    if (!(await exists(directory))) return [];
    return (await readdir(directory)).filter((entry) => entry !== ".");
  }

  async readFrozenCandidates(manifest) {
    const current = await this.readManifest(manifest);
    const directory = path.join(await this.getCaptureDirectory(current), "candidate-pages");
    const candidates = [];
    for (let page = 1; page <= current.candidateScope.pagesFetched; page += 1) {
      const filePath = path.join(directory, `${String(page).padStart(4, "0")}.normalized.json`);
      const pageCandidates = JSON.parse(await readFile(filePath, "utf8"));
      if (!Array.isArray(pageCandidates)) throw new Error(`Candidate page ${page} is not normalized as an array.`);
      candidates.push(...pageCandidates);
    }
    return candidates.slice(0, current.candidateScope.rankEnd - current.candidateScope.rankStart + 1);
  }

  async hasBattleLog(manifest, userId) {
    const current = await this.readManifest(manifest);
    const directory = path.join(await this.getCaptureDirectory(current), "battle-logs");
    const id = playerFileId(userId);
    return (await exists(path.join(directory, `${id}.raw.json`))) &&
      (await exists(path.join(directory, `${id}.normalized.json`)));
  }

  async hasFailure(manifest, userId) {
    const current = await this.readManifest(manifest);
    const directory = path.join(await this.getCaptureDirectory(current), "failures");
    if (!(await exists(directory))) return false;
    const prefix = `${playerFileId(userId)}-attempt-`;
    return (await readdir(directory)).some((entry) => entry.startsWith(prefix) && entry.endsWith(".json"));
  }
}

export { SNAPSHOT_MILESTONES, SNAPSHOT_STATUSES, playerFileId, sanitizeFailure, validateManifest };
