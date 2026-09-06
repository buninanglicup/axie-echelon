import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { verifySnapshots } from './snapshotVerifier.js';

async function writeJson(p, v) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
}

function makeManifest({ captureId, revision, status = 'completed', scopeKey = 'season:19:milestone:4', seasonId = 19, milestone = 4, eraName = 'Final' } = {}) {
  return {
    schemaVersion: 1,
    scopeKey,
    captureId,
    revision,
    seasonId,
    milestone,
    eraName,
    eraStartedAt: 1,
    eraEndedAt: 2,
    candidateScope: { rankStart: 1, rankEnd: 1000 },
    battleLogSummary: { eraCoverage: 'partial' },
    status
  };
}

test('missing root reports no local snapshots found', async () => {
  const missingRoot = path.join(os.tmpdir(), `axie-snap-missing-${randomUUID()}`);
  const result = await verifySnapshots(missingRoot);
  assert.equal(result.message, 'no local snapshots found');
  assert.equal(result.scopesChecked, 0);
});

test('recognized scope missing index.json is an error', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-missing-index-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  await mkdir(scope, { recursive: true });
  const result = await verifySnapshots(tmp);
  assert.equal(result.scopesChecked, 1);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('missing index.json')));
  await rm(tmp, { recursive: true, force: true });
});

test('existing empty root also reports no local snapshots found', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-empty-'));
  const result = await verifySnapshots(tmp);
  assert.equal(result.message, 'no local snapshots found');
  assert.equal(result.scopesChecked, 0);
  await rm(tmp, { recursive: true, force: true });
});

test('valid published archive with accepted completed capture passes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const captureId = 'cap-1';
  const manifest = makeManifest({ captureId, revision: 1, status: 'completed' });
  await writeJson(path.join(scope, 'captures', captureId, 'manifest.json'), manifest);
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [{ captureId, revision: 1, status: 'completed' }],
    acceptedCaptureId: captureId
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.equal(result.scopesChecked, 1);
  assert.equal(result.capturesChecked, 1);
  assert.equal(result.acceptedCaptures, 1);
  assert.equal(result.errors.length, 0);
  await rm(tmp, { recursive: true, force: true });
});

test('accepted completed staging manifest is rejected', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const captureId = 'cap-stage';
  const manifest = makeManifest({ captureId, revision: 2, status: 'completed' });
  await writeJson(path.join(scope, 'staging', captureId, 'manifest.json'), manifest);
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [{ captureId, revision: 2, status: 'completed' }],
    acceptedCaptureId: captureId
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.equal(result.acceptedCaptures, 0);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('must resolve to a published manifest')));
  await rm(tmp, { recursive: true, force: true });
});

test('manifest captureId mismatch is rejected', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const captureId = 'cap-index';
  const manifest = makeManifest({ captureId: 'cap-actual', revision: 1, status: 'completed' });
  await writeJson(path.join(scope, 'captures', captureId, 'manifest.json'), manifest);
  const index = { schemaVersion: 1, scopeKey: 'season:19:milestone:4', captures: [{ captureId, revision: 1, status: 'completed' }] };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('manifest.captureId')));
  await rm(tmp, { recursive: true, force: true });
});

test('malformed captures and acceptedCaptureId fields are rejected', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const manifest = makeManifest({ captureId: 'cap-valid', revision: 1, status: 'completed' });
  await writeJson(path.join(scope, 'captures', 'cap-valid', 'manifest.json'), manifest);
  const index = { schemaVersion: 1, scopeKey: 'season:19:milestone:4', captures: 'not-an-array', acceptedCaptureId: '' };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('index.captures must be an array')));
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('acceptedCaptureId must be null, undefined, or a non-empty string')));
  await rm(tmp, { recursive: true, force: true });
});

test('index summary revision and status must match manifest', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const captureId = 'cap-rm';
  const manifest = makeManifest({ captureId, revision: 3, status: 'completed' });
  await writeJson(path.join(scope, 'captures', captureId, 'manifest.json'), manifest);
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [{ captureId, revision: 99, status: 'running' }]
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('manifest revision 3 does not match index revision 99')));
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('manifest status completed does not match index status running')));
  await rm(tmp, { recursive: true, force: true });
});

