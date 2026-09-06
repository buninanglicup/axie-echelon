import fs from 'node:fs/promises';
import path from 'node:path';
import { validateManifest } from './snapshotRepository.js';

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonSafe(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

function isValidRevision(value) {
  return Number.isInteger(value) && value > 0;
}

export async function verifySnapshots(rootDir = path.resolve('data', 'snapshots')) {
  const summary = {
    root: rootDir,
    scopesChecked: 0,
    capturesChecked: 0,
    acceptedCaptures: 0,
    warnings: [],
    errors: []
  };

  if (!(await exists(rootDir))) {
    return { ...summary, message: 'no local snapshots found' };
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const validScopeDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (/^season-\d+-milestone-\d+$/.test(entry.name)) validScopeDirs.push(entry.name);
  }

  if (validScopeDirs.length === 0) {
    return { ...summary, message: 'no local snapshots found' };
  }

  for (const scopeName of validScopeDirs) {
    const scopePath = path.join(rootDir, scopeName);
    summary.scopesChecked += 1;
    const match = scopeName.match(/^season-(\d+)-milestone-(\d+)$/);
    const seasonId = match ? Number(match[1]) : null;
    const milestone = match ? String(match[2]) : null;
    const expectedScopeKey = match ? `season:${seasonId}:milestone:${milestone}` : null;

    const indexPath = path.join(scopePath, 'index.json');
    if (!(await exists(indexPath))) {
      summary.errors.push({ scope: scopeName, error: 'missing index.json in recognized scope directory' });
      continue;
    }

    let index;
    try {
      index = await readJsonSafe(indexPath);
    } catch (error) {
      summary.errors.push({ scope: scopeName, error: 'invalid index.json' });
      continue;
    }

    if (!index || typeof index !== 'object') {
      summary.errors.push({ scope: scopeName, error: 'index.json must contain an object' });
      continue;
    }

    if (typeof index.scopeKey !== 'string' || !index.scopeKey) {
      summary.errors.push({ scope: scopeName, error: 'index.json missing scopeKey' });
    } else if (expectedScopeKey && index.scopeKey !== expectedScopeKey) {
      summary.errors.push({ scope: scopeName, error: `scopeKey mismatch: expected ${expectedScopeKey}` });
    }

    if (index.acceptedCaptureId !== undefined && index.acceptedCaptureId !== null && (typeof index.acceptedCaptureId !== 'string' || index.acceptedCaptureId.trim() === '')) {
      summary.errors.push({ scope: scopeName, error: 'index.acceptedCaptureId must be null, undefined, or a non-empty string' });
    }

    const acceptedCaptureIdRaw = index.acceptedCaptureId;
    const acceptedCaptureId = (typeof acceptedCaptureIdRaw === 'string' && acceptedCaptureIdRaw.trim() !== '') ? acceptedCaptureIdRaw : null;
    const acceptedCaptureIdUnsafe = Boolean(acceptedCaptureId && (acceptedCaptureId.includes('/') || acceptedCaptureId.includes('\\') || acceptedCaptureId === '.' || acceptedCaptureId === '..'));
    if (acceptedCaptureIdUnsafe) {
      summary.errors.push({ scope: scopeName, capture: acceptedCaptureId, error: 'unsafe acceptedCaptureId in index (path traversal or invalid component)' });
    }

    if (!Array.isArray(index.captures)) {
      summary.errors.push({ scope: scopeName, error: 'index.captures must be an array' });
      continue;
    }

    const captures = index.captures;
    const seenCaptureIds = new Set();
    const seenRevisionNumbers = new Set();
    let acceptedCount = 0;

    for (const captureSummary of captures) {
      if (!captureSummary || typeof captureSummary !== 'object') {
        summary.errors.push({ scope: scopeName, error: 'index capture summary is malformed' });
        continue;
      }

      const captureId = captureSummary.captureId;
      // validate safe single path component
      if (typeof captureId !== 'string' || !captureId) {
        summary.errors.push({ scope: scopeName, error: 'capture summary missing captureId' });
        continue;
      }
      if (captureId.includes('/') || captureId.includes('\\') || captureId === '.' || captureId === '..') {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'unsafe captureId in index (path traversal or invalid component)' });
        continue;
      }

      if (seenCaptureIds.has(captureId)) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'duplicate captureId in index' });
      }
      seenCaptureIds.add(captureId);

      if (typeof captureSummary.status !== 'string' || captureSummary.status.trim() === '') {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'capture summary missing non-empty status' });
      }

      const summaryRevision = captureSummary.revision;

      if (!isValidRevision(summaryRevision)) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'invalid revision in index summary' });
      } else if (seenRevisionNumbers.has(summaryRevision)) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: `duplicate revision ${summaryRevision} in index` });
      } else {
        seenRevisionNumbers.add(summaryRevision);
      }

      summary.capturesChecked += 1;

      // Only construct filesystem paths after captureId is validated
      const publishedPath = path.join(scopePath, 'captures', captureId, 'manifest.json');
      const stagingPath = path.join(scopePath, 'staging', captureId, 'manifest.json');
      const manifestPath = (await exists(publishedPath)) ? publishedPath : ((await exists(stagingPath)) ? stagingPath : null);
      if (!manifestPath) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'manifest missing from captures/ and staging/' });
        continue;
      }

      let manifest;
      try {
        manifest = await readJsonSafe(manifestPath);
      } catch (error) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'invalid manifest.json' });
        continue;
      }

      try {
        validateManifest(manifest);
      } catch (error) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: `manifest validation failed: ${error.message}` });
        continue;
      }

      if (manifest.captureId !== captureId) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: `manifest.captureId ${manifest.captureId} does not match index captureId ${captureId}` });
      }
      if (manifest.scopeKey !== index.scopeKey) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'manifest.scopeKey does not match index.scopeKey' });
      }
      if (manifest.seasonId !== seasonId) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'manifest seasonId mismatch with directory' });
      }
      if (String(manifest.milestone) !== milestone) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'manifest milestone mismatch with directory' });
      }
      if (!isValidRevision(manifest.revision)) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: 'invalid revision in manifest' });
      } else if (manifest.revision !== summaryRevision) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: `manifest revision ${manifest.revision} does not match index revision ${summaryRevision}` });
      }
      if (typeof captureSummary.status === 'string' && captureSummary.status.trim() !== '' && typeof manifest.status === 'string' && captureSummary.status !== manifest.status) {
        summary.errors.push({ scope: scopeName, capture: captureId, error: `manifest status ${manifest.status} does not match index status ${captureSummary.status}` });
      }

      if (acceptedCaptureId === captureId) acceptedCount += 1;
    }

    // enforce acceptedCaptureId appears exactly once in index.captures and resolves to published captures/
    if (acceptedCaptureId && !acceptedCaptureIdUnsafe) {
      if (acceptedCount !== 1) {
        summary.errors.push({ scope: scopeName, error: 'acceptedCaptureId must appear exactly once in index.captures' });
      }
      const acceptedPublishedPath = path.join(scopePath, 'captures', acceptedCaptureId, 'manifest.json');
      if (!(await exists(acceptedPublishedPath))) {
        summary.errors.push({ scope: scopeName, error: 'acceptedCaptureId must resolve to a published manifest under captures/' });
      } else {
        // check published manifest is completed
        try {
          const pubManifest = await readJsonSafe(acceptedPublishedPath);
          if (pubManifest.status !== 'completed') {
            summary.errors.push({ scope: scopeName, error: `acceptedCaptureId published manifest status is ${pubManifest.status} (expected completed)` });
          } else {
            summary.acceptedCaptures += 1;
          }
        } catch (err) {
          summary.errors.push({ scope: scopeName, error: 'invalid published manifest.json for acceptedCaptureId' });
        }
      }
    }
  }

  return summary;
}

export default verifySnapshots;
