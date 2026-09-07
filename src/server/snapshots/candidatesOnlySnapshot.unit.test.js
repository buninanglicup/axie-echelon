import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SnapshotRepository } from './snapshotRepository.js';
import { getHistoricalSnapshotCandidates, getHistoricalSnapshotEnrichment } from './snapshotReader.js';
import { scanHistoricalSnapshotForRunes, scanHistoricalSnapshotForBodyParts } from './historicalSnapshotScanner.js';
import { runSnapshotCaptureDryRun } from './snapshotCaptureDryRun.js';

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'axie-candidates-only-'));
}

test('manifest preserves hasTeamEvidence default (backward compatibility)', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    const manifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString()
      // Omit hasTeamEvidence entirely to test backward compatibility
    });
    // When omitted, hasTeamEvidence should default to true
    assert.notEqual(manifest.hasTeamEvidence, false, 'Should default to true when omitted');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('manifest stores hasTeamEvidence false for candidates-only', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    const manifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString(),
      hasTeamEvidence: false
    });
    assert.equal(manifest.hasTeamEvidence, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('candidate-only snapshot reader returns hasTeamEvidence metadata', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    const manifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: 1,
      eraEndedAt: 2,
      hasTeamEvidence: false
    });
    await repository.writeCandidatePage(manifest, 1, { _items: [{ userID: 'test-user', topRank: 1 }] }, [{ userID: 'test-user', rank: 1 }]);
    const updated = await repository.updateManifest(manifest, {
      candidateScope: { ...manifest.candidateScope, pagesFetched: 1, frozenCandidateCount: 1 }
    });
    const published = await repository.publishCapture(updated);
    await repository.acceptCapture(published);
    const result = await getHistoricalSnapshotCandidates({
      repository,
      leaderboardScope: { seasonId: 19, milestone: 4 }
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.snapshot.hasTeamEvidence, false);
    assert.equal(result.snapshot.captureId, published.captureId);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('team enrichment fails with unavailable status for candidate-only snapshot', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    // Create a candidate-only capture
    const manifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString(),
      hasTeamEvidence: false
    });
    // Publish and accept it
    const updated = await repository.updateManifest(manifest, { status: 'completed' });
    const published = await repository.publishCapture(updated);
    await repository.acceptCapture(published);
    // Now try to get team enrichment
    const result = await getHistoricalSnapshotEnrichment({
      repository,
      leaderboardScope: { seasonId: 19, milestone: 4 },
      userID: 'test-user'
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.snapshot.hasTeamEvidence, false);
    assert.equal(result.snapshot.captureId, published.captureId);
    assert.ok(result.error.includes('team evidence is not available'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('rune scan rejects with typed error for candidate-only snapshot', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    const manifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString(),
      hasTeamEvidence: false
    });
    const updated = await repository.updateManifest(manifest, { status: 'completed' });
    const published = await repository.publishCapture(updated);
    await repository.acceptCapture(published);
    // Try to scan for runes
    let thrownError = null;
    try {
      await scanHistoricalSnapshotForRunes(['test-rune'], { seasonId: 19, milestone: 4 }, { repository });
    } catch (error) {
      thrownError = error;
    }
    assert.ok(thrownError, 'Should throw an error');
    assert.equal(thrownError.code, 'HISTORICAL_TEAM_EVIDENCE_UNAVAILABLE');
    assert.ok(thrownError.message.includes('team evidence is not available'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('body-part scan rejects with typed error for candidate-only snapshot', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    const manifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString(),
      hasTeamEvidence: false
    });
    const updated = await repository.updateManifest(manifest, { status: 'completed' });
    const published = await repository.publishCapture(updated);
    await repository.acceptCapture(published);
    // Try to scan for body parts
    let thrownError = null;
    try {
      await scanHistoricalSnapshotForBodyParts(['Ant'], { seasonId: 19, milestone: 4 }, { repository });
    } catch (error) {
      thrownError = error;
    }
    assert.ok(thrownError, 'Should throw an error');
    assert.equal(thrownError.code, 'HISTORICAL_TEAM_EVIDENCE_UNAVAILABLE');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('candidate-only capture cannot be accepted if full-evidence capture exists', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    // Create and accept a full-evidence capture
    const fullManifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString(),
      hasTeamEvidence: true
    });
    const fullUpdated = await repository.updateManifest(fullManifest, { status: 'completed' });
    const fullPublished = await repository.publishCapture(fullUpdated);
    await repository.acceptCapture(fullPublished);
    // Now try to create and accept a candidate-only capture
    const candManifest = await repository.createCapture({
      seasonId: 19,
      milestone: '4',
      eraName: 'Era 4',
      eraStartedAt: new Date(2026, 8, 1).toISOString(),
      eraEndedAt: new Date(2026, 9, 1).toISOString(),
      hasTeamEvidence: false
    });
    const candUpdated = await repository.updateManifest(candManifest, { status: 'completed' });
    const candPublished = await repository.publishCapture(candUpdated);
    // This should throw
    let thrownError = null;
    try {
      await repository.acceptCapture(candPublished);
    } catch (error) {
      thrownError = error;
    }
    assert.ok(thrownError, 'Should throw when accepting candidate-only with existing full capture');
    assert.ok(thrownError.message.includes('Cannot accept candidate-only'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('a full-evidence superseding revision can replace an accepted capture', async () => {
  const tempDir = await createTempDir();
  const repository = new SnapshotRepository(tempDir);
  try {
    const candidate = await repository.publishCapture(await repository.createCapture({
      seasonId: 19, milestone: '4', hasTeamEvidence: false
    }));
    await repository.acceptCapture(candidate);
    const full = await repository.publishCapture(await repository.createCapture({
      seasonId: 19, milestone: '4', hasTeamEvidence: true
    }));
    await repository.acceptCapture(full);

    const index = await repository.readIndex(full);
    assert.equal(full.revision, candidate.revision + 1);
    assert.equal(index.acceptedCaptureId, full.captureId);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('candidate-only dry-run fetches the seasonal endpoint once and never probes battle logs', async () => {
  const calls = [];
  let battleLogProbeCalls = 0;
  const report = await runSnapshotCaptureDryRun({
    options: { season: 19, milestone: 4, candidatesOnly: true },
    apiKey: 'synthetic-key',
    apiUrl: 'https://snapshot.test',
    eraWindow: { eraStartedAt: 1, eraEndedAt: 2 },
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ _items: [{ userID: 'candidate-1' }] }), { status: 200 });
    },
    battleLogProbe: async () => {
      battleLogProbeCalls += 1;
      throw new Error('candidate-only dry-run must not call the battle-log probe');
    }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/origins\/v2\/season-leaderboards\?/);
  assert.equal(calls.some((url) => new URL(url).pathname.includes('battle-logs')), false);
  assert.equal(battleLogProbeCalls, 0);
  assert.equal(report.estimatedBattleLogRequests, 0);
  assert.deepEqual(report.battleLogProbe, { skipped: 'candidates-only mode' });
});

test('candidate-only acceptance cannot replace a full-evidence acceptance during an interleaving', async () => {
  const tempDir = await createTempDir();
  const fullRepository = new SnapshotRepository(tempDir);
  const candidateRepository = new SnapshotRepository(tempDir);
  try {
    const full = await fullRepository.publishCapture(await fullRepository.createCapture({
      seasonId: 19, milestone: '4', hasTeamEvidence: true
    }));
    const candidate = await candidateRepository.publishCapture(await candidateRepository.createCapture({
      seasonId: 19, milestone: '4', hasTeamEvidence: false
    }));

    const originalUpdateIndex = fullRepository.updateIndex.bind(fullRepository);
    const originalReadIndex = candidateRepository.readIndex.bind(candidateRepository);
    let candidateIndexReads = 0;
    candidateRepository.readIndex = async (manifest) => {
      candidateIndexReads += 1;
      return originalReadIndex(manifest);
    };
    let indexWriteStarted;
    const indexWritePaused = new Promise((resolve) => { indexWriteStarted = resolve; });
    let releaseIndexWrite;
    const continueIndexWrite = new Promise((resolve) => { releaseIndexWrite = resolve; });
    fullRepository.updateIndex = async (manifest, accepted) => {
      if (accepted && manifest.captureId === full.captureId) {
        indexWriteStarted();
        await continueIndexWrite;
      }
      return originalUpdateIndex(manifest, accepted);
    };

    const acceptingFull = fullRepository.acceptCapture(full);
    await indexWritePaused;
    await assert.rejects(
      () => candidateRepository.acceptCapture(candidate),
      (error) => error.code === 'SNAPSHOT_SCOPE_LOCKED'
    );
    // The candidate process could not even read a stale acceptedCaptureId
    // while the full-evidence process owned the scope-level transaction.
    assert.equal(candidateIndexReads, 0);
    releaseIndexWrite();
    await acceptingFull;

    await assert.rejects(
      () => candidateRepository.acceptCapture(candidate),
      /Cannot accept candidate-only/
    );
    assert.equal((await candidateRepository.readIndex(candidate)).acceptedCaptureId, full.captureId);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