test('duplicate capture IDs and duplicate revisions are rejected', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const captureId = 'cap-dup';
  const manifest = makeManifest({ captureId, revision: 7, status: 'completed' });
  await writeJson(path.join(scope, 'captures', captureId, 'manifest.json'), manifest);
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [
      { captureId, revision: 7, status: 'completed' },
      { captureId, revision: 7, status: 'completed' }
    ]
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('duplicate captureId')));
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('duplicate revision 7')));
  await rm(tmp, { recursive: true, force: true });
});

test('manifest scope mismatch is reported', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const captureId = 'cap-mismatch';
  const manifest = makeManifest({ captureId, revision: 9, status: 'completed', scopeKey: 'season:19:milestone:3', milestone: 3 });
  await writeJson(path.join(scope, 'captures', captureId, 'manifest.json'), manifest);
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [{ captureId, revision: 9, status: 'completed' }]
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('manifest.scopeKey does not match index.scopeKey')));
  assert.ok(result.errors.some((entry) => entry.error && entry.error.includes('manifest milestone mismatch with directory')));
  await rm(tmp, { recursive: true, force: true });
});

// new test: accepted published manifest exists but is absent from index.captures -> fail
test('accepted published manifest absent from index.captures is rejected', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const publishedId = 'pub-only';
  const manifest = makeManifest({ captureId: publishedId, revision: 1, status: 'completed' });
  await writeJson(path.join(scope, 'captures', publishedId, 'manifest.json'), manifest);
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [],
    acceptedCaptureId: publishedId
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((e) => e.error && e.error.includes('acceptedCaptureId must appear exactly once')));
  await rm(tmp, { recursive: true, force: true });
});

// new test: unsafe acceptedCaptureId is rejected without outside lookup
test('unsafe acceptedCaptureId is rejected without outside lookup', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const safeId = 'safe';
  const unsafeId = '../outside';
  await writeJson(path.join(scope, 'captures', safeId, 'manifest.json'), makeManifest({ captureId: safeId, revision: 1, status: 'completed' }));
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [{ captureId: safeId, revision: 1, status: 'completed' }],
    acceptedCaptureId: unsafeId
  };
  await writeJson(path.join(scope, 'index.json'), index);

  const outsideManifest = path.join(tmp, '..', 'outside-manifest.json');
  await writeJson(outsideManifest, { leaked: true });

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((e) => e.capture === unsafeId && e.error && e.error.includes('unsafe acceptedCaptureId')));
  assert.ok(!result.errors.some((e) => e.error && e.error.includes('acceptedCaptureId must resolve to a published manifest')));
  await rm(tmp, { recursive: true, force: true });
  try { await rm(outsideManifest, { force: true }); } catch (e) {}
});

// new test: unsafe captureId is rejected and does not cause outside inspection
test('unsafe captureId is rejected and not inspected outside root', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'axie-snap-'));
  const scope = path.join(tmp, 'season-19-milestone-4');
  const unsafeId = '../outside';
  const index = {
    schemaVersion: 1,
    scopeKey: 'season:19:milestone:4',
    captures: [{ captureId: unsafeId, revision: 1, status: 'completed' }]
  };
  await writeJson(path.join(scope, 'index.json'), index);
  // create a file outside the root that would be read if traversal occurred
  const outsideManifest = path.join(tmp, '..', 'outside-manifest.json');
  await writeJson(outsideManifest, { leaked: true });

  const result = await verifySnapshots(tmp);
  assert.ok(result.errors.some((e) => e.capture === unsafeId && e.error && e.error.includes('unsafe captureId')));
  // ensure we did not attempt to read a manifest by checking that there is no manifest-related error for that capture
  assert.ok(!result.errors.some((e) => e.capture === unsafeId && e.error && e.error.includes('manifest missing')));
  await rm(tmp, { recursive: true, force: true });
  // cleanup outside file
  try { await rm(outsideManifest, { force: true }); } catch (e) {}
});
