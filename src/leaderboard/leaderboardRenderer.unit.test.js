import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRuneBadgeLabel, coerceCompatibleRune } from './runeBadgeUtil.js';
import { formatHistoricalTeamProvenance } from './historicalTeamProvenance.js';

test('formats historical team provenance as a compact line with detail retained for a tooltip', () => {
  const result = formatHistoricalTeamProvenance({
    historicalTeamEvidence: { teamEvidence: 'observed', selectedBattleTimestamp: '2026-09-02T01:46:00.000Z' },
    snapshot: { eraCoverage: 'partial', capturedAt: '2026-09-06T03:45:00.000Z' }
  });

  assert.match(result.text, /^Historical team · battle /);
  assert.match(result.text, /partial coverage$/);
  assert.equal(result.detail, 'Coverage: partial — recent battle logs only; not exhaustive era history.');
  assert.ok(result.capturedAt);
});

test('formatRuneBadgeLabel uses name then id when name present', () => {
  const r = { id: 'rune-1', name: 'Blazing Orb' };
  assert.equal(formatRuneBadgeLabel(r), 'Blazing Orb (rune-1)');
});

test('formatRuneBadgeLabel falls back to id when name absent', () => {
  const r = { id: 'rune-2', name: null };
  assert.equal(formatRuneBadgeLabel(r), 'rune-2');
});

test('formatRuneBadgeLabel coerces numeric id to string', () => {
  const r = { id: 123 };
  assert.equal(formatRuneBadgeLabel(r), '123');
});

test('formatRuneBadgeLabel handles undefined/null gracefully', () => {
  assert.equal(formatRuneBadgeLabel(null), '');
  assert.equal(formatRuneBadgeLabel(undefined), '');
});

test('coerceCompatibleRune accepts string rune IDs and object rune metadata', () => {
  assert.deepEqual(coerceCompatibleRune({ runes: ['rune-123'] }), { id: 'rune-123', name: null, imageUrl: null });
  assert.deepEqual(coerceCompatibleRune({ runes: [{ id: 456, name: 'Blazing Orb', imageUrl: 'https://example.test/rune.png' }] }), {
    id: '456',
    name: 'Blazing Orb',
    imageUrl: 'https://example.test/rune.png'
  });
});
